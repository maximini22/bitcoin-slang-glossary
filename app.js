const params = new URLSearchParams(location.search);
const slug = params.get("slug") || "bitcoin-slang-remix";

const lyricsEl = document.getElementById("lyrics");
const phraseEl = document.getElementById("phrase");
const noteEl = document.getElementById("note");
const noteImg = document.getElementById("note-image");
const titleEl = document.getElementById("title");
const subEl = document.getElementById("sub");

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function applyAnnotations(text, annotations) {
  const sorted = [...annotations].sort((a, b) => b.phrase.length - a.phrase.length);
  const used = [];
  let html = escapeHtml(text);

  for (const a of sorted) {
    const needle = escapeHtml(a.phrase);
    if (!needle) continue;
    const idx = html.toLowerCase().indexOf(needle.toLowerCase());
    if (idx === -1) continue;
    const original = html.slice(idx, idx + needle.length);
    const mark = `<mark class="ann" data-id="${a.id}">${original}</mark>`;
    html = html.slice(0, idx) + mark + html.slice(idx + needle.length);
    used.push(a.id);
  }

  html = html.replace(/^\[(.+)\]$/gm, '<span class="section-label">[$1]</span>');
  return html;
}

function showAnnotation(a) {
  if (!a) {
    phraseEl.textContent = "";
    noteEl.innerHTML = '<p class="hint">Hover or tap a highlighted line.</p>';
    if (noteImg) {
      noteImg.hidden = true;
      noteImg.removeAttribute("src");
      noteImg.alt = "";
    }
    return;
  }
  phraseEl.textContent = a.phrase;
  noteEl.textContent = a.note;
  if (noteImg && a.image) {
    noteImg.src = a.image;
    noteImg.alt = "Chart for " + a.phrase;
    noteImg.hidden = false;
  } else if (noteImg) {
    noteImg.hidden = true;
    noteImg.removeAttribute("src");
    noteImg.alt = "";
  }
}

async function boot() {
  const [lyricsRes, annRes, metaRes] = await Promise.all([
    fetch(`songs/${slug}/lyrics.txt`),
    fetch(`songs/${slug}/annotations.json`),
    fetch(`songs/${slug}/meta.json`),
  ]);

  if (!lyricsRes.ok) {
    lyricsEl.textContent = "Song not found.";
    return;
  }

  const lyrics = await lyricsRes.text();
  const annotations = await annRes.json();
  const meta = metaRes.ok ? await metaRes.json() : { title: slug, artist: "ROBBIE P" };

  titleEl.textContent = meta.title;
  if (meta.description) {
    subEl.textContent = meta.description;
  } else {
    subEl.textContent = `${meta.artist}${meta.theme ? " · " + meta.theme : ""}`;
  }
  document.title = `${meta.title} — Bitcoinslang.com`;

  if (slug === "bitcoin-slang-remix") {
    await renderRemix(lyrics, annotations);
  } else {
    lyricsEl.innerHTML = applyAnnotations(lyrics, annotations);
  }

  const byId = Object.fromEntries(annotations.map((a) => [a.id, a]));

  lyricsEl.addEventListener("mouseover", (e) => {
    const mark = e.target.closest("mark.ann");
    if (!mark) return;
    document.querySelectorAll("mark.ann.active").forEach((m) => m.classList.remove("active"));
    mark.classList.add("active");
    showAnnotation(byId[mark.dataset.id]);
  });

  lyricsEl.addEventListener("click", (e) => {
    const mark = e.target.closest("mark.ann");
    if (!mark) return;
    document.querySelectorAll("mark.ann.active").forEach((m) => m.classList.remove("active"));
    mark.classList.add("active");
    showAnnotation(byId[mark.dataset.id]);
  });
}

boot();

const REMIX_TRACK = "bitcoin-slang-remix.mp3";
const SIGN_HOSTS = [
  "https://audio.btcslang.com",
  "https://bitcoin-slang-audio.bitcoinslang.workers.dev",
];
const URL_TTL_MS = 5 * 60 * 1000;
const URL_SKEW_MS = 15 * 1000;

function foldLyric(s) {
  return s
    .toLowerCase()
    .replace(/\n/g, " ")
    .replace(/[\u2018\u2019\u02bc]/g, "'");
}

function parseDisplayLyrics(text) {
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const section = line.match(/^\[(.+)\]$/);
    if (section) items.push({ section: section[1] });
    else items.push({ text: line });
  }
  return items;
}

function parseLrc(text) {
  const timed = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
    if (!m) continue;
    const frac = m[3].length === 3 ? Number(m[3]) / 1000 : Number(m[3]) / 100;
    timed.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text: m[4] });
  }
  return timed;
}

function collectMarks(full, annotations) {
  const folded = foldLyric(full);
  const sorted = [...annotations].sort((a, b) => b.phrase.length - a.phrase.length);
  const used = new Array(full.length).fill(false);
  const marks = [];
  for (const a of sorted) {
    const needle = foldLyric(a.phrase);
    const idx = folded.indexOf(needle);
    if (idx === -1) continue;
    const end = idx + needle.length;
    let overlap = false;
    for (let i = idx; i < end; i++) {
      if (full[i] !== "\n" && used[i]) overlap = true;
    }
    if (overlap) continue;
    for (let i = idx; i < end; i++) used[i] = true;
    marks.push({ start: idx, end, id: a.id });
  }
  return marks;
}

function renderMarkedLine(text, lineStart, marks) {
  const lineEnd = lineStart + text.length;
  const parts = marks
    .filter((m) => m.end > lineStart && m.start < lineEnd)
    .map((m) => ({
      id: m.id,
      a: Math.max(0, m.start - lineStart),
      b: Math.min(text.length, m.end - lineStart),
    }))
    .sort((x, y) => x.a - y.a);
  let html = "";
  let i = 0;
  for (const part of parts) {
    if (part.b <= part.a || part.a < i) continue;
    html += escapeHtml(text.slice(i, part.a));
    html += `<mark class="ann" data-id="${escapeHtml(part.id)}">${escapeHtml(text.slice(part.a, part.b))}</mark>`;
    i = part.b;
  }
  html += escapeHtml(text.slice(i));
  return html;
}

async function renderRemix(lyrics, annotations) {
  let lrcText = "";
  try {
    const res = await fetch(`songs/${slug}/lyrics.lrc`, { cache: "no-store" });
    if (res.ok) lrcText = await res.text();
  } catch (err) {
    lrcText = "";
  }

  const items = parseDisplayLyrics(lyrics);
  const timed = parseLrc(lrcText);
  const textItems = items.filter((item) => item.text);
  if (!timed.length || timed.length !== textItems.length) {
    lyricsEl.innerHTML = applyAnnotations(lyrics, annotations);
    mountRemixPlayer([]);
    return;
  }

  const full = textItems.map((item) => item.text).join("\n");
  const marks = collectMarks(full, annotations);
  const frag = document.createDocumentFragment();
  const lines = [];
  let offset = 0;
  let timeIndex = 0;

  for (const item of items) {
    if (item.section) {
      const label = document.createElement("span");
      label.className = "section-label";
      label.textContent = `[${item.section}]`;
      frag.appendChild(label);
      continue;
    }
    const entry = timed[timeIndex];
    const el = document.createElement("div");
    el.className = "lyric-line";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.dataset.t = String(entry.t);
    el.innerHTML = renderMarkedLine(item.text, offset, marks);
    frag.appendChild(el);
    lines.push({ t: entry.t, el });
    offset += item.text.length + 1;
    timeIndex += 1;
  }

  lyricsEl.innerHTML = "";
  lyricsEl.appendChild(frag);
  mountRemixPlayer(lines);
}

function mountRemixPlayer(lines) {
  document.body.classList.add("has-player");

  const bar = document.createElement("div");
  bar.className = "player";
  bar.innerHTML = `
    <div class="player-in">
      <p class="player-note" id="player-note" role="status" aria-live="polite"></p>
      <div class="player-row">
        <button class="player-play" id="player-play" type="button" aria-label="Play">
          <svg class="icon-play" viewBox="0 0 12 14" aria-hidden="true"><path d="M1 0v14l11-7z"/></svg>
          <svg class="icon-pause" viewBox="0 0 12 14" aria-hidden="true"><path d="M1 0h3.5v14H1zM7.5 0H11v14H7.5z"/></svg>
        </button>
        <span class="player-time" id="player-cur">0:00</span>
        <input class="player-scrub" id="player-scrub" type="range" min="0" max="193.49" step="0.01" value="0" aria-label="Seek">
        <span class="player-time player-dur" id="player-dur">0:00</span>
      </div>
    </div>
  `;
  document.body.appendChild(bar);

  const audio = document.createElement("audio");
  audio.preload = "none";
  audio.crossOrigin = "anonymous";
  audio.setAttribute("playsinline", "");
  bar.appendChild(audio);

  const playBtn = bar.querySelector("#player-play");
  const scrub = bar.querySelector("#player-scrub");
  const curEl = bar.querySelector("#player-cur");
  const durEl = bar.querySelector("#player-dur");
  const noteEl = bar.querySelector("#player-note");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  let signedUrl = "";
  let fetchedAt = 0;
  let wantPlay = false;
  let swapping = false;
  let swapGen = 0;
  let chain = Promise.resolve();
  let mediaGen = 0;
  let holdTime = null;
  let dragging = false;
  let active = -1;
  let scrollLockUntil = 0;
  let errorTries = 0;

  function fmt(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  }

  function paintScrub() {
    const max = Number(scrub.max) || 1;
    const min = Number(scrub.min) || 0;
    const value = Number(scrub.value) || 0;
    const span = max - min || 1;
    scrub.style.setProperty("--p", `${Math.min(100, ((value - min) / span) * 100)}%`);
  }

  function showCalm() {
    noteEl.textContent = "This song cannot be played right now. Please try again.";
  }

  function hideCalm() {
    noteEl.textContent = "";
  }

  function stillValid() {
    return Boolean(signedUrl) && Date.now() - fetchedAt < URL_TTL_MS - URL_SKEW_MS;
  }

  function indexAt(t) {
    let found = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= t + 0.03) found = i;
      else break;
    }
    return found;
  }

  function scrollLine(el) {
    if (performance.now() < scrollLockUntil) return;
    const rect = el.getBoundingClientRect();
    const topBound = 72;
    const bottomBound = window.innerHeight * 0.58;
    if (rect.top >= topBound && rect.bottom <= bottomBound) return;
    const y = window.scrollY + rect.top - window.innerHeight * 0.28;
    window.scrollTo({ top: Math.max(0, y), behavior: reduce.matches ? "auto" : "smooth" });
  }

  function highlight(t, scroll) {
    const i = indexAt(t);
    if (i === active) return;
    if (active >= 0 && lines[active]) {
      lines[active].el.classList.remove("is-current");
      lines[active].el.removeAttribute("aria-current");
    }
    active = i;
    document.body.classList.toggle("has-current", i >= 0);
    if (i < 0) return;
    lines[i].el.classList.add("is-current");
    lines[i].el.setAttribute("aria-current", "true");
    if (scroll) scrollLine(lines[i].el);
  }

  function shownTime() {
    if (holdTime != null) return holdTime;
    if (dragging) return Number(scrub.value) || 0;
    return audio.currentTime || 0;
  }

  function syncChrome() {
    const t = shownTime();
    if (!dragging) {
      scrub.value = String(t);
      paintScrub();
    }
    curEl.textContent = fmt(t);
    highlight(t, wantPlay && !dragging);
  }

  async function requestSigned() {
    let lastError = new Error("sign");
    for (const host of SIGN_HOSTS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(`${host}/sign?track=${encodeURIComponent(REMIX_TRACK)}`, {
          cache: "no-store",
          credentials: "omit",
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("status");
        const data = await res.json();
        if (!data || typeof data.url !== "string" || !data.url) throw new Error("body");
        return data.url;
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  function attach(url, time) {
    return new Promise((resolve, reject) => {
      const gen = ++mediaGen;
      let settled = false;
      const finish = (err) => {
        if (settled || gen !== mediaGen) return;
        settled = true;
        clearTimeout(timer);
        audio.removeEventListener("loadedmetadata", onMeta);
        audio.removeEventListener("error", onErr);
        audio.removeEventListener("seeked", onSeeked);
        if (err) reject(err);
        else resolve();
      };
      const onErr = () => {
        if (signedUrl === url) {
          signedUrl = "";
          fetchedAt = 0;
        }
        finish(new Error("media"));
      };
      const onSeeked = () => finish();
      let gotMeta = false;
      const onMeta = () => {
        gotMeta = true;
        if (Number.isFinite(audio.duration) && audio.duration > 1) {
          scrub.max = String(audio.duration);
          durEl.textContent = fmt(audio.duration);
        }
        const dest = clampTime(time);
        if (dest <= 0.05 || Math.abs((audio.currentTime || 0) - dest) < 0.05) {
          finish();
          return;
        }
        audio.addEventListener("seeked", onSeeked);
        try {
          audio.currentTime = dest;
        } catch (err) {
          finish();
        }
      };
      const timer = setTimeout(() => finish(gotMeta ? undefined : new Error("media")), 8000);
      audio.addEventListener("loadedmetadata", onMeta);
      audio.addEventListener("error", onErr);
      signedUrl = url;
      fetchedAt = Date.now();
      audio.src = url;
    });
  }

  function clampTime(time) {
    if (!Number.isFinite(time) || time <= 0) return 0;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      return Math.min(time, Math.max(0, audio.duration - 0.1));
    }
    return time;
  }

  function swapTo(time, play) {
    const gen = ++swapGen;
    const dest = Number.isFinite(time) ? time : 0;
    holdTime = dest;
    swapping = true;
    syncChrome();
    const run = chain.then(async () => {
      if (gen !== swapGen) return;
      const url = await requestSigned();
      if (gen !== swapGen) return;
      await attach(url, dest);
      if (gen !== swapGen) return;
      if (play && wantPlay) await audio.play();
      errorTries = 0;
      hideCalm();
    }).finally(() => {
      if (gen === swapGen) {
        swapping = false;
        holdTime = null;
        syncChrome();
      }
    });
    chain = run.catch(() => {});
    return run;
  }

  function primePlayback() {
    wantPlay = true;
    if (!audio.src || audio.src.startsWith("data:")) return;
    const pending = audio.play();
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  }

  async function playFrom(time) {
    hideCalm();
    wantPlay = true;
    errorTries = 0;
    if (!stillValid()) await swapTo(time, true);
    else {
      if (Number.isFinite(time) && Math.abs((audio.currentTime || 0) - time) > 0.05) {
        audio.currentTime = time;
      }
      await audio.play();
    }
  }

  playBtn.addEventListener("click", async () => {
    if (!audio.paused && !audio.ended) {
      wantPlay = false;
      audio.pause();
      return;
    }
    primePlayback();
    const restart = audio.ended;
    try {
      await playFrom(restart ? 0 : audio.currentTime || 0);
    } catch (err) {
      showCalm();
    }
  });

  lyricsEl.addEventListener("click", (e) => {
    const line = e.target.closest(".lyric-line");
    if (!line || !lyricsEl.contains(line)) return;
    primePlayback();
    const t = Number(line.dataset.t);
    highlight(t, true);
    playFrom(t).catch(() => showCalm());
  });

  lyricsEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const line = e.target.closest(".lyric-line");
    if (!line || !lyricsEl.contains(line)) return;
    e.preventDefault();
    primePlayback();
    const t = Number(line.dataset.t);
    highlight(t, true);
    playFrom(t).catch(() => showCalm());
  });

  scrub.addEventListener("input", () => {
    dragging = true;
    const t = Number(scrub.value);
    curEl.textContent = fmt(t);
    paintScrub();
    highlight(t, false);
    if (stillValid()) {
      try { audio.currentTime = t; } catch (err) {}
    }
  });

  scrub.addEventListener("change", () => {
    dragging = false;
    const t = Number(scrub.value);
    const keepPlaying = wantPlay || (!audio.paused && !audio.ended);
    if (!stillValid()) {
      if (keepPlaying) wantPlay = true;
      swapTo(t, keepPlaying).catch(() => showCalm());
      return;
    }
    try { audio.currentTime = t; } catch (err) {}
    syncChrome();
  });

  audio.addEventListener("play", () => {
    document.body.classList.add("is-playing");
    playBtn.setAttribute("aria-label", "Pause");
  });
  audio.addEventListener("pause", () => {
    document.body.classList.remove("is-playing");
    playBtn.setAttribute("aria-label", "Play");
  });
  audio.addEventListener("timeupdate", () => {
    syncChrome();
    if (!audio.paused && !audio.ended && !stillValid() && !swapping) {
      swapTo(audio.currentTime || 0, true).catch(() => showCalm());
    }
  });
  audio.addEventListener("seeked", () => {
    if (!swapping) syncChrome();
  });
  audio.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 1) {
      scrub.max = String(audio.duration);
      durEl.textContent = fmt(audio.duration);
    }
  });
  audio.addEventListener("stalled", () => {
    if (swapping || audio.paused || stillValid()) return;
    swapTo(audio.currentTime || 0, wantPlay).catch(() => showCalm());
  });
  audio.addEventListener("waiting", () => {
    if (swapping || audio.paused || stillValid()) return;
    swapTo(audio.currentTime || 0, wantPlay).catch(() => showCalm());
  });
  audio.addEventListener("error", () => {
    if (swapping || !audio.src || audio.src.startsWith("data:")) return;
    if (errorTries >= 2) {
      showCalm();
      return;
    }
    errorTries += 1;
    const t = holdTime != null ? holdTime : audio.currentTime || 0;
    swapTo(t, wantPlay).catch(() => showCalm());
  });

  function userScrolled() {
    if (!wantPlay || active < 0) return;
    scrollLockUntil = performance.now() + 4000;
  }
  window.addEventListener("wheel", userScrolled, { passive: true });
  window.addEventListener("touchmove", userScrolled, { passive: true });

  paintScrub();
}
