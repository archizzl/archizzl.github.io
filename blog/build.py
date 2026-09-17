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
    status: draft            # optional; default published. draft = only visible via --watch
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
from datetime import date, datetime, timezone
from email.utils import format_datetime, formatdate
from html import escape
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
TEMPLATE = SRC / "template.txt"
POSTS_DIR = ROOT / "posts"
MANIFEST = ROOT / "posts.json"
FEED = ROOT / "feed.xml"

SITE_URL = "https://archizzl.com"
SITE_TITLE = "archie"
SITE_DESCRIPTION = "archie's blog"

POST_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<title>{title} — archie</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=0.7">
{robots_meta}<link rel="icon" type="image/x-icon" href="../../../favicon.ico">
<link rel="stylesheet" href="../../../index.css">
<link rel="alternate" type="application/rss+xml" title="archie's blog" href="../../feed.xml">
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
<dialog id="img_modal"><img id="img_modal_content" alt=""></dialog>
<script>
(function () {{
  var modal = document.getElementById('img_modal');
  var mimg = document.getElementById('img_modal_content');
  document.querySelectorAll('#blog-container img').forEach(function (img) {{
    img.addEventListener('click', function () {{
      mimg.src = img.currentSrc || img.src;
      mimg.alt = img.alt || '';
      modal.showModal();
    }});
  }});
  modal.addEventListener('click', function () {{
    modal.close();
  }});
}})();
</script>
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


def refresh_template_date() -> None:
    if not TEMPLATE.exists():
        return
    today = date.today().isoformat()
    text = TEMPLATE.read_text(encoding="utf-8")
    new_text, count = re.subn(r"(?m)^date:\s*.*$", f"date: {today}", text, count=1)
    if count and new_text != text:
        TEMPLATE.write_text(new_text, encoding="utf-8")


def build(include_drafts: bool = False) -> None:
    if not SRC.exists():
        print(f"no src directory at {SRC}", file=sys.stderr)
        sys.exit(1)
    POSTS_DIR.mkdir(exist_ok=True)

    refresh_template_date()

    entries: list[dict] = []
    seen_slugs: set[str] = set()
    draft_count = 0

    for txt in sorted(SRC.glob("*.txt")):
        if txt.resolve() == TEMPLATE.resolve():
            continue  # template.txt is a scaffold, not a post
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

        status = meta.get("status", "published").strip().lower()
        is_draft = status == "draft"
        if is_draft and not include_drafts:
            # Skip drafts entirely in production builds.
            seen_slugs.discard(slug)  # allow cleanup to remove any stale dir
            continue
        if is_draft:
            draft_count += 1

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

        body_html = render_body(body)
        post_dir = POSTS_DIR / slug
        post_dir.mkdir(exist_ok=True)
        robots_meta = '<meta name="robots" content="noindex">\n' if is_draft else ""
        html = POST_TEMPLATE.format(
            title=escape(title),
            date=escape(d),
            date_pretty=escape(pretty_date(d)),
            tags_html=tags_html,
            body=body_html,
            robots_meta=robots_meta,
        )
        (post_dir / "index.html").write_text(html, encoding="utf-8")

        entry = {
            "slug": slug,
            "title": title,
            "date": d,
            "description": meta.get("description", ""),
            "tags": tags,
            "_body_html": body_html,
        }
        if is_draft:
            entry["status"] = "draft"
        entries.append(entry)

    entries.sort(key=lambda e: e["date"], reverse=True)

    # Feed never contains drafts, even in preview mode.
    write_feed([e for e in entries if e.get("status") != "draft"])

    # Strip internal-only fields before writing the public manifest.
    manifest = [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries]
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    # Clean up stale generated post directories.
    for existing in POSTS_DIR.iterdir():
        if existing.is_dir() and existing.name not in seen_slugs:
            for f in existing.iterdir():
                f.unlink()
            existing.rmdir()

    published = len(entries) - draft_count
    if include_drafts and draft_count:
        print(f"built {published} published + {draft_count} draft(s)")
    else:
        print(f"built {published} post(s)")


def write_feed(entries: list[dict]) -> None:
    items = []
    for e in entries:
        link = f"{SITE_URL}/blog/posts/{e['slug']}/"
        y, m, d = (int(x) for x in e["date"].split("-"))
        dt = datetime(y, m, d, tzinfo=timezone.utc)
        pub_date = format_datetime(dt, usegmt=True)
        desc = e.get("description") or ""
        items.append(
            "<item>\n"
            f"<title>{escape(e['title'])}</title>\n"
            f"<link>{link}</link>\n"
            f'<guid isPermaLink="true">{link}</guid>\n'
            f"<pubDate>{pub_date}</pubDate>\n"
            + (f"<description>{escape(desc)}</description>\n" if desc else "")
            + f"<content:encoded><![CDATA[{e['_body_html']}]]></content:encoded>\n"
            "</item>"
        )
    now = formatdate(usegmt=True)
    feed = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" '
        'xmlns:content="http://purl.org/rss/1.0/modules/content/">\n'
        "<channel>\n"
        f"<title>{escape(SITE_TITLE)}</title>\n"
        f"<link>{SITE_URL}/</link>\n"
        f"<description>{escape(SITE_DESCRIPTION)}</description>\n"
        f'<atom:link href="{SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml" />\n'
        "<language>en</language>\n"
        f"<lastBuildDate>{now}</lastBuildDate>\n"
        + "\n".join(items) + "\n"
        "</channel>\n"
        "</rss>\n"
    )
    FEED.write_text(feed, encoding="utf-8")


def watch_and_serve(port: int = 8000) -> None:
    build(include_drafts=True)
    site_root = ROOT.parent
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(site_root))
    handler.log_message = lambda *a, **k: None  # type: ignore[attr-defined]
    server = ThreadingHTTPServer(("localhost", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"serving http://localhost:{port}/ — watching {SRC.relative_to(site_root)}/*.txt", flush=True)
    print(f"open http://localhost:{port}/ or http://localhost:{port}/blog/posts/<slug>/", flush=True)
    print("drafts included in preview; a clean build runs on Ctrl+C so it's safe to commit", flush=True)

    mtimes: dict[Path, float] = {}
    try:
        while True:
            current = {p: p.stat().st_mtime for p in SRC.glob("*.txt")}
            if current != mtimes:
                if mtimes:  # skip the initial diff (already built above)
                    print("change detected — rebuilding", flush=True)
                    try:
                        build(include_drafts=True)
                    except SystemExit:
                        print("build failed — fix the error and save again", flush=True)
                    except Exception as e:  # noqa: BLE001
                        print(f"build failed: {e}", flush=True)
                mtimes = current
            time.sleep(0.4)
    except KeyboardInterrupt:
        print("\nrunning clean build (drafts excluded) before exit…", flush=True)
        try:
            build(include_drafts=False)
        except SystemExit:
            print("clean build failed — run 'python3 blog/build.py' manually before committing", flush=True)
        print("bye", flush=True)


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
