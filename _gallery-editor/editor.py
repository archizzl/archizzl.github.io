#!/usr/bin/env python3
"""
Local editor for the portfolio galleries' sections.

    python3 _gallery-editor/editor.py            # opens http://localhost:8124/
    python3 _gallery-editor/editor.py --port=9000 --no-open

Galleries are listed in hpi/gallery/galleries.json (id, label, Cloudinary
tag). The editor has a tab per gallery listing every image with that tag.
Drag images into sections, give each a title and description; changes
autosave to hpi/gallery/<id>/sections.json. Commit that file to publish.

The server also serves the rest of the site, so /index.html?gallery=<id>
previews a gallery's grid with your saved sections. It only listens on localhost.
`python3 blog/build.py --watch` serves the same editor at /gallery-editor/.
This folder starts with an underscore, so Jekyll leaves it out of the
published site.
"""

import functools
import importlib.util
import json
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
import re
import urllib.request
from html import unescape
from html.parser import HTMLParser
from urllib.parse import parse_qs, quote, urljoin, urlparse

HERE = Path(__file__).resolve().parent
SITE_ROOT = HERE.parent
GALLERY_DIR = SITE_ROOT / "hpi" / "gallery"
EDITOR_PAGE = HERE / "editor.html"


def sections_file(gallery: str) -> Path:
    """hpi/gallery/<id>/sections.json, for an id listed in galleries.json."""
    ids = [g["id"] for g in json.loads((GALLERY_DIR / "galleries.json").read_text(encoding="utf-8"))]
    if gallery not in ids:
        raise ValueError(f"unknown gallery {gallery!r} (galleries.json has {', '.join(ids)})")
    return GALLERY_DIR / gallery / "sections.json"


def _http_url(v, field: str, where: str, https_only=False) -> str:
    v = str(v or "").strip()
    ok = v.startswith("https://") or (not https_only and v.startswith("http://"))
    if not ok:
        raise ValueError(f"{where}: {field} must be an http{'s' if https_only else '(s)'} URL")
    return v


def clean_item(item, where: str):
    """An image public ID (string), or an embed / link object."""
    if isinstance(item, str):
        return item
    if not isinstance(item, dict):
        raise ValueError(f"{where}: items must be public IDs or embed/link objects")
    kind = item.get("type")
    text = {k: str(item[k]).strip() for k in ("title", "thumb", "source") if str(item.get(k) or "").strip()}
    if item.get("featured") is True:  # starred for the homepage thumbnail
        text["featured"] = True
    if kind == "embed":
        out = {"type": "embed", "src": _http_url(item.get("src"), "src", where, https_only=True)}
        for k in ("width", "height"):
            if item.get(k):
                out[k] = int(item[k])
        if item.get("url"):
            out["url"] = _http_url(item["url"], "url", where)
        text.pop("source", None)
        return {**out, **text}
    if kind == "link":
        return {"type": "link", "url": _http_url(item.get("url"), "url", where), **text}
    raise ValueError(f"{where}: unknown item type {kind!r}")


def validate(data) -> dict:
    """Normalise posted JSON into {featured: [...], sections: [{title,
    description, items], hidden: [...]}. `featured` lists the starred images
    the homepage thumbnail picks from. Older files used "photos" for the item
    list; that's still accepted."""
    if not isinstance(data, dict) or not isinstance(data.get("sections"), list):
        raise ValueError("expected {\"sections\": [...]}")
    out = []
    for i, sec in enumerate(data["sections"]):
        if not isinstance(sec, dict):
            raise ValueError(f"section {i + 1} is not an object")
        items = sec.get("items", sec.get("photos", []))
        if not isinstance(items, list):
            raise ValueError(f"section {i + 1}: items must be a list")
        out.append({
            "title": str(sec.get("title", "")).strip(),
            "description": str(sec.get("description", "")).strip(),
            "items": [clean_item(it, f"section {i + 1}, item {j + 1}") for j, it in enumerate(items)],
        })
    featured = data.get("featured", [])
    if not isinstance(featured, list) or not all(isinstance(f, str) for f in featured):
        raise ValueError("featured must be a list of public IDs")
    hidden = data.get("hidden", [])
    if not isinstance(hidden, list):
        raise ValueError("hidden must be a list")
    hidden = [clean_item(h, f"hidden item {j + 1}") for j, h in enumerate(hidden)]
    return {"featured": featured, "hidden": hidden, "sections": out}


# ---- link previews ------------------------------------------------------
# The editor pastes a URL; we fetch the page and work out how to show it:
# a player (YouTube, Spotify, Bandcamp, Instagram, or any page with an
# og:video player) or a link card (everything else, e.g. articles).

class _Meta(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self.title = ""
        self._in_title = False
        self._title_done = False  # only the page's own <title>, not SVG ones

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key and a.get("content") and key not in self.meta:
                self.meta[key] = a["content"].strip()
        elif tag == "title" and not self._title_done:
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == "title" and self._in_title:
            self._in_title = False
            self._title_done = True

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def fetch_meta(page_url: str) -> tuple[dict, str]:
    req = urllib.request.Request(page_url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "en",
    })
    with urllib.request.urlopen(req, timeout=10) as r:
        final_url = r.geturl()
        raw = r.read(2_000_000)
        charset = r.headers.get_content_charset() or "utf-8"
    p = _Meta()
    p.feed(raw.decode(charset, errors="replace"))
    m = dict(p.meta)
    m.setdefault("title", unescape(p.title).strip())
    return m, final_url


def preview(page_url: str) -> dict:
    page_url = _http_url(page_url, "url", "preview")
    u = urlparse(page_url)
    host = u.netloc.lower().removeprefix("www.").removeprefix("m.")

    # YouTube: no need to fetch the page for the player or thumbnail.
    yt = None
    if host == "youtu.be":
        yt = u.path.strip("/").split("/")[0]
    elif host.endswith("youtube.com"):
        q = parse_qs(u.query)
        if "v" in q:
            yt = q["v"][0]
        elif u.path.startswith(("/shorts/", "/embed/", "/live/")):
            yt = u.path.split("/")[2]

    # Instagram: the post's official embed frame. Instagram won't serve post
    # details to a script, so the title and thumbnail are left to the user.
    if host == "instagram.com":
        parts = [p for p in u.path.split("/") if p]
        if len(parts) >= 2 and parts[0] in ("p", "reel", "tv"):
            permalink = f"https://www.instagram.com/{parts[0]}/{parts[1]}/"
            return {"type": "embed", "src": permalink + "embed/", "url": permalink,
                    # header + 4:5 photo + likes bar at 400px wide
                    "width": 400, "height": 690,
                    "warning": "instagram doesn't share post details, so add a title and thumbnail yourself "
                               "(the thumbnail can be the cloudinary copy of the photo)"}

    try:
        meta, final_url = fetch_meta(page_url)
    except Exception as e:  # noqa: BLE001 — any fetch failure just means less detail
        meta, final_url = {}, page_url
        if not yt:
            return {"type": "link", "url": page_url, "source": host,
                    "warning": f"couldn't fetch the page ({e}); fill in the title and thumbnail yourself"}

    title = meta.get("og:title") or meta.get("twitter:title") or meta.get("title", "")
    thumb = meta.get("og:image") or meta.get("twitter:image") or ""
    if thumb:
        thumb = urljoin(final_url, thumb)
    base = {"title": title, "thumb": thumb, "url": page_url}

    if yt:
        return {**base, "type": "embed", "src": f"https://www.youtube.com/embed/{yt}",
                "width": 1280, "height": 720,
                "thumb": f"https://img.youtube.com/vi/{yt}/hqdefault.jpg"}

    if host == "open.spotify.com":
        parts = [p for p in u.path.split("/") if p and not p.startswith("intl-")]
        if len(parts) >= 2:
            # The page itself is a JS shell; Spotify's oEmbed has the details.
            try:
                with urllib.request.urlopen(
                        "https://open.spotify.com/oembed?url=" + quote(page_url, safe=""), timeout=10) as r:
                    o = json.loads(r.read())
                base = {**base, "title": o.get("title") or base["title"], "thumb": o.get("thumbnail_url") or base["thumb"]}
            except Exception:  # noqa: BLE001
                pass
            return {**base, "type": "embed", "src": f"https://open.spotify.com/embed/{parts[0]}/{parts[1]}",
                    "width": 600, "height": 352}

    video = meta.get("og:video:secure_url") or meta.get("og:video:url") or meta.get("og:video") or ""
    if host.endswith("bandcamp.com") or "bandcamp.com/EmbeddedPlayer" in video:
        m = re.search(r"(album|track)=(\d+)", video)
        if m:
            # Big-artwork player, so the cover is the star.
            src = (f"https://bandcamp.com/EmbeddedPlayer/{m.group(1)}={m.group(2)}/size=large/"
                   "bgcol=ffffff/linkcol=0687f5/tracklist=false/transparent=true/")
            return {**base, "type": "embed", "src": src, "width": 350, "height": 470}

    if video.startswith("https://") and "html" in meta.get("og:video:type", "text/html"):
        out = {**base, "type": "embed", "src": video}
        for k in ("width", "height"):
            v = meta.get(f"og:video:{k}", "")
            if v.isdigit():
                out[k] = int(v)
        return out

    source = meta.get("og:site_name") or host
    return {**base, "type": "link", "source": source}


# The server can run for days (it's also inside `blog/build.py --watch`), so
# the save and look-up code is reloaded from this file whenever it changes.
# Otherwise an old server would quietly drop data a newer editor page sends.
_SELF = Path(__file__).resolve()
_fresh = {"mtime": _SELF.stat().st_mtime, "mod": None}


def current():
    """This module, reloaded from disk if editor.py has changed since."""
    mtime = _SELF.stat().st_mtime
    if mtime != _fresh["mtime"]:
        spec = importlib.util.spec_from_file_location("gallery_editor_fresh", _SELF)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        _fresh.update(mtime=mtime, mod=mod)
        print("editor.py changed: reloaded the save code", flush=True)
    return _fresh["mod"] or _THIS


# The functions the server calls, from this copy of the file. (Not
# sys.modules: blog/build.py loads this file without registering it.)
_THIS = SimpleNamespace(preview=lambda u: preview(u), validate=lambda d: validate(d),
                        sections_file=lambda g: sections_file(g))


class Handler(SimpleHTTPRequestHandler):
    # URLs that show the editor page. blog/build.py swaps these out so the
    # site's own homepage stays at /.
    EDITOR_PATHS = ("/", "/editor", "/editor/")

    def log_message(self, *args):  # keep the terminal quiet
        pass

    def end_headers(self):
        # Always serve fresh files so the preview reflects the latest save.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == "/api/preview":
            try:
                self._json(200, current().preview(parse_qs(query).get("url", [""])[0]))
            except ValueError as e:
                self._json(400, {"error": str(e)})
            return
        if path in self.EDITOR_PATHS:
            body = EDITOR_PAGE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        path, _, query = self.path.partition("?")
        if path != "/api/sections":
            self.send_error(404)
            return
        try:
            gallery = parse_qs(query).get("gallery", [""])[0]
            code = current()
            target = code.sections_file(gallery)
            length = int(self.headers.get("Content-Length", 0))
            data = code.validate(json.loads(self.rfile.read(length)))
        except (ValueError, json.JSONDecodeError) as e:
            self._json(400, {"error": str(e)})
            return
        target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"saved {len(data['sections'])} section(s) to {target.relative_to(SITE_ROOT)}", flush=True)
        self._json(200, {"ok": True})

    def _json(self, code: int, obj: dict):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    port = 8124
    open_browser = True
    for a in sys.argv[1:]:
        if a.startswith("--port="):
            port = int(a.split("=", 1)[1])
        elif a == "--no-open":
            open_browser = False
    handler = functools.partial(Handler, directory=str(SITE_ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://localhost:{port}/"
    print(f"gallery editor at {url} (previews at {url}index.html?gallery=<id>) — Ctrl+C to stop", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", flush=True)


if __name__ == "__main__":
    main()
