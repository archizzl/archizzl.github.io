#!/usr/bin/env python3
"""
Build the blog: reads text files in blog/src/ (published) and blog/drafts/
(drafts, gitignored), writes HTML posts to blog/posts/ and regenerates
blog/posts.json and blog/feed.xml. Those outputs only ever hold published
posts.

Publishing is set by a post's status line: 'status: live' on a draft moves
it to blog/src/ at the next build (or just move it yourself), and
'status: draft' on a post in blog/src/ moves it back to blog/drafts/.
New posts start from blog/src/template.txt, which says 'status: draft', so
a copy made in either folder stays a draft until you change that line.
Every build also writes the portfolio pages /<gallery>/ and
/<gallery>/<item>/ with link-preview tags (see gallery_pages.py); --watch
rewrites them when a hpi/gallery/ JSON file, gallery.js or gallery.css
changes.

With --watch, also builds the vite projects (set-splitter, zine-formatter —
whichever are present) into projects/<name>/ and rebuilds each on source
changes. Serves the whole site so the blog and projects live at the same URL
as in production. The preview server also hosts the photo gallery editor at
/gallery-editor/.

Usage:
    python blog/build.py                       # one-shot blog build
    python blog/build.py --watch               # blog + vite projects, live
    python blog/build.py --watch --no-projects # blog only

Source format (blog/src/my-slug.txt, or blog/drafts/my-slug.txt):

    title: My First Post
    date: 2026-09-16
    tags: personal, tech
    status: draft            (or live; see above)
    ---
    Body text. Paragraphs are separated by blank lines.

    ## Headings use two hashes

    Links look like [text](https://example.com).
    Wrap text in [[ ]] to put it in a box.
    Use __text__ for underline, --text-- for strikethrough,
    **text** for bold, *text* for italic.
    Raw HTML is passed through.

The filename (without .txt) becomes the URL slug. Everything in
blog/drafts/ is a draft: only visible via --watch, which builds drafts into
blog/.preview/ (gitignored) and serves that over blog/, so they're never in
a tracked file.
"""

import functools
import json
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import date, datetime, timezone
from email.utils import format_datetime, formatdate
from html import escape
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

from gallery_pages import GALLERY_DIR, build_gallery_pages

ROOT = Path(__file__).resolve().parent
SITE_ROOT = ROOT.parent

# Vite projects living at repo-root/_<name>. --watch builds each into
# projects/<name>/ (same path its deploy Action uses).
VITE_PROJECTS = ("set-splitter", "zine-formatter")
# Files that should trigger a rebuild when they change. node_modules and dist
# are excluded — one is huge, the other is the build output.
VITE_WATCH_GLOBS = ("src/**/*", "index.html", "package.json", "vite.config.ts", "tsconfig.json")


def project_src(name: str) -> Path:
    return SITE_ROOT / f"_{name}"


def project_dist(name: str) -> Path:
    return SITE_ROOT / "projects" / name
SRC = ROOT / "src"
# Gitignored, so unpublished posts never reach the public repo.
DRAFTS = ROOT / "drafts"
TEMPLATE = SRC / "template.txt"
POSTS_DIR = ROOT / "posts"
MANIFEST = ROOT / "posts.json"
FEED = ROOT / "feed.xml"
# Gitignored too. --watch builds drafts here (posts/<slug>/ and a posts.json
# that includes them), never into the tracked POSTS_DIR / MANIFEST, and the
# preview server serves this folder on top of blog/. So committing while
# --watch runs can't publish a draft.
PREVIEW = ROOT / ".preview"

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
{tags_html}<div id="post-viewport">
<div id="post-pages">
{body}
</div>
</div>
<div id="post-nav" hidden>
<button id="page-prev" aria-label="previous page">←</button>
<span id="page-indicator"></span>
<button id="page-next" aria-label="next page">→</button>
</div>
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
<script src="../../reader.js"></script>
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


def source_files() -> list[Path]:
    """Published posts from src/, then drafts from drafts/."""
    files = sorted(SRC.glob("*.txt"))
    if DRAFTS.exists():
        files += sorted(DRAFTS.glob("*.txt"))
    return files


def post_status(txt: Path) -> str:
    """The post's 'status:' line, lowercased ('' if none)."""
    try:
        meta, _ = parse_source(txt.read_text(encoding="utf-8"))
    except ValueError:
        return ""
    return meta.get("status", "").strip().lower()


def sort_by_status() -> None:
    """A post's status decides where it lives: 'status: live' in drafts/
    moves it to src/ (published, committed); 'status: draft' in src/ moves
    it back to drafts/ (gitignored)."""
    DRAFTS.mkdir(exist_ok=True)
    moves = [(t, SRC) for t in sorted(DRAFTS.glob("*.txt")) if post_status(t) == "live"]
    moves += [(t, DRAFTS) for t in sorted(SRC.glob("*.txt"))
              if t.resolve() != TEMPLATE.resolve() and post_status(t) == "draft"]
    for txt, dest in moves:
        target = dest / txt.name
        if target.exists():
            print(f"warning: can't move {txt.relative_to(SITE_ROOT)}: "
                  f"{target.relative_to(SITE_ROOT)} already exists", file=sys.stderr)
            continue
        txt.rename(target)
        what = "published" if dest == SRC else "unpublished (back to drafts)"
        print(f"{txt.stem}: {what} — moved to {target.relative_to(SITE_ROOT)}")


def build(include_drafts: bool = False) -> None:
    if not SRC.exists():
        print(f"no src directory at {SRC}", file=sys.stderr)
        sys.exit(1)
    POSTS_DIR.mkdir(exist_ok=True)

    sort_by_status()
    refresh_template_date()
    # Rebuilt from scratch each time; gone entirely after a plain build.
    shutil.rmtree(PREVIEW, ignore_errors=True)

    entries: list[dict] = []
    seen_slugs: set[str] = set()
    draft_count = 0

    for txt in source_files():
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

        is_draft = txt.parent == DRAFTS
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
        post_dir = (PREVIEW / "posts" if is_draft else POSTS_DIR) / slug
        post_dir.mkdir(parents=True, exist_ok=True)
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

    # Strip internal-only fields before writing the manifests. The tracked
    # one never lists drafts; the preview one (served by --watch) does.
    manifest = [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries]
    published_manifest = [e for e in manifest if e.get("status") != "draft"]
    MANIFEST.write_text(json.dumps(published_manifest, indent=2) + "\n", encoding="utf-8")
    if draft_count:
        (PREVIEW / "posts.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    # Clean up stale generated post directories (including any draft that
    # an older version of this script built into posts/).
    published_slugs = {e["slug"] for e in published_manifest}
    for existing in POSTS_DIR.iterdir():
        if existing.is_dir() and existing.name not in published_slugs:
            for f in existing.iterdir():
                f.unlink()
            existing.rmdir()

    published = len(entries) - draft_count
    if include_drafts and draft_count:
        print(f"built {published} published + {draft_count} draft(s)")
    else:
        print(f"built {published} post(s)")

    gallery_pages()


def gallery_pages() -> None:
    """Per-item gallery pages with link-preview tags (see gallery_pages.py).
    A failure here shouldn't stop the blog build."""
    try:
        build_gallery_pages()
    except Exception as e:  # noqa: BLE001
        print(f"gallery pages failed: {e}", file=sys.stderr)


def gallery_sources() -> dict[Path, float]:
    files = [*GALLERY_DIR.glob("**/*.json"), *GALLERY_DIR.glob("gallery.*")]
    return {p: p.stat().st_mtime for p in files}


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


def project_sources(name: str) -> dict[Path, float]:
    """mtimes of every file the project's build depends on."""
    src = project_src(name)
    if not src.exists():
        return {}
    out: dict[Path, float] = {}
    for glob in VITE_WATCH_GLOBS:
        for p in src.glob(glob):
            if p.is_file():
                out[p] = p.stat().st_mtime
    return out


def build_project(name: str, quiet: bool = False) -> bool:
    """Run `npm run build` in _<name>/ and mirror the output into
    projects/<name>/. Returns True on success, False on failure or if
    the directory / npm aren't available."""
    src, dist = project_src(name), project_dist(name)
    if not src.exists():
        return False
    if shutil.which("npm") is None:
        print(f"npm not on PATH — skipping {name} build", flush=True)
        return False
    if not (src / "node_modules").exists():
        print(f"installing {name} deps (first run, ~30s)…", flush=True)
        r = subprocess.run(["npm", "ci"], cwd=src)
        if r.returncode != 0:
            print("npm ci failed", flush=True)
            return False
    if not quiet:
        print(f"building {name}…", flush=True)
    r = subprocess.run(
        ["npm", "run", "build"], cwd=src,
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"{name} build failed:", flush=True)
        # tsc / vite errors are on stdout usually; stderr for npm noise.
        print(r.stdout or r.stderr, flush=True)
        return False
    if dist.exists():
        shutil.rmtree(dist)
    shutil.copytree(src / "dist", dist)
    if not quiet:
        print(f"  -> {dist.relative_to(SITE_ROOT)}", flush=True)
    return True


def project_needs_build(name: str) -> bool:
    """True if any source file is newer than the deployed index.html."""
    index = project_dist(name) / "index.html"
    if not index.exists():
        return True
    dist_mtime = index.stat().st_mtime
    return any(mt > dist_mtime for mt in project_sources(name).values())


def site_handler() -> type:
    """Static file handler for the preview server. Borrows the gallery
    editor's handler (if present) so /gallery-editor/ works and can save."""
    editor_py = SITE_ROOT / "_gallery-editor" / "editor.py"
    if editor_py.exists():
        import importlib.util
        spec = importlib.util.spec_from_file_location("gallery_editor", editor_py)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]

        class Handler(mod.Handler):
            EDITOR_PATHS = ("/gallery-editor", "/gallery-editor/")

        base = Handler
    else:
        class Quiet(SimpleHTTPRequestHandler):
            def log_message(self, *a, **k):
                pass

        base = Quiet

    class WithDrafts(base):
        """Serves blog/.preview/ over blog/, so drafts show up in the preview
        (their pages, and posts.json listing them) without being written to
        tracked files."""

        def translate_path(self, path):
            real = super().translate_path(path)
            try:
                rel = Path(real).relative_to(ROOT)
            except ValueError:
                return real
            overlay = PREVIEW / rel
            return str(overlay) if rel.parts and overlay.exists() else real

    return WithDrafts


def watch_and_serve(port: int = 8000, build_projects: bool = True) -> None:
    build(include_drafts=True)
    projects = [n for n in VITE_PROJECTS if project_src(n).exists()] if build_projects else []
    for name in projects:
        if project_needs_build(name):
            build_project(name)
    handler = functools.partial(site_handler(), directory=str(SITE_ROOT))
    server = ThreadingHTTPServer(("localhost", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    watched = f"{SRC.relative_to(SITE_ROOT)}/*.txt + {DRAFTS.relative_to(SITE_ROOT)}/*.txt"
    for name in projects:
        watched += f" + {project_src(name).relative_to(SITE_ROOT)}/**"
    print(f"serving http://localhost:{port}/ — watching {watched}", flush=True)
    urls = "".join(f", {n}: /projects/{n}/" for n in projects)
    print(f"open http://localhost:{port}/ (blog: /blog/posts/<slug>/{urls}, gallery editor: /gallery-editor/)", flush=True)
    print("drafts show in the preview only (built into blog/.preview/, gitignored); safe to commit any time", flush=True)

    blog_mtimes: dict[Path, float] = {}
    proj_mtimes: dict[str, dict[Path, float]] = {n: project_sources(n) for n in projects}
    gallery_mtimes = gallery_sources()
    try:
        while True:
            current_blog = {p: p.stat().st_mtime for p in source_files()}
            if current_blog != blog_mtimes:
                if blog_mtimes:
                    print("blog change — rebuilding", flush=True)
                    try:
                        build(include_drafts=True)
                    except SystemExit:
                        print("blog build failed — fix the error and save again", flush=True)
                    except Exception as e:  # noqa: BLE001
                        print(f"blog build failed: {e}", flush=True)
                blog_mtimes = current_blog

            # The gallery editor saves sections.json; refresh the item pages.
            current_gallery = gallery_sources()
            if current_gallery != gallery_mtimes:
                gallery_mtimes = current_gallery
                gallery_pages()

            for name in projects:
                current_proj = project_sources(name)
                if current_proj != proj_mtimes[name]:
                    print(f"{name} change — rebuilding", flush=True)
                    build_project(name)
                    proj_mtimes[name] = current_proj

            time.sleep(0.4)
    except KeyboardInterrupt:
        shutil.rmtree(PREVIEW, ignore_errors=True)
        print("\nbye", flush=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] in ("-w", "--watch", "-s", "--serve"):
        port = 8000
        build_projects = True
        for a in args[1:]:
            if a.startswith("--port="):
                port = int(a.split("=", 1)[1])
            elif a == "--no-projects":
                build_projects = False
        watch_and_serve(port, build_projects=build_projects)
    else:
        build()
