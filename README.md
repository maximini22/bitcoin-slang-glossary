# Bitcoin Slang

Static educational hub for [bitcoinslang.com](https://bitcoinslang.com) and [btcslang.com](https://btcslang.com). Artist: **Robbie P**.

Bitcoin Slang is a continuous thread of Bitcoin and crypto educational music. This site is the lyric-annotation glossary: gold phrases in the lyrics open notes that teach slang, Bitcoin culture, and the zeitgeist of the song. It is not a streaming page and not a link list.

Music links stay on [robbiep.net](https://robbiep.net) (repo `maximini22/music-links`). Do not merge the two.

No backend, no database, no Genius scrape. Host the folder as static files.

## Run locally

`fetch()` does not work from `file://`. Serve the folder:

```bash
python3 -m http.server 8080
```

- Catalog: http://localhost:8080
- First song: http://localhost:8080/song.html?slug=bitcoin-slang-remix
- Second song: http://localhost:8080/song.html?slug=most-toxic-bitcoin-maxi
- Third song: http://localhost:8080/song.html?slug=diamond-hands-and-laser-eyes

`bitcoin-slang-remix.standalone.html` bakes the same lyrics and notes into one file so it opens by double-click. The folder version is the one to deploy.

## Domains

`bitcoinslang.com` and `btcslang.com` are registered separately from this repo. Point either domain at a static host (GitHub Pages or similar). Nothing in this project needs a server process.

## How the page works

`song.html?slug=` loads three files:

1. `songs/<slug>/lyrics.txt`
2. `songs/<slug>/annotations.json`
3. `songs/<slug>/meta.json`

Lyrics sit on the left. The annotation panel sticks on the right. A gold mark is an annotated phrase. Section labels such as `[Verse 1]` and `[Hook]` are not notes.

If `meta.json` includes `description`, that blurb is the line under the title. If it does not, the line falls back to artist and theme.

Highlight rules:

- `phrase` is a substring of `lyrics.txt`. Match is case-insensitive.
- Longer phrases are applied first, so a short phrase inside a longer one does not steal the highlight.
- Only the first occurrence of a phrase is highlighted. Later repeats (the hook) stay plain unless you annotate a unique stretch.
- If `phrase` is not in the lyrics, it is skipped. That is a bug. Every note must match.

## Add a song

1. Get the transcript from the artist. Do not scrape Genius, and do not import other people’s annotations.
2. Create `songs/your-slug/` (`your-slug` is lowercase and hyphenated, and matches `meta.json`).
3. Add `lyrics.txt`. Keep verse and hook labels as `[Verse 1]`, `[Hook]`, and so on. Do not rewrite spelling or invent missing bars.
4. Add `meta.json`:

```json
{
  "slug": "your-slug",
  "title": "Song Title",
  "artist": "Robbie P",
  "year": null,
  "theme": "one-line theme",
  "description": "Two or three sentences on the release and the moment the song is talking about."
}
```

5. Add `annotations.json`, an array (no wrapper object):

```json
[
  {
    "id": "hodl",
    "phrase": "to hodl is to hold",
    "note": "One to three sentences that teach the term."
  }
]
```

`id` is unique kebab-case. `phrase` is an exact substring, usually one clause. Aim for the teaching lines, not every bar.

6. Confirm every phrase occurs in `lyrics.txt`.
7. Add one catalog card on `index.html`:

```html
<li class="song-card">
  <a href="song.html?slug=your-slug" class="thumb-link" aria-hidden="true" tabindex="-1">
    <img class="thumb" src="assets/your-cover.jpg" alt="" />
  </a>
  <div>
    <strong><a href="song.html?slug=your-slug">Song Title</a></strong>
    <span class="sub">Robbie P · one-line theme</span>
  </div>
</li>
```

8. Do not change `app.js` or `styles.css` just to add a song. Rebuild the standalone file only if you want an offline copy of that song.

## First song

| Field | Value |
| --- | --- |
| slug | `bitcoin-slang-remix` |
| title | Bitcoin Slang Remix |
| artist | Robbie P |
| theme | Bitcoin glossary / sound money primer |
| notes | 34 |

## Second song

| Field | Value |
| --- | --- |
| slug | `most-toxic-bitcoin-maxi` |
| title | Most Toxic Bitcoin Maxi |
| artist | Robbie P |
| year | 2023 |
| theme | Pizza Day 2023 · toxic maxi satire |
| notes | 31 |

## Third song

| Field | Value |
| --- | --- |
| slug | `diamond-hands-and-laser-eyes` |
| title | Diamond Hands & Laser Eyes |
| artist | Robbie P |
| year | 2023 |
| theme | El Salvador · diamond hands culture |
| notes | 22 |

## Layout

```
index.html
song.html
app.js
styles.css          dark theme, Bitcoin orange #f7931a
bitcoin-slang-remix.standalone.html
assets/             cover.jpg, artist.jpg, chester-bg.jpg, song covers
songs/bitcoin-slang-remix/
  lyrics.txt
  annotations.json
  meta.json
songs/most-toxic-bitcoin-maxi/
  lyrics.txt
  annotations.json
  meta.json
songs/diamond-hands-and-laser-eyes/
  lyrics.txt
  annotations.json
  meta.json
```
