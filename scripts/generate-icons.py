#!/usr/bin/env python3
"""Generate simple PWA icons (PNG) without third-party deps."""
import struct, zlib, math
from pathlib import Path

OUT = Path("/workspace/rona-insta/src/public/icons")
OUT.mkdir(parents=True, exist_ok=True)

def png(width, height, rgba_fn):
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(rgba_fn(x, y, width, height))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return b"".join([
        b"\x89PNG\r\n\x1a\n",
        chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
        chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
        chunk(b"IEND", b""),
    ])

def lerp(a, b, t):
    return int(a + (b - a) * t)

def icon_fn(maskable, pad=0):
    def fn(x, y, w, h):
        # padding for maskable safe zone (~10%)
        p = int(w * pad)
        # gradient from orange to pink to purple
        t = (x + y) / (2 * (w - 1))
        if t < 0.5:
            s = t * 2
            r, g, b = lerp(0xF5, 0xDD, s), lerp(0x85, 0x2A, s), lerp(0x29, 0x7B, s)
        else:
            s = (t - 0.5) * 2
            r, g, b = lerp(0xDD, 0x81, s), lerp(0x2A, 0x34, s), lerp(0x7B, 0xAF, s)
        # rounded rect
        rad = int(w * (0.22 if not maskable else 0.0))
        ax, ay = x, y
        inside = True
        if not maskable:
            # rounded corners
            corners = [(rad, rad), (w - 1 - rad, rad), (rad, h - 1 - rad), (w - 1 - rad, h - 1 - rad)]
            if x < rad and y < rad and (x - rad) ** 2 + (y - rad) ** 2 > rad * rad:
                inside = False
            if x > w - 1 - rad and y < rad and (x - (w - 1 - rad)) ** 2 + (y - rad) ** 2 > rad * rad:
                inside = False
            if x < rad and y > h - 1 - rad and (x - rad) ** 2 + (y - (h - 1 - rad)) ** 2 > rad * rad:
                inside = False
            if x > w - 1 - rad and y > h - 1 - rad and (x - (w - 1 - rad)) ** 2 + (y - (h - 1 - rad)) ** 2 > rad * rad:
                inside = False
        if not inside:
            return (0, 0, 0, 0)
        # Hebrew-ish "ר" drawn as geometric shapes (resh): vertical bar + top arm
        cx, cy = w / 2, h / 2
        # scale
        u = w / 512
        # background
        col = (r, g, b, 255)
        # letter in white, slightly inset
        # vertical stem (right side in a left-facing resh... in Hebrew resh has a vertical on the right)
        # Coordinates in 512 space, centered
        def in_rect(px, py, x0, y0, x1, y1):
            return x0 * u <= px <= x1 * u and y0 * u <= py <= y1 * u
        # Map 512-space around center? Use absolute 512 design then scale.
        px, py = x / u, y / u
        # Design on 512 canvas: resh
        # top bar from x=150 to 350, y=150-200
        # right stem from x=300 to 350, y=150 to 370
        letter = (
            (160 <= px <= 360 and 155 <= py <= 215) or
            (305 <= px <= 360 and 155 <= py <= 375)
        )
        if letter:
            return (255, 255, 255, 255)
        return col
    return fn

for size in (192, 512):
    Path(OUT / f"icon-{size}.png").write_bytes(png(size, size, icon_fn(False)))
    Path(OUT / f"maskable-{size}.png").write_bytes(png(size, size, icon_fn(True, pad=0.1)))
    print("wrote", size)
print("done")
