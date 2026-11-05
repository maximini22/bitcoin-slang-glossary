(() => {
  // All bitcoinslang.com songs that have lyrics in the glossary repo
  const SONGS = [
    { slug: "all-time-high-lessons-of-regret", title: "All Time High, Lessons of Regret", group: "Needs stamp" },
    { slug: "bitcoin-slang", title: "Bitcoin Slang (Original, Gzutek)", group: "Needs stamp" },
    { slug: "bitcoin-slang-remix", title: "Bitcoin Slang Remix", group: "Has LRC" },
    { slug: "chester", title: "Chester", group: "Has LRC" },
    { slug: "circular-economy-scifi-world", title: "Circular Economy Scifi World", group: "Five packs" },
    { slug: "diamond-hands-and-laser-eyes", title: "Diamond Hands & Laser Eyes", group: "Needs stamp" },
    { slug: "dread-pirate-robbie", title: "Dread Pirate Robbie", group: "Needs stamp" },
    { slug: "fliponomics", title: "Fliponomics", group: "Has LRC" },
    { slug: "freedom", title: "Freedom", group: "Has LRC" },
    { slug: "going-cashless", title: "Going Cashless", group: "Has LRC" },
    { slug: "if-it-wasnt-for-satoshi", title: "If It Wasn't For Satoshi", group: "Has LRC" },
    { slug: "in-the-vault", title: "In The Vault", group: "Five packs" },
    { slug: "most-humble-fiat-minimalist", title: "Most Humble Fiat Minimalist", group: "Five packs" },
    { slug: "most-toxic-bitcoin-maxi", title: "Most Toxic Bitcoin Maxi", group: "Needs stamp" },
    { slug: "radioactive-bitcoin-hope", title: "Radioactive Bitcoin Hope", group: "Five packs" },
    { slug: "rich-in-bitcoin", title: "Rich In Bitcoin", group: "Five packs" },
    { slug: "take-money-off-mainstreet", title: "Take Money Off Mainstreet", group: "Needs stamp" },
    { slug: "vitamin", title: "Vitamin", group: "Needs stamp" },
  ];
  const ALL = SONGS.map((s) => s.slug);
  const SONG_META = Object.fromEntries(SONGS.map((s) => [s.slug, s]));
  let draftMeta = {}; // slug -> { name, stamp, uploaded, final }

  const LS_PREFIX = "lrc-editor-v1:";
  const TAP_PREROLL = 1.0;
  const NUDGE_PREROLL = 1.5;
  const NUDGE_REPLAY_DEBOUNCE_MS = 300;
  const SKIP_SEC = 5;

  const $ = (id) => document.getElementById(id);
  const songEl = $("song");
  const audio = $("audio");
  const linesEl = $("lines");
  const statusEl = $("status");
  const seekEl = $("seek");
  const curTimeEl = $("curTime");
  const durTimeEl = $("durTime");
  const btnPlay = $("btnPlay");
  const btnSpeed = $("btnSpeed");

  /** @type {{kind:'timed'|'section'|'blank', time:number|null, text:string}[]} */
  let lines = [];
  let selected = 0;
  let undoStack = [];
  let sourceLabel = "";
  let speeds = [1, 0.75];
  let speedIdx = 0;
  let suppressSeek = false;
  let nudgeReplayTimer = null;
  let suppressTapPlay = false;

  function setStatus(msg, kind = "") {
    statusEl.textContent = msg || "";
    statusEl.className = "ed-status" + (kind ? " " + kind : "");
  }

  function formatTs(sec) {
    if (sec == null || !Number.isFinite(sec) || sec < 0) return "";
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    const whole = Math.floor(s);
    const hundredths = Math.round((s - whole) * 100);
    let mm = String(m).padStart(2, "0");
    let ss = String(whole).padStart(2, "0");
    let hh = String(hundredths).padStart(2, "0");
    if (hundredths === 100) {
      // carry
      const n = sec + 0.0001;
      return formatTs(n);
    }
    return `[${mm}:${ss}.${hh}]`;
  }

  function displayClock(sec) {
    if (!Number.isFinite(sec)) return "0:00.00";
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    const whole = Math.floor(s);
    const hh = Math.floor((s - whole) * 100);
    return `${m}:${String(whole).padStart(2, "0")}.${String(hh).padStart(2, "0")}`;
  }

  function parseLrc(text) {
    const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const out = [];
    for (const line of raw.split("\n")) {
      if (line === "") {
        out.push({ kind: "blank", time: null, text: "" });
        continue;
      }
      const tm = /^\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/.exec(line);
      if (tm) {
        const min = +tm[1];
        const sec = +tm[2];
        let frac = tm[3] || "0";
        if (frac.length === 1) frac += "0";
        if (frac.length === 3) frac = frac.slice(0, 2); // keep hundredths like existing
        const time = min * 60 + sec + (+frac) / 100;
        out.push({ kind: "timed", time, text: tm[4] });
        continue;
      }
      // section / header / bare text without stamp
      out.push({ kind: "section", time: null, text: line });
    }
    // Drop trailing blank that came from final newline (we'll re-add on serialize)
    while (out.length && out[out.length - 1].kind === "blank" && out[out.length - 1].text === "") {
      out.pop();
    }
    return out;
  }

  function parsePlainLyrics(text) {
    const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const out = [];
    for (const line of raw.split("\n")) {
      if (line === "") {
        out.push({ kind: "blank", time: null, text: "" });
        continue;
      }
      // Bracket-only / section headers without a timestamp
      if (/^\[[^\]]*\]\s*$/.test(line) || (/^\[/.test(line) && !/^\[\d{1,3}:\d{2}/.test(line))) {
        out.push({ kind: "section", time: null, text: line });
        continue;
      }
      out.push({ kind: "timed", time: null, text: line });
    }
    while (out.length && out[out.length - 1].kind === "blank" && out[out.length - 1].text === "") {
      out.pop();
    }
    return out;
  }

  function serializeLrc(arr) {
    const parts = [];
    for (const row of arr) {
      if (row.kind === "blank") {
        parts.push("");
      } else if (row.kind === "section") {
        parts.push(row.text);
      } else if (row.time == null || !Number.isFinite(row.time)) {
        // timed line with cleared time -> emit text only? Prefer keep as section-like bare text
        parts.push(row.text);
      } else {
        parts.push(formatTs(row.time) + row.text);
      }
    }
    return parts.join("\n") + "\n";
  }

  function pushUndo() {
    undoStack.push(JSON.stringify({ lines, selected }));
    if (undoStack.length > 40) undoStack.shift();
  }

  function undo() {
    if (!undoStack.length) {
      setStatus("Nothing to undo");
      return;
    }
    const snap = JSON.parse(undoStack.pop());
    lines = snap.lines;
    selected = snap.selected;
    persistLocal();
    render();
    setStatus("Undid");
  }

  function persistLocal() {
    const slug = songEl.value;
    try {
      localStorage.setItem(
        LS_PREFIX + slug,
        JSON.stringify({ lines, selected, savedAt: Date.now(), sourceLabel })
      );
    } catch (_) {}
  }

  function loadLocal(slug) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + slug);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function clearLocal(slug) {
    try {
      localStorage.removeItem(LS_PREFIX + slug);
    } catch (_) {}
  }

  function activePlayIndex(t) {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      const row = lines[i];
      if (row.kind === "timed" && row.time != null && row.time <= t + 1e-6) idx = i;
    }
    return idx;
  }

  function playFrom(sec) {
    const t = Math.max(0, sec);
    audio.currentTime = t;
    if (!suppressSeek) seekEl.value = String(t);
    curTimeEl.textContent = displayClock(t);
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch((e) => setStatus(String(e.message || e), "err"));
    }
  }

  function skipBy(delta) {
    const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
    const next = Math.max(0, Math.min(dur || Infinity, (audio.currentTime || 0) + delta));
    audio.currentTime = next;
    if (!suppressSeek) seekEl.value = String(next);
    curTimeEl.textContent = displayClock(next);
  }

  function scheduleNudgeReplay(lineTime) {
    if (nudgeReplayTimer) clearTimeout(nudgeReplayTimer);
    nudgeReplayTimer = setTimeout(() => {
      nudgeReplayTimer = null;
      if (lineTime == null || !Number.isFinite(lineTime)) return;
      playFrom(Math.max(0, lineTime - NUDGE_PREROLL));
    }, NUDGE_REPLAY_DEBOUNCE_MS);
  }

  function clearAllTimestamps() {
    if (!window.confirm("Clear all timestamps? Lyric text stays; you can Undo.")) return;
    pushUndo();
    for (const row of lines) {
      if (row.kind === "timed") row.time = null;
    }
    const first = nextStampable(0);
    selected = first >= 0 ? first : 0;
    persistLocal();
    render();
    setStatus("Cleared all timestamps", "ok");
  }

  function render() {
    const frag = document.createDocumentFragment();
    const playIdx = activePlayIndex(audio.currentTime || 0);
    lines.forEach((row, i) => {
      const div = document.createElement("div");
      div.className = "ed-row";
      div.dataset.i = String(i);
      div.setAttribute("role", "listitem");
      if (row.kind === "section") div.classList.add("section");
      if (row.kind === "blank") div.classList.add("blank");
      if (i === selected) div.classList.add("selected");
      if (i === playIdx) div.classList.add("active-play");

      if (row.kind !== "section" && row.kind !== "blank") {
        const ts = document.createElement("div");
        ts.className = "ed-ts";
        ts.textContent = row.time == null ? "—:—.—" : formatTs(row.time).slice(1, -1);
        div.appendChild(ts);
      }

      if (row.kind !== "blank") {
        const ta = document.createElement("textarea");
        ta.className = "ed-text";
        ta.rows = 1;
        ta.value = row.text;
        ta.setAttribute("aria-label", row.kind === "section" ? "Section" : "Lyric line");
        ta.addEventListener("focus", () => {
          selected = i;
          highlightOnly();
        });
        // First tap on lyric text = select + play; already-focused edits stay quiet.
        // "Edit text" sets suppressTapPlay so focus alone does not restart audio.
        ta.addEventListener("pointerdown", () => {
          if (suppressTapPlay) return;
          if (document.activeElement === ta) return;
          selected = i;
          highlightOnly();
          if (lines[i].kind === "timed" && lines[i].time != null && Number.isFinite(lines[i].time)) {
            playFrom(Math.max(0, lines[i].time - TAP_PREROLL));
          }
        });
        ta.addEventListener("input", () => {
          pushUndo();
          lines[i].text = ta.value;
          persistLocal();
        });
        ta.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            pushUndo();
            lines.splice(i + 1, 0, { kind: "timed", time: null, text: "" });
            selected = i + 1;
            persistLocal();
            render();
            focusText(selected);
          }
        });
        div.appendChild(ta);
      } else {
        const spacer = document.createElement("div");
        spacer.className = "ed-text";
        spacer.textContent = "(blank)";
        spacer.style.opacity = "0.4";
        spacer.style.fontSize = "0.8rem";
        div.appendChild(spacer);
      }

      const tools = document.createElement("div");
      tools.className = "ed-row-tools";
      const mk = (label, fn, cls = "") => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ed-mini" + (cls ? " " + cls : "");
        b.textContent = label;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          fn();
        });
        tools.appendChild(b);
      };
      if (row.kind === "timed") {
        mk("−0.1s", () => nudge(i, -0.1));
        mk("+0.1s", () => nudge(i, 0.1));
        mk("Clear time", () => {
          pushUndo();
          lines[i].time = null;
          persistLocal();
          render();
        });
        mk("Edit text", () => {
          suppressTapPlay = true;
          focusText(i);
          setTimeout(() => { suppressTapPlay = false; }, 0);
        });
      }
      mk("Insert below", () => {
        pushUndo();
        lines.splice(i + 1, 0, { kind: "timed", time: null, text: "" });
        selected = i + 1;
        persistLocal();
        render();
        focusText(selected);
      });
      mk("Delete", () => {
        pushUndo();
        lines.splice(i, 1);
        if (!lines.length) lines.push({ kind: "timed", time: null, text: "" });
        selected = Math.min(i, lines.length - 1);
        persistLocal();
        render();
      }, "warn");
      div.appendChild(tools);

      // Single tap on row chrome (not textarea/button): select + play with ~1s pre-roll
      div.addEventListener("click", (e) => {
        if (e.target.closest("textarea") || e.target.closest("button")) return;
        selected = i;
        highlightOnly();
        if (lines[i].kind === "timed" && lines[i].time != null && Number.isFinite(lines[i].time)) {
          playFrom(Math.max(0, lines[i].time - TAP_PREROLL));
        }
      });

      frag.appendChild(div);
    });
    linesEl.innerHTML = "";
    linesEl.appendChild(frag);
    scrollSelectedIntoView();
  }

  function highlightOnly() {
    [...linesEl.children].forEach((el, i) => {
      el.classList.toggle("selected", i === selected);
    });
    scrollSelectedIntoView();
  }

  function scrollSelectedIntoView() {
    const el = linesEl.children[selected];
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function focusText(i) {
    requestAnimationFrame(() => {
      const el = linesEl.children[i]?.querySelector("textarea");
      if (el) el.focus();
    });
  }

  function nudge(i, delta) {
    const row = lines[i];
    if (!row || row.kind !== "timed") return;
    pushUndo();
    const base = row.time == null ? audio.currentTime || 0 : row.time;
    row.time = Math.max(0, Math.round((base + delta) * 100) / 100);
    persistLocal();
    render();
    scheduleNudgeReplay(row.time);
  }

  function nextStampable(from) {
    for (let i = from; i < lines.length; i++) {
      if (lines[i].kind === "timed") return i;
    }
    return -1;
  }

  function stamp() {
    let i = selected;
    if (lines[i]?.kind !== "timed") {
      i = nextStampable(i);
      if (i < 0) i = nextStampable(0);
      if (i < 0) {
        setStatus("No timed line to stamp", "err");
        return;
      }
      selected = i;
    }
    pushUndo();
    const t = Math.max(0, Math.round((audio.currentTime || 0) * 100) / 100);
    lines[i].time = t;
    const n = nextStampable(i + 1);
    if (n >= 0) selected = n;
    persistLocal();
    render();
    setStatus(`Stamped ${formatTs(t)}`);
  }

  async function fetchText(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.text();
  }

  function normalizeLrcText(s) {
    return String(s || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function localDiffersFromDraft(loc, draftText) {
    if (!loc || !Array.isArray(loc.lines)) return true;
    try {
      return normalizeLrcText(serializeLrc(loc.lines)) !== normalizeLrcText(draftText);
    } catch {
      return true;
    }
  }

  function applyLoadedLines(slug, nextLines, label, { selectedHint = null, writeLocal = true, savedAt = null } = {}) {
    lines = nextLines;
    if (selectedHint != null) {
      selected = Math.min(Math.max(0, selectedHint), Math.max(0, lines.length - 1));
    } else {
      selected = nextStampable(0);
      if (selected < 0) selected = 0;
    }
    undoStack = [];
    sourceLabel = label;
    audio.src = `/preview-audio/${slug}.mp3`;
    if (writeLocal) {
      try {
        localStorage.setItem(
          LS_PREFIX + slug,
          JSON.stringify({
            lines,
            selected,
            savedAt: savedAt != null ? savedAt : Date.now(),
            sourceLabel,
          })
        );
      } catch (_) {}
    }
    render();
    setStatus(`Loaded ${slug} (${sourceLabel})`, "ok");
  }

  async function loadSong(slug, { forceServer = false } = {}) {
    setStatus("Loading…");
    btnPlay.textContent = "Play";
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    let draft = null;
    try {
      const draftRes = await fetch(`/api/lrc-drafts/${slug}`, { credentials: "same-origin" });
      if (draftRes.ok) {
        const data = await draftRes.json();
        if (data.draft && typeof data.draft.text === "string") draft = data.draft;
      }
    } catch (_) {}

    const loc = forceServer ? null : loadLocal(slug);
    const serverUploadedMs = draft && draft.uploaded ? Date.parse(draft.uploaded) : NaN;
    const localSavedAt = loc && typeof loc.savedAt === "number" ? loc.savedAt : NaN;
    const localIsNewer =
      !forceServer &&
      loc &&
      Array.isArray(loc.lines) &&
      loc.lines.length &&
      Number.isFinite(localSavedAt) &&
      Number.isFinite(serverUploadedMs) &&
      localSavedAt > serverUploadedMs &&
      localDiffersFromDraft(loc, draft.text);

    if (draft && !localIsNewer) {
      // R2 draft wins (newer, equal, same content, or no usable local). Clear stale local first.
      if (loc && Number.isFinite(localSavedAt) && Number.isFinite(serverUploadedMs) && serverUploadedMs >= localSavedAt) {
        clearLocal(slug);
      }
      applyLoadedLines(slug, parseLrc(draft.text), `R2 draft ${draft.name}`, {
        savedAt: Number.isFinite(serverUploadedMs) ? serverUploadedMs : Date.now(),
      });
      return;
    }

    if (localIsNewer) {
      applyLoadedLines(slug, loc.lines, "local autosave (newer than R2)", {
        selectedHint: loc.selected || 0,
        writeLocal: false,
      });
      return;
    }

    // No R2 draft: use local if present, else repo lyrics
    if (!forceServer && loc && Array.isArray(loc.lines) && loc.lines.length) {
      applyLoadedLines(slug, loc.lines, "local autosave", {
        selectedHint: loc.selected || 0,
        writeLocal: false,
      });
      return;
    }

    let text = null;
    let label = "";
    try {
      text = await fetchText(`/songs/${slug}/lyrics.lrc`);
      label = "repo lyrics.lrc";
      applyLoadedLines(slug, parseLrc(text), label);
    } catch (_) {
      text = await fetchText(`/songs/${slug}/lyrics.txt`);
      label = "repo lyrics.txt (untimed)";
      applyLoadedLines(slug, parsePlainLyrics(text), label);
    }
  }

  async function reloadSaved() {
    const slug = songEl.value;
    const loc = loadLocal(slug);
    let draft = null;
    try {
      const draftRes = await fetch(`/api/lrc-drafts/${slug}`, { credentials: "same-origin" });
      if (draftRes.ok) {
        const data = await draftRes.json();
        if (data.draft && typeof data.draft.text === "string") draft = data.draft;
      }
    } catch (_) {}
    const serverUploadedMs = draft && draft.uploaded ? Date.parse(draft.uploaded) : NaN;
    const localSavedAt = loc && typeof loc.savedAt === "number" ? loc.savedAt : NaN;
    const localNewer =
      loc &&
      Array.isArray(loc.lines) &&
      loc.lines.length &&
      Number.isFinite(localSavedAt) &&
      (!Number.isFinite(serverUploadedMs) || localSavedAt > serverUploadedMs) &&
      (!draft || localDiffersFromDraft(loc, draft.text));
    if (localNewer) {
      const ok = window.confirm(
        "Local edits are newer than the saved R2 draft. Discard them and reload the server draft?"
      );
      if (!ok) return;
    }
    clearLocal(slug);
    await loadSong(slug, { forceServer: true });
  }

  async function saveDraft() {
    const slug = songEl.value;
    const lrc = serializeLrc(lines);
    setStatus("Saving…");
    try {
      const res = await fetch(`/api/lrc-drafts/${slug}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lrc }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      sourceLabel = `R2 draft ${data.name} (final)`;
      // Align or clear local autosave so it cannot beat this (or a later) server draft.
      try {
        const verify = await fetch(`/api/lrc-drafts/${slug}`, { credentials: "same-origin" });
        if (verify.ok) {
          const v = await verify.json();
          const uploadedMs = v.draft && v.draft.uploaded ? Date.parse(v.draft.uploaded) : NaN;
          if (Number.isFinite(uploadedMs)) {
            localStorage.setItem(
              LS_PREFIX + slug,
              JSON.stringify({
                lines,
                selected,
                savedAt: uploadedMs,
                sourceLabel,
              })
            );
          } else {
            clearLocal(slug);
          }
        } else {
          clearLocal(slug);
        }
      } catch (_) {
        clearLocal(slug);
      }
      setStatus(`Saved ${data.key} — final for push`, "ok");
      await refreshDraftMeta();
      return data;
    } catch (e) {
      setStatus(`Save failed: ${e.message}`, "err");
      throw e;
    }
  }

  function copyText() {
    const lrc = serializeLrc(lines);
    navigator.clipboard.writeText(lrc).then(
      () => setStatus("Copied to clipboard", "ok"),
      () => setStatus("Clipboard blocked", "err")
    );
  }

  function downloadLrc() {
    const slug = songEl.value;
    const blob = new Blob([serializeLrc(lines)], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.lrc`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("Download started");
  }

  function addSection() {
    pushUndo();
    const i = selected;
    lines.splice(i + 1, 0, { kind: "section", time: null, text: "Section" });
    selected = i + 1;
    persistLocal();
    render();
    focusText(selected);
  }


  function formatDraftLabel(meta) {
    if (!meta) return "";
    // stamp is YYYYMMDD-HHMMSS in Perth
    const s = meta.stamp || (meta.name || "").replace(/\.lrc$/, "");
    if (/^\d{8}-\d{6}$/.test(s)) {
      const y = s.slice(0, 4), mo = s.slice(4, 6), da = s.slice(6, 8);
      return ` · saved ${y}-${mo}-${da} (final)`;
    }
    return ` · saved ${s} (final)`;
  }

  function rebuildSongSelect(preferred) {
    const keep = preferred || songEl.value || "rich-in-bitcoin";
    const groups = {};
    for (const s of SONGS) {
      (groups[s.group] ||= []).push(s);
    }
    const order = ["Five packs", "Has LRC", "Needs stamp"];
    songEl.innerHTML = "";
    for (const g of order) {
      if (!groups[g]) continue;
      const og = document.createElement("optgroup");
      og.label = g;
      for (const s of groups[g]) {
        const opt = document.createElement("option");
        opt.value = s.slug;
        opt.textContent = s.title + formatDraftLabel(draftMeta[s.slug]);
        og.appendChild(opt);
      }
      songEl.appendChild(og);
    }
    if (ALL.includes(keep)) songEl.value = keep;
  }

  async function refreshDraftMeta() {
    try {
      const res = await fetch("/api/lrc-drafts", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      draftMeta = data.drafts || {};
      rebuildSongSelect(songEl.value);
    } catch (_) {}
  }

  // Transport
  btnPlay.addEventListener("click", () => {
    if (audio.paused) {
      audio.play().catch((e) => setStatus(String(e.message || e), "err"));
    } else {
      audio.pause();
    }
  });
  $("btnBack").addEventListener("click", () => skipBy(-SKIP_SEC));
  $("btnFwd").addEventListener("click", () => skipBy(SKIP_SEC));
  btnSpeed.addEventListener("click", () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    audio.playbackRate = speeds[speedIdx];
    btnSpeed.textContent = speeds[speedIdx] === 1 ? "1×" : "0.75×";
  });
  $("btnStamp").addEventListener("click", stamp);
  $("btnUndo").addEventListener("click", undo);
  $("btnSave").addEventListener("click", () => saveDraft().catch(() => {}));
  $("btnCopy").addEventListener("click", copyText);
  $("btnDownload").addEventListener("click", downloadLrc);
  $("btnAddSection").addEventListener("click", addSection);
  $("btnClearTimes").addEventListener("click", clearAllTimestamps);
  $("btnReloadSaved").addEventListener("click", () => reloadSaved().catch((e) => setStatus(String(e.message || e), "err")));

  seekEl.addEventListener("input", () => {
    suppressSeek = true;
    audio.currentTime = +seekEl.value;
  });
  seekEl.addEventListener("change", () => {
    suppressSeek = false;
  });

  audio.addEventListener("play", () => {
    btnPlay.textContent = "Pause";
  });
  audio.addEventListener("pause", () => {
    btnPlay.textContent = "Play";
  });
  audio.addEventListener("loadedmetadata", () => {
    seekEl.max = String(audio.duration || 0);
    durTimeEl.textContent = displayClock(audio.duration || 0);
  });
  audio.addEventListener("timeupdate", () => {
    const t = audio.currentTime || 0;
    if (!suppressSeek) seekEl.value = String(t);
    curTimeEl.textContent = displayClock(t);
    const playIdx = activePlayIndex(t);
    [...linesEl.children].forEach((el, i) => {
      el.classList.toggle("active-play", i === playIdx);
    });
    const active = linesEl.children[playIdx];
    if (active && !audio.paused) {
      const r = active.getBoundingClientRect();
      if (r.top < 200 || r.bottom > window.innerHeight - 40) {
        active.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  });

  songEl.addEventListener("change", () => {
    loadSong(songEl.value).catch((e) => setStatus(String(e.message || e), "err"));
  });

  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    const inField = tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT";
    if (e.code === "Space" && !e.repeat) {
      if (inField) return;
      e.preventDefault();
      stamp();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      if (tag === "TEXTAREA") return;
      e.preventDefault();
      undo();
    }
    if (!inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        skipBy(-SKIP_SEC);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        skipBy(SKIP_SEC);
      }
    }
  });

  // Expose for Playwright
  window.__lrcEditor = {
    get lines() {
      return lines;
    },
    get selected() {
      return selected;
    },
    serialize: () => serializeLrc(lines),
    stamp,
    saveDraft,
    loadSong,
    nudge,
    clearAllTimestamps,
    reloadSaved,
    skipBy,
    playFrom,
    ALL,
    SONGS,
    refreshDraftMeta,
    draftMeta: () => draftMeta,
  };

  rebuildSongSelect("rich-in-bitcoin");
  const params = new URLSearchParams(location.search);
  const initial = params.get("song");
  if (initial && ALL.includes(initial)) songEl.value = initial;
  refreshDraftMeta()
    .catch(() => {})
    .finally(() => {
      loadSong(songEl.value).catch((e) => setStatus(String(e.message || e), "err"));
    });
})();
