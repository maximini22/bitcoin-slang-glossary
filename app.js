const params = new URLSearchParams(location.search);
const slug = params.get("slug") || "bitcoin-slang-remix";

const lyricsEl = document.getElementById("lyrics");
const phraseEl = document.getElementById("phrase");
const noteEl = document.getElementById("note");
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
    return;
  }
  phraseEl.textContent = a.phrase;
  noteEl.textContent = a.note;
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
  const meta = metaRes.ok ? await metaRes.json() : { title: slug, artist: "Robbie P" };

  titleEl.textContent = meta.title;
  const aka = meta.alsoKnownAs ? ` · also known as ${meta.alsoKnownAs}` : "";
  subEl.textContent = `${meta.artist}${meta.theme ? " · " + meta.theme : ""}${aka}`;
  document.title = `${meta.title} — Bitcoin Slang`;

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
