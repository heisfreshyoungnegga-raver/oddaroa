#!/usr/bin/env python3
"""shrink-crest.py — Oddaroa crest normaliser (Prince, 2026-11-09).

House standard for uploaded team crests: at most 128 px on the long
side, WebP quality 85, and a hard budget of 24,000 data-URI
characters (~18 KB). Crests render at 22-44 px on the site; anything
bigger is dead weight that slows every page carrying the image —
two 116 KB crests once bloated the match list to 639 KB.

Usage:
    python3 shrink-crest.py INFILE OUTFILE

INFILE holds one data: URI (the crest as stored). OUTFILE receives
the shrunk data: URI. Prints before/after sizes. If WebP output
would exceed the budget, the ladder steps down (110px/q80,
96px/q75) before giving up to an optimised PNG.
"""
import base64
import io
import sys

from PIL import Image

BUDGET = 24000  # data-URI characters, hard cap for a "normal" crest
LADDER = [(128, 85), (110, 80), (96, 75)]  # (max_px, webp_quality)


def to_data_uri(fmt, raw):
    return "data:image/%s;base64,%s" % (fmt, base64.b64encode(raw).decode())


def shrink(data_uri):
    assert data_uri.startswith("data:image/"), "not an image data URI"
    raw = base64.b64decode(data_uri.split(",", 1)[1])
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    best = None
    for px, q in LADDER:
        work = img.copy()
        work.thumbnail((px, px), Image.LANCZOS)
        buf = io.BytesIO()
        work.save(buf, "WEBP", quality=q, method=6)
        uri = to_data_uri("webp", buf.getvalue())
        if best is None or len(uri) < len(best):
            best = uri
        if len(uri) <= BUDGET:
            return uri
    # Last resort: optimised PNG at the smallest ladder size.
    work = img.copy()
    work.thumbnail((96, 96), Image.LANCZOS)
    buf = io.BytesIO()
    work.save(buf, "PNG", optimize=True)
    uri = to_data_uri("png", buf.getvalue())
    return uri if len(uri) < len(best) else best


def main():
    src, dst = sys.argv[1], sys.argv[2]
    before = open(src).read().strip()
    after = shrink(before)
    open(dst, "w").write(after)
    print("%s: %d -> %d chars" % (src.rsplit("/", 1)[-1], len(before), len(after)))


if __name__ == "__main__":
    main()
