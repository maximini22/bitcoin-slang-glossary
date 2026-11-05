#!/usr/bin/env python3
"""Render 1200×630 Open Graph share images for every song (desktop mock).

Adapts tools/og_home.html: dark theme, browser chrome, square cover, title,
ROBBIE P, a few lyric lines with one highlight, annotation panel on the right.

Usage (from repo root):
  python3 tools/build_og_songs.py            # all songs + og/home.jpg
  python3 tools/build_og_songs.py freedom    # one slug
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SONGS = ROOT / "songs"
OG = ROOT / "og"
ASSETS = ROOT / "assets"
CHROME = "google-chrome"
W, H = 1200, 630

# Prefer a specific highlight for the home/feature song (matches prior mock).
PREFERRED = {
    "most-toxic-bitcoin-maxi": "diamond hands have been forced",
}

# Songs with empty annotations.json — short fallback notes so the mock still demos the UI.
FALLBACK = {
    "vitamin": {
        "phrase": "B-I-T-C-O-I-N",
        "note": (
            "The hook spells Bitcoin like a daily vitamin: take it regularly. "
            "In the song it's dollar-cost averaging and stacking sats as a habit, "
            "not a one-off bet."
        ),
        "line": "B-I-T-C-O-I-N",
    },
    "take-money-off-mainstreet": {
        "phrase": "take that money off Mainstreet",
        "note": (
            "Mainstreet stands for the mainstream money rails — banks, cash and "
            "fiat rails. Taking money off Mainstreet means moving value onto "
            "Bitcoin, keys and the mempool instead."
        ),
        "line": "I take that money off Mainstreet",
    },
}

SECTION = re.compile(
    r"^(Intro|Verse|Hook|Chorus|Outro|Bridge|Pre-?verse|Skit|Interlude)\b",
    re.I,
)


def lyric_lines(slug: str) -> list[str]:
    raw = (SONGS / slug / "lyrics.txt").read_text(encoding="utf-8")
    out = []
    for ln in raw.splitlines():
        s = ln.strip()
        if not s or s.startswith("#") or s.startswith("["):
            continue
        if SECTION.match(s):
            continue
        out.append(s)
    return out


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def find_line(lines: list[str], phrase: str) -> tuple[int | None, str | None]:
    pl = phrase.lower()
    for i, l in enumerate(lines):
        if pl in l.lower():
            return i, l
    np = norm(phrase)
    for i, l in enumerate(lines):
        if np and np in norm(l):
            return i, l
    words = np.split()
    for n in range(min(6, len(words)), 1, -1):
        sub = " ".join(words[:n])
        for i, l in enumerate(lines):
            if sub in norm(l):
                return i, l
    return None, None


def pick_annotation(slug: str, anns: list[dict], lines: list[str]):
    if not anns:
        fb = FALLBACK.get(slug)
        if not fb:
            return None
        i, l = find_line(lines, fb["line"])
        if i is None:
            i, l = find_line(lines, fb["phrase"])
        if i is None and lines:
            # last resort: first non-empty lyric
            i, l = 0, lines[0]
        return {
            "phrase": fb["phrase"],
            "note": fb["note"],
            "line_i": i if i is not None else 0,
            "line": l or fb["line"],
            "fallback": True,
        }

    prefer = PREFERRED.get(slug)
    candidates = []
    for a in anns:
        phrase, note = a["phrase"], a["note"]
        i, l = find_line(lines, phrase)
        score = 0.0
        if i is not None:
            score += 50
            if 1 <= i < len(lines) - 1:
                score += 5
        score += min(len(note), 220) / 10
        if 18 <= len(phrase) <= 55:
            score += 10
        if prefer and phrase.lower() == prefer.lower():
            score += 1000
        candidates.append((score, i, a, l))
    candidates.sort(key=lambda x: x[0], reverse=True)
    score, i, a, l = candidates[0]
    if i is None:
        # annotation phrase not in lyrics.txt — still show; invent a line context
        i = max(0, len(lines) // 4)
        l = a["phrase"]
    return {
        "phrase": a["phrase"],
        "note": a["note"],
        "line_i": i,
        "line": l,
        "fallback": False,
    }


def context_lines(lines: list[str], i: int, n: int = 4) -> list[tuple[str, bool]]:
    """Return up to n lyric lines around the highlight; mark the hit.

    Prefer two lines before + highlight + one after (matches tools/og_home.html).
    """
    if not lines:
        return []
    i = max(0, min(i, len(lines) - 1))
    start = max(0, i - 2)
    end = min(len(lines), start + n)
    start = max(0, end - n)
    # If window still doesn't include i (short tail), pin end after i.
    if i >= end:
        end = min(len(lines), i + 1)
        start = max(0, end - n)
    return [(lines[j], j == i) for j in range(start, end)]


def highlight_html(line: str, phrase: str) -> str:
    """Wrap the first case-insensitive phrase match in <span class=hl>."""
    if not phrase:
        return html.escape(line)
    m = re.search(re.escape(phrase), line, flags=re.I)
    if not m:
        # try longest leading word run from phrase that appears
        words = phrase.split()
        for n in range(len(words), 0, -1):
            sub = " ".join(words[:n])
            m = re.search(re.escape(sub), line, flags=re.I)
            if m:
                break
    if not m:
        return html.escape(line)  # whole line stays plain; panel still explains
    before = html.escape(line[: m.start()])
    mid = html.escape(line[m.start() : m.end()])
    after = html.escape(line[m.end() :])
    return f'{before}<span class="hl">{mid}</span>{after}'


def clip_note(note: str, limit: int = 320) -> str:
    note = re.sub(r"\s+", " ", note).strip()
    if len(note) <= limit:
        return note
    cut = note[: limit - 1]
    # prefer sentence end
    for sep in (". ", "; ", ", "):
        k = cut.rfind(sep)
        if k >= limit // 2:
            return cut[: k + (1 if sep.startswith(".") else 0)].rstrip(" ,;") + "."
    k = cut.rfind(" ")
    return (cut[:k] if k > 0 else cut).rstrip() + "…"


TEMPLATE = """<!doctype html><html><head><meta charset="utf-8"><style>
*{{box-sizing:border-box;margin:0}}body{{width:1200px;height:630px;background:radial-gradient(circle at 80% 10%,#2a1600,#000 60%);font-family:Helvetica,Arial,sans-serif;color:#eee;overflow:hidden;position:relative}}
.brand{{position:absolute;left:48px;top:30px;font-size:22px;font-weight:800;letter-spacing:3px;color:#f7931a}}.brand span{{color:#fff;font-weight:400;letter-spacing:1px}}
.tag{{position:absolute;right:48px;top:32px;font-size:20px;color:#bbb}}
.win{{position:absolute;left:48px;top:82px;width:1104px;height:510px;background:#0b0b0b;border:1px solid #333;border-radius:16px;box-shadow:0 20px 60px rgba(247,147,26,.18);overflow:hidden}}
.bar{{height:34px;background:#161616;display:flex;align-items:center;padding:0 14px;gap:8px}}.d{{width:12px;height:12px;border-radius:50%;background:#444}}.url{{margin-left:16px;background:#000;border-radius:6px;padding:4px 14px;font-size:14px;color:#999}}
.body{{display:flex;padding:28px;gap:28px}}
.cover{{width:220px;height:220px;border-radius:10px;background:url({cover_url}) center/cover;flex:none}}
.lyr{{flex:1;min-width:0}}.h{{font-size:32px;font-weight:800;line-height:1.15}}.a{{color:#f7931a;font-size:16px;margin:6px 0 18px;letter-spacing:2px}}
.l{{font-size:21px;line-height:1.75;color:#777}}.l.on{{color:#fff}}.hl{{color:#f7931a;border-bottom:2px solid #f7931a;background:rgba(247,147,26,.12)}}
.note{{width:330px;flex:none;align-self:center;background:#15100a;border:1px solid #f7931a;border-radius:12px;padding:20px;font-size:17px;line-height:1.5}}
.note b{{display:block;color:#f7931a;font-size:19px;margin-bottom:10px}}
.no-note .note{{display:none}}
</style></head><body class="{body_class}">
<div class="brand">ROBBIE P <span>· bitcoinslang.com</span></div><div class="tag">Annotated Bitcoin lyrics</div>
<div class="win"><div class="bar"><i class="d"></i><i class="d"></i><i class="d"></i><div class="url">bitcoinslang.com/songs/{slug}</div></div>
<div class="body"><div class="cover"></div>
<div class="lyr"><div class="h">{title}</div><div class="a">ROBBIE P{year_bit}</div>
{lyric_html}</div>
{note_html}
</div></div></body></html>
"""


def render_html(slug: str, meta: dict, pick: dict | None, lines: list[str]) -> str:
    title = html.escape(meta["title"])
    if meta.get("featuring"):
        title += f" ft. {html.escape(meta['featuring'])}"
    year = meta.get("year")
    year_bit = f" · {year}" if year else ""
    cover = (ASSETS / f"{slug}-cover.jpg").resolve().as_uri()

    if pick is None:
        # no annotation at all — show a few opening lyric lines, no panel
        ctx = [(l, False) for l in lines[:4]]
        note_html = ""
        body_class = "no-note"
    else:
        ctx = context_lines(lines, pick["line_i"], n=4)
        # ensure the highlighted line is in ctx; if pick.line differs from lines[i], use pick.line
        lyric_bits = []
        for text, on in ctx:
            if on:
                lyric_bits.append(
                    f'<div class="l on">{highlight_html(text, pick["phrase"])}</div>'
                )
            else:
                lyric_bits.append(f'<div class="l">{html.escape(text)}</div>')
        # if highlight line wasn't found in lines list properly, force it
        if not any(on for _, on in ctx) and pick.get("line"):
            lyric_bits = [f'<div class="l">{html.escape(t)}</div>' for t, _ in ctx[:3]]
            lyric_bits.append(
                f'<div class="l on">{highlight_html(pick["line"], pick["phrase"])}</div>'
            )
        note_html = (
            f'<div class="note"><b>{html.escape(pick["phrase"])}</b>'
            f'{html.escape(clip_note(pick["note"]))}</div>'
        )
        body_class = ""
        return TEMPLATE.format(
            cover_url=cover,
            slug=html.escape(slug),
            title=title,
            year_bit=year_bit,
            lyric_html="\n".join(lyric_bits),
            note_html=note_html,
            body_class=body_class,
        )

    lyric_html = "\n".join(
        f'<div class="l{" on" if on else ""}">{html.escape(t)}</div>' for t, on in ctx
    )
    return TEMPLATE.format(
        cover_url=cover,
        slug=html.escape(slug),
        title=title,
        year_bit=year_bit,
        lyric_html=lyric_html,
        note_html="",
        body_class=body_class,
    )


def screenshot(html_path: Path, out_jpg: Path) -> None:
    out_jpg.parent.mkdir(parents=True, exist_ok=True)
    # Chrome --screenshot always writes PNG named screenshot.png in cwd unless path given;
    # path ending in .jpg still writes PNG bytes in some versions — convert via Pillow.
    tmp_png = out_jpg.with_suffix(".chrome.png")
    cmd = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        f"--window-size={W},{H}",
        f"--screenshot={tmp_png}",
        html_path.resolve().as_uri(),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    from PIL import Image

    im = Image.open(tmp_png).convert("RGB")
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    im.save(out_jpg, quality=90, optimize=True)
    tmp_png.unlink(missing_ok=True)


def build_one(slug: str, tmpdir: Path) -> dict:
    meta = json.loads((SONGS / slug / "meta.json").read_text(encoding="utf-8"))
    anns = json.loads((SONGS / slug / "annotations.json").read_text(encoding="utf-8"))
    lines = lyric_lines(slug)
    pick = pick_annotation(slug, anns, lines)
    html_doc = render_html(slug, meta, pick, lines)
    html_path = tmpdir / f"{slug}.html"
    html_path.write_text(html_doc, encoding="utf-8")
    out = OG / f"{slug}.jpg"
    screenshot(html_path, out)
    info = {
        "slug": slug,
        "out": str(out.relative_to(ROOT)),
        "phrase": pick["phrase"] if pick else None,
        "fallback": bool(pick and pick.get("fallback")),
        "missing_annotations": len(anns) == 0,
    }
    return info


def main(argv: list[str]) -> int:
    OG.mkdir(exist_ok=True)
    slugs = argv[1:] or sorted(p.name for p in SONGS.iterdir() if (p / "meta.json").exists())
    report = []
    with tempfile.TemporaryDirectory(prefix="og-songs-") as td:
        tmp = Path(td)
        for slug in slugs:
            info = build_one(slug, tmp)
            report.append(info)
            print(
                f"OK {slug}: {info['out']}"
                + (f"  [{info['phrase']}]" if info["phrase"] else "  [no panel]")
                + ("  (fallback note)" if info["fallback"] else "")
            )
        # Always refresh home.jpg from Most Toxic mock (site-level share image).
        if "most-toxic-bitcoin-maxi" in slugs or not argv[1:]:
            src = tmp / "most-toxic-bitcoin-maxi.html"
            if not src.exists():
                build_one("most-toxic-bitcoin-maxi", tmp)
                src = tmp / "most-toxic-bitcoin-maxi.html"
            # Re-render home from same HTML (URL bar already toxic).
            screenshot(src, OG / "home.jpg")
            print("OK home.jpg (Most Toxic feature mock)")
    missing = [r["slug"] for r in report if r["missing_annotations"]]
    if missing:
        print("MISSING_ANNOTATIONS:", ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
