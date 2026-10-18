function songSlug() {
  const parts = location.pathname.split("/").filter(Boolean);
  const i = parts.lastIndexOf("songs");
  if (i >= 0 && parts[i + 1] && !parts[i + 1].includes(".")) {
    return decodeURIComponent(parts[i + 1]);
  }
  return new URLSearchParams(location.search).get("slug") || "bitcoin-slang-remix";
}
const slug = songSlug();

const ROBBIE_P_URL = "https://robbiep.net";

function applySongFooter() {
  const year = document.getElementById("jlr-year");
  if (year) year.textContent = String(new Date().getFullYear());
  const link = document.querySelector("a.song-foot-artist");
  if (link) link.href = ROBBIE_P_URL;
}
applySongFooter();

const lyricsEl = document.getElementById("lyrics");
const phraseEl = document.getElementById("phrase");
const noteEl = document.getElementById("note");
const noteImg = document.getElementById("note-image");
const titleEl = document.getElementById("title");
const subEl = document.getElementById("sub");

const SHARE_HOOK = "The Bitcoin Slang Dictionary, line by line, with notes on every term.";
const SHARE_COVERS = {
  "bitcoin-slang-remix": ["assets/cover.jpg", 1200, 675],
  "most-toxic-bitcoin-maxi": ["assets/most-toxic-bitcoin-maxi-cover.jpg", 1920, 1080],
  "diamond-hands-and-laser-eyes": ["assets/diamond-hands-and-laser-eyes-cover.jpg", 1920, 1080],
  "all-time-high-lessons-of-regret": ["assets/all-time-high-lessons-of-regret-cover.jpg", 1920, 1080],
  "going-cashless": ["assets/going-cashless-cover.jpg", 1920, 1080],
  "if-it-wasnt-for-satoshi": ["assets/if-it-wasnt-for-satoshi-cover.jpg", 1920, 1080],
  "freedom": ["assets/freedom-cover.jpg", 1920, 1080],
  "fliponomics": ["assets/fliponomics-cover.jpg", 1920, 1080],
  "dread-pirate-robbie": ["assets/dread-pirate-robbie-cover.jpg", 1920, 1080],
};

function shareCopy(title) {
  return {
    title: `${title} annotated lyrics by Robbie P`,
    description: `${title}. ${SHARE_HOOK}`,
  };
}

function setShareMeta(title, description, songTitle) {
  const write = (attr, key, content) => {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  };
  const cover = SHARE_COVERS[slug] || ["assets/cover.jpg", 1200, 675];
  const image = new URL("/" + cover[0], "https://bitcoinslang.com").href;
  const page = `https://bitcoinslang.com/songs/${slug}/`;
  const alt = `Cover art for ${songTitle}`;
  write("name", "description", description);
  write("property", "og:title", title);
  write("property", "og:description", description);
  write("property", "og:image", image);
  write("property", "og:image:width", String(cover[1]));
  write("property", "og:image:height", String(cover[2]));
  write("property", "og:image:alt", alt);
  write("property", "og:url", page);
  write("property", "og:type", "music.song");
  write("name", "twitter:title", title);
  write("name", "twitter:description", description);
  write("name", "twitter:image", image);
  write("name", "twitter:image:alt", alt);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute("href", page);
}

function ensureJsonLd(meta, lyrics) {
  if (document.querySelector('script[type="application/ld+json"]')) return;
  const cover = SHARE_COVERS[slug] || ["assets/cover.jpg", 1200, 675];
  const share = shareCopy(meta.title);
  const data = {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    name: meta.title,
    byArtist: { "@type": "Person", name: "Robbie P" },
    url: `https://bitcoinslang.com/songs/${slug}/`,
    image: new URL("/" + cover[0], "https://bitcoinslang.com").href,
    description: share.description,
    recordingOf: {
      "@type": "MusicComposition",
      name: meta.title,
      composer: { "@type": "Person", name: "Robbie P" },
      lyricist: { "@type": "Person", name: "Robbie P" },
      lyrics: { "@type": "CreativeWork", text: lyrics },
    },
  };
  if (meta.year) data.datePublished = String(meta.year);
  const el = document.createElement("script");
  el.type = "application/ld+json";
  el.textContent = JSON.stringify(data);
  document.head.appendChild(el);
}

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
  const share = shareCopy(meta.title);
  document.title = share.title;
  setShareMeta(share.title, share.description, meta.title);
  ensureJsonLd(meta, lyrics);

  if (slug === "bitcoin-slang-remix" || slug === "if-it-wasnt-for-satoshi") {
    await renderRemix(lyrics, annotations);
    return;
  }

  lyricsEl.innerHTML = applyAnnotations(lyrics, annotations);

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
function audioTrack() {
  if (slug === "if-it-wasnt-for-satoshi") return "if-it-wasnt-for-satoshi.mp3";
  return REMIX_TRACK;
}
const REMIX_LINKS_URL = "https://links.robbiep.net/bitcoin-slang/";
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

  const byId = Object.fromEntries(annotations.map((a) => [a.id, a]));
  const full = textItems.map((item) => item.text).join("\n");
  const marks = collectMarks(full, annotations);
  const frag = document.createDocumentFragment();
  const lines = [];
  let offset = 0;
  let timeIndex = 0;

  const cta = document.createElement("button");
  cta.type = "button";
  cta.className = "read-along";
  cta.textContent = "Play music and read along";
  subEl.insertAdjacentElement("afterend", cta);

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
    el.dataset.t = String(entry.t);
    el.dataset.i = String(lines.length);
    el.innerHTML = renderMarkedLine(item.text, offset, marks);
    const ids = [];
    const anns = [];
    const lineEnd = offset + item.text.length;
    for (const mark of marks) {
      if (mark.end > offset && mark.start < lineEnd && !ids.includes(mark.id)) ids.push(mark.id);
    }
    let note = null;
    if (ids.length) {
      note = document.createElement("div");
      note.className = "line-note";
      note.hidden = true;
      note.dataset.i = el.dataset.i;
      const card = document.createElement("div");
      card.className = "line-note-card";
      for (const id of ids) {
        const ann = byId[id];
        if (!ann) continue;
        anns.push(ann);
        const entryNote = document.createElement("div");
        entryNote.className = "line-note-entry";
        const heading = document.createElement("h3");
        heading.textContent = ann.phrase;
        const body = document.createElement("p");
        body.textContent = ann.note;
        const playHere = document.createElement("button");
        playHere.type = "button";
        playHere.className = "play-from";
        playHere.textContent = "play song from here";
        entryNote.append(heading, body);
        if (ann.image) {
          const img = document.createElement("img");
          img.className = "line-note-fig";
          img.src = ann.image;
          img.alt = "";
          entryNote.append(img);
        }
        entryNote.append(playHere);
        card.append(entryNote);
      }
      note.append(card);
    }
    frag.appendChild(el);
    if (note) frag.appendChild(note);
    lines.push({ t: entry.t, el, note, anns });
    offset += item.text.length + 1;
    timeIndex += 1;
  }

  lyricsEl.innerHTML = "";
  lyricsEl.appendChild(frag);
  mountRemixPlayer(lines);
}

function mountFreeMp3() {
  const block = document.createElement("section");
  block.className = "mp3-signup";
  block.innerHTML = `
    <h2>Get the free MP3</h2>
    <p class="mp3-lead">Pop your email in and we'll send you a free download of Bitcoin Slang Remix.</p>
    <form>
      <label class="mp3-label" for="mp3-email">Email</label>
      <input id="mp3-email" name="email" type="email" autocomplete="email" required placeholder="Email" />
      <button type="submit">Send me the MP3</button>
      <p class="mp3-note">We'll email you a link to confirm first.</p>
    </form>
    <p class="mp3-status" role="status" hidden></p>
  `;

  const form = block.querySelector("form");
  const lead = block.querySelector(".mp3-lead");
  const status = block.querySelector(".mp3-status");
  const input = block.querySelector("#mp3-email");
  const button = block.querySelector("button");

  const showMessage = (text, isError) => {
    form.hidden = !isError;
    lead.hidden = !isError;
    status.hidden = false;
    status.textContent = text;
    status.classList.toggle("is-error", Boolean(isError));
  };

  if (new URLSearchParams(location.search).get("confirmed") === "1") {
    showMessage("You're confirmed — your download link is on its way.", false);
    return block;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = input.value.trim();
    if (!email || !input.checkValidity()) {
      status.hidden = false;
      status.textContent = "Enter your email and try again.";
      status.classList.add("is-error");
      return;
    }
    button.disabled = true;
    status.hidden = true;
    status.textContent = "";
    status.classList.remove("is-error");
    try {
      const res = await fetch("https://audio.btcslang.com/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, slug }),
      });
      if (!res.ok) throw new Error("subscribe failed");
      input.value = "";
      showMessage("Check your inbox to confirm.", false);
    } catch {
      button.disabled = false;
      status.hidden = false;
      status.textContent = "That didn't send. Please try again.";
      status.classList.add("is-error");
    }
  });
  return block;
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
        <button class="player-mute" id="player-mute" type="button" aria-label="Mute" aria-pressed="false">
          <svg class="icon-sound" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4zm11.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 15.5 12z"/></svg>
          <svg class="icon-muted" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4zm13.2.8 1.4 1.4-1.8 1.8 1.8 1.8-1.4 1.4-1.8-1.8-1.8 1.8-1.4-1.4 1.8-1.8-1.8-1.8 1.4-1.4 1.8 1.8z"/></svg>
          <span class="mute-label">Muted</span>
        </button>
        <input class="player-vol" id="player-vol" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume" title="Volume">
      </div>
    </div>
  `;
  document.body.appendChild(bar);

  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.crossOrigin = "anonymous";
  audio.setAttribute("playsinline", "");
  bar.appendChild(audio);

  document.body.classList.add("player-ready");
  const listen = document.createElement("a");
  listen.className = "listen-everywhere";
  listen.href = REMIX_LINKS_URL;
  listen.textContent = "Listen everywhere";
  const layout = document.querySelector(".layout");
  if (slug === "bitcoin-slang-remix" && layout) {
    const signup = mountFreeMp3();
    layout.insertAdjacentElement("afterend", signup);
    signup.insertAdjacentElement("afterend", listen);
  }
  const playBtn = bar.querySelector("#player-play");
  const muteBtn = bar.querySelector("#player-mute");
  const vol = bar.querySelector("#player-vol");
  const statusEl = bar.querySelector("#player-note");
  const readAlong = document.querySelector(".read-along");
  const sidePanel = document.querySelector(".panel");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const wideQuery = window.matchMedia("(min-width: 900px)");
  const PHONE_ANCHOR = 0.4;
  const DESK_ANCHOR = 1 / 3;

  let signedUrl = "";
  let fetchedAt = 0;
  let wantPlay = false;
  let swapping = false;
  let swapGen = 0;
  let chain = Promise.resolve();
  let mediaGen = 0;
  let holdTime = null;
  let active = -1;
  let openNote = -1;
  let scrollLockUntil = 0;
  let errorTries = 0;
  let audioStarted = false;
  let muted = false;
  let suspending = false;
  let heldTime = 0;
  let heldIndex = -1;
  let scrollToken = 0;
  let resumeTimer = 0;
  let savedLevel = 1;
  let zeroTimer = 0;
  let silenced = false;

  audio.volume = 1;
  paintVol();

  function showCalm() {
    statusEl.textContent = "This song cannot be played right now. Please try again.";
  }

  function hideCalm() {
    statusEl.textContent = "";
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

  function anchorY() {
    const barH = bar.hidden ? 0 : bar.getBoundingClientRect().height;
    const visible = Math.max(0, window.innerHeight - barH);
    return visible * (wideQuery.matches ? DESK_ANCHOR : PHONE_ANCHOR);
  }

  function smoothScrollTo(dest) {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    dest = Math.min(Math.max(0, dest), max);
    const start = window.scrollY;
    const change = dest - start;
    if (Math.abs(change) < 1) return;
    const token = ++scrollToken;
    if (reduce.matches) {
      window.scrollTo(0, dest);
      return;
    }
    const duration = 420;
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
    const step = (now) => {
      if (token !== scrollToken) return;
      const p = Math.min(1, (now - t0) / duration);
      window.scrollTo(0, start + change * ease(p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function anchorLine(el) {
    if (!el || performance.now() < scrollLockUntil) return;
    const delta = el.getBoundingClientRect().top - anchorY();
    if (Math.abs(delta) < 1.5) return;
    smoothScrollTo(window.scrollY + delta);
  }

  function clearSidePanel() {
    if (!phraseEl || !noteEl) return;
    phraseEl.textContent = "";
    noteEl.innerHTML = '<p class="hint">Hover or tap a highlighted line.</p>';
    if (noteImg) {
      noteImg.hidden = true;
      noteImg.removeAttribute("src");
      noteImg.alt = "";
    }
  }

  function renderSidePanel(i) {
    if (!wideQuery.matches) {
      clearSidePanel();
      return;
    }
    const line = lines[i];
    if (!line || !line.anns.length) {
      clearSidePanel();
      return;
    }
    phraseEl.textContent = "";
    noteEl.replaceChildren();
    if (noteImg) {
      noteImg.hidden = true;
      noteImg.removeAttribute("src");
    }
    for (const ann of line.anns) {
      const entry = document.createElement("div");
      entry.className = "panel-entry";
      const heading = document.createElement("div");
      heading.className = "phrase";
      heading.textContent = ann.phrase;
      const body = document.createElement("p");
      body.textContent = ann.note;
      entry.append(heading, body);
      if (ann.image) {
        const img = document.createElement("img");
        img.className = "note-fig";
        img.src = ann.image;
        img.alt = "";
        entry.append(img);
      }
      const playHere = document.createElement("button");
      playHere.type = "button";
      playHere.className = "play-from";
      playHere.dataset.i = String(i);
      playHere.textContent = "play song from here";
      entry.append(playHere);
      noteEl.append(entry);
    }
  }

  function hideInline() {
    if (openNote >= 0 && lines[openNote] && lines[openNote].note) {
      lines[openNote].note.hidden = true;
      lines[openNote].el.setAttribute("aria-expanded", "false");
    }
    openNote = -1;
  }

  function hideNotes() {
    hideInline();
    if (wideQuery.matches) clearSidePanel();
  }

  function showLineNote(i) {
    const line = lines[i];
    if (!line) return;
    if (wideQuery.matches) {
      hideInline();
      openNote = i;
      if (line.anns.length) line.el.setAttribute("aria-expanded", "true");
      renderSidePanel(i);
      return;
    }
    if (!line.note) {
      hideNotes();
      return;
    }
    if (openNote === i && !line.note.hidden) return;
    hideInline();
    line.note.hidden = false;
    line.el.setAttribute("aria-expanded", "true");
    openNote = i;
  }

  function applyIndex(i, scroll, notes) {
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
    if (notes) showLineNote(i);
    if (scroll) anchorLine(lines[i].el);
  }

  function highlight(t, scroll) {
    applyIndex(indexAt(t), scroll, !muted && (scroll || !audio.paused));
  }

  function syncChrome() {
    if (muted) {
      applyIndex(heldIndex, false, false);
      return;
    }
    const t = holdTime != null ? holdTime : (audio.currentTime || 0);
    highlight(t, wantPlay && !audio.paused);
  }

  function revealBar() {
    audioStarted = true;
    document.body.classList.add("player-ready");
  }

  function paintVol() {
    const value = Number(vol.value);
    vol.style.setProperty("--p", `${Math.max(0, Math.min(100, value * 100))}%`);
    document.body.classList.toggle("is-silent", value === 0 && !muted);
  }

  function rememberedLevel() {
    return savedLevel > 0 ? savedLevel : 0.6;
  }

  function setSlider(level) {
    const next = Math.max(0, Math.min(1, level));
    if (next > 0) savedLevel = next;
    vol.value = String(next);
    audio.volume = next;
    if (next > 0) {
      window.clearTimeout(zeroTimer);
      zeroTimer = 0;
      silenced = false;
    }
    paintVol();
  }

  async function resumeHeld() {
    const t = Number.isFinite(audio.currentTime) ? audio.currentTime : heldTime;
    wantPlay = true;
    if (!audio.getAttribute("src") || !stillValid()) await playFrom(t);
    else await audio.play();
  }

  function commitZero() {
    zeroTimer = 0;
    if (muted || Number(vol.value) > 0) return;
    audio.volume = 0;
    silenced = true;
    paintVol();
    if (!audio.paused && !audio.ended) {
      wantPlay = false;
      audio.pause();
    }
    syncPlayIcon();
  }

  function onVolumeInput() {
    const value = Number(vol.value);
    if (value > 0) {
      savedLevel = value;
      audio.volume = value;
      window.clearTimeout(zeroTimer);
      zeroTimer = 0;
      paintVol();
      if (silenced) {
        silenced = false;
        if (audioStarted) resumeHeld().catch(() => showCalm());
      }
      return;
    }
    audio.volume = 0;
    paintVol();
    if (!zeroTimer) zeroTimer = window.setTimeout(commitZero, 250);
  }

  function releaseStream() {
    suspending = true;
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } finally {
      suspending = false;
    }
    signedUrl = "";
    fetchedAt = 0;
  }

  function setMuted(next) {
    muted = next;
    document.body.classList.toggle("is-muted", next);
    muteBtn.setAttribute("aria-pressed", String(next));
    muteBtn.setAttribute("aria-label", next ? "Unmute" : "Mute");
  }

  function syncPlayIcon() {
    const playing = !muted && !audio.paused && !audio.ended;
    document.body.classList.toggle("is-playing", playing);
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  async function requestSigned() {
    let lastError = new Error("sign");
    for (const host of SIGN_HOSTS) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(`${host}/sign?track=${encodeURIComponent(audioTrack())}`, {
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

  async function seekPaused(time) {
    wantPlay = false;
    if (!stillValid()) await swapTo(time, false);
    else if (Math.abs((audio.currentTime || 0) - time) > 0.05) {
      audio.currentTime = time;
    }
    highlight(time, true);
  }

  async function muteAudio() {
    if (muted) return;
    heldTime = holdTime != null ? holdTime : (audio.currentTime || 0);
    heldIndex = active >= 0 ? active : indexAt(heldTime);
    wantPlay = false;
    setMuted(true);
    releaseStream();
    syncPlayIcon();
    applyIndex(heldIndex, false, false);
  }

  async function unmuteAudio() {
    if (!muted) return;
    const resumeAt = heldTime;
    setMuted(false);
    revealBar();
    setSlider(Number(vol.value) > 0 ? Number(vol.value) : rememberedLevel());
    try {
      await playFrom(resumeAt);
    } catch (err) {
      showCalm();
    }
  }

  function lineIndexFrom(node) {
    const line = node.closest(".lyric-line");
    const note = node.closest(".line-note");
    const source = line || note;
    if (!source || !lyricsEl.contains(source)) return -1;
    const i = Number(source.dataset.i);
    return Number.isInteger(i) ? i : -1;
  }

  async function activateLine(i, { play }) {
    const line = lines[i];
    if (!line) return;
    showLineNote(i);
    if (!audioStarted && !play) return;
    if (play) {
      if (muted) setMuted(false);
      if (!(Number(vol.value) > 0)) setSlider(rememberedLevel());
      revealBar();
      try {
        await playFrom(line.t);
      } catch (err) {
        showCalm();
      }
      return;
    }
    if (!audioStarted) return;
    if (muted) {
      heldTime = line.t;
      heldIndex = i;
      applyIndex(i, true, false);
      return;
    }
    const resume = !audio.paused && !audio.ended;
    try {
      if (resume) await playFrom(line.t);
      else await seekPaused(line.t);
    } catch (err) {
      showCalm();
    }
  }

  async function playAudible(time) {
    if (!(Number(vol.value) > 0)) setSlider(rememberedLevel());
    revealBar();
    await playFrom(time);
  }

  if (readAlong) {
    readAlong.addEventListener("click", async () => {
      try {
        await playAudible(0);
      } catch (err) {
        showCalm();
      }
    });
  }

  vol.addEventListener("input", onVolumeInput);
  vol.addEventListener("change", () => {
    if (Number(vol.value) === 0) {
      window.clearTimeout(zeroTimer);
      commitZero();
      return;
    }
    onVolumeInput();
  });

  playBtn.addEventListener("click", async () => {
    if (muted) {
      unmuteAudio();
      return;
    }
    if (!audio.paused && !audio.ended) {
      wantPlay = false;
      audio.pause();
      syncPlayIcon();
      return;
    }
    const restart = audio.ended || !audioStarted;
    try {
      await playAudible(restart ? 0 : (audio.currentTime || heldTime || 0));
    } catch (err) {
      showCalm();
    }
  });

  muteBtn.addEventListener("click", () => {
    if (muted) unmuteAudio();
    else muteAudio();
  });

  lyricsEl.addEventListener("click", (e) => {
    const from = e.target.closest(".play-from");
    if (from) {
      e.preventDefault();
      const i = lineIndexFrom(from);
      if (i >= 0) activateLine(i, { play: true });
      return;
    }
    const line = e.target.closest(".lyric-line");
    if (!line || !lyricsEl.contains(line)) return;
    const i = Number(line.dataset.i);
    if (!audioStarted) {
      if (lines[i] && lines[i].note) showLineNote(i);
      else hideNotes();
      return;
    }
    activateLine(i, { play: false });
  });

  lyricsEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const line = e.target.closest(".lyric-line");
    if (!line || document.activeElement !== line) return;
    e.preventDefault();
    line.click();
  });

  if (sidePanel) {
    sidePanel.addEventListener("click", (e) => {
      const from = e.target.closest(".play-from");
      if (!from) return;
      e.preventDefault();
      const i = Number(from.dataset.i);
      if (Number.isInteger(i)) activateLine(i, { play: true });
    });
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest(".lyric-line, .line-note, .read-along, .player, .panel")) return;
    if (!audioStarted || audio.paused || muted) hideNotes();
  });

  wideQuery.addEventListener("change", () => {
    if (openNote >= 0) showLineNote(openNote);
    else if (wideQuery.matches) clearSidePanel();
  });

  audio.addEventListener("play", () => {
    syncPlayIcon();
    if (!muted && active >= 0) showLineNote(active);
  });
  audio.addEventListener("pause", () => {
    syncPlayIcon();
  });
  audio.addEventListener("timeupdate", () => {
    if (muted || suspending) return;
    syncChrome();
    if (!audio.paused && !audio.ended && !stillValid() && !swapping) {
      swapTo(audio.currentTime || 0, true).catch(() => showCalm());
    }
  });
  audio.addEventListener("seeked", () => {
    if (muted || suspending || swapping) return;
    syncChrome();
  });
  audio.addEventListener("stalled", () => {
    if (muted || suspending || swapping || audio.paused || stillValid()) return;
    swapTo(audio.currentTime || 0, wantPlay).catch(() => showCalm());
  });
  audio.addEventListener("waiting", () => {
    if (muted || suspending || swapping || audio.paused || stillValid()) return;
    swapTo(audio.currentTime || 0, wantPlay).catch(() => showCalm());
  });
  audio.addEventListener("error", () => {
    if (muted || suspending || swapping || !audio.getAttribute("src")) return;
    if (errorTries >= 2) {
      showCalm();
      return;
    }
    errorTries += 1;
    const t = holdTime != null ? holdTime : audio.currentTime || 0;
    swapTo(t, wantPlay).catch(() => showCalm());
  });

  function userScrolled(e) {
    if (e.target && e.target.closest && e.target.closest(".panel")) return;
    if (!wantPlay || audio.paused || muted || active < 0) return;
    scrollToken += 1;
    scrollLockUntil = performance.now() + 4000;
    window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(() => {
      scrollLockUntil = 0;
      if (active >= 0 && !audio.paused && !muted) anchorLine(lines[active].el);
    }, 4000);
  }
  window.addEventListener("wheel", userScrolled, { passive: true });
  window.addEventListener("touchmove", userScrolled, { passive: true });
}
