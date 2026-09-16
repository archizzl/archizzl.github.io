#!/usr/bin/env python3
"""
Build the blog: reads text files in blog/src/, writes HTML posts to blog/
and regenerates blog/posts.json.

Usage:
    python blog/build.py

Source format (blog/src/my-slug.txt):

    title: My First Post
    date: 2026-09-16
    tags: personal, tech
    ---
    Body text. Paragraphs are separated by blank lines.

    ## Headings use two hashes

    Links look like [text](https://example.com).
    Wrap text in [[ ]] to put it in a box.
    Use __text__ for underline, --text-- for strikethrough,
    **text** for bold, *text* for italic.
    Raw HTML is passed through.

The filename (without .txt) becomes the URL slug.
"""

import functools
import json
import re
import sys
import threading
import time
from datetime import date
from html import escape
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
POSTS_DIR = ROOT / "posts"
MANIFEST = ROOT / "posts.json"

POST_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<title>{title} — archie</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=0.7">
<link rel="icon" type="image/x-icon" href="../../../favicon.ico">
<link rel="stylesheet" href="../../../index.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
</head>
<body>
<div id="landing_page">
<div id="blog-container">
<span><a href="../../../">← home</a></span>
<span class="post-meta"><time datetime="{date}">{date}</time></span>
<h1 class="post-title">{title}</h1>
{tags_html}{body}
<div id="video_wrapper">
<video
id="salmon"
src="https://res.cloudinary.com/do45g1bvk/video/upload/salmon_2_m7xu32.mp4"
muted
loop
playsinline
preload="auto"
style="height: auto; width: 100%; aspect-ratio: 640 / 360;"
></video>
</div>
<script>
(function () {{
  var v = document.getElementById('salmon');
  v.addEventListener('click', function () {{
    if (v.paused) v.play(); else v.pause();
  }});
}})();
</script>
</div>
</div>
</body>
</html>
"""


def parse_source(text: str) -> tuple[dict, str]:
    if "---" not in text:
        raise ValueError("missing '---' separator between frontmatter and body")
    head, _, body = text.partition("---")
    meta: dict = {}
    for line in head.strip().splitlines():
        if not line.strip():
            continue
        if ":" not in line:
            raise ValueError(f"bad frontmatter line: {line!r}")
        key, _, value = line.partition(":")
        meta[key.strip().lower()] = value.strip()
    return meta, body.strip()


INLINE_LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
BOX = re.compile(r"\[\[(.+?)\]\]")
BOLD = re.compile(r"\*\*([^*]+)\*\*")
ITALIC = re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)")
UNDERLINE = re.compile(r"__(.+?)__")
STRIKE = re.compile(r"--(\S.*?\S|\S)--")


def render_inline(s: str) -> str:
    def linkify(m: re.Match) -> str:
        text = escape(m.group(1))
        href = escape(m.group(2), quote=True)
        return f'<a href="{href}">{text}</a>'

    s = BOX.sub(r'<span class="box">\1</span>', s)
    s = INLINE_LINK.sub(linkify, s)
    s = BOLD.sub(r"<strong>\1</strong>", s)
    s = ITALIC.sub(r"<em>\1</em>", s)
    s = UNDERLINE.sub(r"<u>\1</u>", s)
    s = STRIKE.sub(r"<s>\1</s>", s)
    return s


def render_body(body: str) -> str:
    blocks = re.split(r"\n\s*\n", body.strip())
    out: list[str] = []
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        # Pass raw HTML blocks through untouched.
        if block.startswith("<") and block.endswith(">"):
            out.append(block)
            continue
        if block.startswith("## "):
            out.append(f"<h2>{render_inline(escape(block[3:].strip()))}</h2>")
            continue
        if block.startswith("# "):
            out.append(f"<h2>{render_inline(escape(block[2:].strip()))}</h2>")
            continue
        # Escape then re-inline so <a>, <em>, <strong> survive but raw HTML in
        # the source is neutered. If you want raw HTML, put it in its own block.
        escaped = escape(block).replace("\n", "<br>\n")
        out.append(f"<p>{render_inline(escaped)}</p>")
    return "\n".join(out)


def pretty_date(iso: str) -> str:
    y, m, d = (int(x) for x in iso.split("-"))
    return date(y, m, d).strftime("%B %-d, %Y")


def build() -> None:
    if not SRC.exists():
        print(f"no src directory at {SRC}", file=sys.stderr)
        sys.exit(1)
    POSTS_DIR.mkdir(exist_ok=True)

    entries: list[dict] = []
    seen_slugs: set[str] = set()

    for txt in sorted(SRC.glob("*.txt")):
        slug = txt.stem
        if slug in seen_slugs:
            print(f"duplicate slug: {slug}", file=sys.stderr)
            sys.exit(1)
        seen_slugs.add(slug)

        raw = txt.read_text(encoding="utf-8")
        try:
            meta, body = parse_source(raw)
        except ValueError as e:
            print(f"{txt.name}: {e}", file=sys.stderr)
            sys.exit(1)

        title = meta.get("title") or slug.replace("-", " ")
        d = meta.get("date")
        if not d:
            print(f"{txt.name}: missing date", file=sys.stderr)
            sys.exit(1)

        tags = [t.strip() for t in meta.get("tags", "").split(",") if t.strip()]
        if tags:
            tag_links = " ".join(
                f'<a class="tag" href="../../../#{quote(t, safe="")}">#{escape(t)}</a>'
                for t in tags
            )
            tags_html = f'<span class="post-tags">{tag_links}</span>\n'
        else:
            tags_html = ""

        post_dir = POSTS_DIR / slug
        post_dir.mkdir(exist_ok=True)
        html = POST_TEMPLATE.format(
            title=escape(title),
            date=escape(d),
            date_pretty=escape(pretty_date(d)),
            tags_html=tags_html,
            body=render_body(body),
        )
        (post_dir / "index.html").write_text(html, encoding="utf-8")

        entries.append({
            "slug": slug,
            "title": title,
            "date": d,
            "description": meta.get("description", ""),
            "tags": tags,
        })

    entries.sort(key=lambda e: e["date"], reverse=True)
    MANIFEST.write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")

    # Clean up stale generated post directories.
    for existing in POSTS_DIR.iterdir():
        if existing.is_dir() and existing.name not in seen_slugs:
            for f in existing.iterdir():
                f.unlink()
            existing.rmdir()

    print(f"built {len(entries)} post(s)")


def watch_and_serve(port: int = 8000) -> None:
    build()
    site_root = ROOT.parent
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(site_root))
    handler.log_message = lambda *a, **k: None  # type: ignore[attr-defined]
    server = ThreadingHTTPServer(("localhost", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"serving http://localhost:{port}/ — watching {SRC.relative_to(site_root)}/*.txt", flush=True)
    print(f"open http://localhost:{port}/ or http://localhost:{port}/blog/posts/<slug>/", flush=True)

    mtimes: dict[Path, float] = {}
    while True:
        current = {p: p.stat().st_mtime for p in SRC.glob("*.txt")}
        if current != mtimes:
            if mtimes:  # skip the initial diff (already built above)
                print("change detected — rebuilding", flush=True)
                try:
                    build()
                except SystemExit:
                    print("build failed — fix the error and save again", flush=True)
                except Exception as e:  # noqa: BLE001
                    print(f"build failed: {e}", flush=True)
            mtimes = current
        try:
            time.sleep(0.4)
        except KeyboardInterrupt:
            print("\nbye")
            return


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] in ("-w", "--watch", "-s", "--serve"):
        port = 8000
        for a in args[1:]:
            if a.startswith("--port="):
                port = int(a.split("=", 1)[1])
        watch_and_serve(port)
    else:
        build()
