#!/usr/bin/env python3
"""Pull the pieces on iris.ooo's front page into projects/iris/pieces.json.

iris has no public feed. Its homepage is server-rendered and carries the works
it shows (about 18, newest first) inline as serialized JS objects, so this
reads those. New pieces are merged into the existing file and the list is
capped at the newest MAX_PIECES, so the pool grows past one front page.

Run by .github/workflows/iris.yml on a schedule. Locally:
    python3 _iris/scrape.py
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

SOURCE = "https://iris.ooo/"
OUT = Path(__file__).resolve().parent.parent / "projects" / "iris" / "pieces.json"
MAX_PIECES = 120

# A work object starts like  $R[534]={id:"burning-out",workId:"…",
WORK_START = re.compile(r'\$R\[\d+\]=\{id:"(?:[^"\\]|\\.)*",workId:"')
FIELDS = ("id", "slug", "title", "artistId", "artistName", "medium", "createdAt", "imageUrl")
ARTIST_URL = "https://iris.ooo/artists/"


def js_string(raw):
    """Decode a JS double-quoted string body (handles \\xNN, which JSON lacks)."""
    raw = re.sub(r"\\x([0-9a-fA-F]{2})", r"\\u00\1", raw)
    return json.loads('"' + raw + '"')


def field(chunk, name):
    m = re.search(r"[{,]" + name + r':"((?:[^"\\]|\\.)*)"', chunk)
    # strip() also drops stray direction marks some names come with
    return js_string(m.group(1)).strip(" \t\n‎‏") if m else None


def flag(chunk, name):
    """JS booleans are minified to !0 (true) and !1 (false)."""
    m = re.search(r"[{,]" + name + r":(!0|!1|true|false)", chunk)
    return m.group(1) in ("!0", "true") if m else False


def number(chunk, name):
    m = re.search(r"[{,]" + name + r":(\d+)", chunk)
    return int(m.group(1)) if m else None


def parse(html):
    starts = [m.start() for m in WORK_START.finditer(html)] + [len(html)]
    pieces = []
    for a, b in zip(starts, starts[1:]):
        chunk = html[a:b]
        p = {k: field(chunk, k) for k in FIELDS}
        if not (p["id"] and p["imageUrl"] and p["title"]):
            continue
        p["year"] = number(chunk, "year")
        p["price"] = number(chunk, "price")  # whole dollars; null when offers only
        p["offersOnly"] = flag(chunk, "offersOnly")
        p["isSold"] = flag(chunk, "isSold")
        p["url"] = "https://iris.ooo/artwork?id=" + urllib.request.quote(p["id"])
        # only link the name when iris itself does (some works are by unlisted artists)
        linked = p["artistId"] and flag(chunk, "artistProfileLinked")
        p["artistUrl"] = ARTIST_URL + urllib.request.quote(p["artistId"]) if linked else None
        pieces.append(p)
    return pieces


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "archizzl.com iris gallery"})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8")


def backfill(piece):
    """Re-read a piece scraped before price/artistUrl existed from its own page."""
    try:
        found = [p for p in parse(fetch(piece["url"])) if p["id"] == piece["id"]]
    except Exception as e:  # one bad page shouldn't sink the run
        print(f"couldn't backfill {piece['id']}: {e}")
        return piece
    return found[0] if found else piece


def main():
    fresh = parse(fetch(SOURCE))
    if not fresh:
        # Their page changed shape. Fail loudly and leave the old list alone.
        sys.exit("no pieces found on " + SOURCE + " (page format changed?)")

    old = []
    if OUT.exists():
        old = json.loads(OUT.read_text()).get("pieces", [])
    by_id = {p["id"]: p for p in old}
    by_id.update({p["id"]: p for p in fresh})  # fresh wins: titles/images can change
    merged = sorted(by_id.values(), key=lambda p: p.get("createdAt") or "", reverse=True)
    merged = merged[:MAX_PIECES]
    merged = [p if "artistUrl" in p else backfill(p) for p in merged]

    if merged == old:
        print(f"no change ({len(merged)} pieces)")
        return
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": SOURCE, "pieces": merged}, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(fresh)} on the front page, {len(merged)} in the pool")


if __name__ == "__main__":
    main()
