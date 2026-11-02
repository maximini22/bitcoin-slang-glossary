(() => {
  const FIVE = [
    "circular-economy-scifi-world",
    "in-the-vault",
    "rich-in-bitcoin",
    "radioactive-bitcoin-hope",
    "most-humble-fiat-minimalist",
  ];
  const OTHER = [
    "bitcoin-slang-remix",
    "chester",
    "fliponomics",
    "freedom",
    "going-cashless",
    "if-it-wasnt-for-satoshi",
  ];
  const ALL = [...FIVE, ...OTHER];
  const LS_PREFIX = "lrc-editor-v1:";

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
  let lastTap = { i: -1, t: 0 };

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

      div.addEventListener("click", (e) => {
        if (e.target.closest("textarea") || e.target.closest("button")) return;
        const now = Date.now();
        if (lastTap.i === i && now - lastTap.t < 350) {
          // double tap -> seek
          if (lines[i].kind === "timed" && lines[i].time != null) {
            audio.currentTime = Math.max(0, lines[i].time);
          }
          lastTap = { i: -1, t: 0 };
        } else {
          lastTap = { i, t: now };
        }
        selected = i;
        highlightOnly();
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

  async function loadSong(slug, { preferLocal = true } = {}) {
    setStatus("Loading…");
    btnPlay.textContent = "Play";
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    let text = null;
    sourceLabel = "";

    if (preferLocal) {
      const loc = loadLocal(slug);
      if (loc && Array.isArray(loc.lines) && loc.lines.length) {
        lines = loc.lines;
        selected = Math.min(loc.selected || 0, lines.length - 1);
        sourceLabel = "local autosave";
        audio.src = `/preview-audio/${slug}.mp3`;
        render();
        setStatus(`Loaded ${slug} (${sourceLabel})`);
        return;
      }
    }

    try {
      const draftRes = await fetch(`/api/lrc-drafts/${slug}`, { credentials: "same-origin" });
      if (draftRes.ok) {
        const data = await draftRes.json();
        if (data.draft && typeof data.draft.text === "string") {
          text = data.draft.text;
          sourceLabel = `R2 draft ${data.draft.name}`;
        }
      }
    } catch (_) {}

    if (!text) {
      text = await fetchText(`/songs/${slug}/lyrics.lrc`);
      sourceLabel = "repo lyrics.lrc";
    }

    lines = parseLrc(text);
    selected = nextStampable(0);
    if (selected < 0) selected = 0;
    undoStack = [];
    audio.src = `/preview-audio/${slug}.mp3`;
    persistLocal();
    render();
    setStatus(`Loaded ${slug} (${sourceLabel})`, "ok");
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
      sourceLabel = `R2 draft ${data.name}`;
      setStatus(`Saved ${data.key}`, "ok");
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
    lines.splice(i + 1, 0, { kind: "section", time: null, text: "[Section]" });
    selected = i + 1;
    persistLocal();
    render();
    focusText(selected);
  }

  // Transport
  btnPlay.addEventListener("click", () => {
    if (audio.paused) {
      audio.play().catch((e) => setStatus(String(e.message || e), "err"));
    } else {
      audio.pause();
    }
  });
  $("btnBack").addEventListener("click", () => {
    audio.currentTime = Math.max(0, (audio.currentTime || 0) - 2);
  });
  $("btnFwd").addEventListener("click", () => {
    audio.currentTime = Math.min(audio.duration || 0, (audio.currentTime || 0) + 2);
  });
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
    if (e.code === "Space" && !e.repeat) {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      e.preventDefault();
      stamp();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      if ((e.target && e.target.tagName) === "TEXTAREA") return;
      e.preventDefault();
      undo();
    }
  });

  // Expose for Playwright
  window.__lrcEditor = {
    get lines() {
      return lines;
    },
    serialize: () => serializeLrc(lines),
    stamp,
    saveDraft,
    loadSong,
    nudge,
    ALL,
  };

  const params = new URLSearchParams(location.search);
  const initial = params.get("song");
  if (initial && ALL.includes(initial)) songEl.value = initial;
  loadSong(songEl.value).catch((e) => setStatus(String(e.message || e), "err"));
})();
