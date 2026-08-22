#!/usr/bin/env python3
"""Generate PWA icons with no image-library dependency (raw PNG writer).

Motif: a purple tile split by a diagonal band -- the "split an expense" idea.
Content stays inside the maskable safe zone (centre 80%).
"""
import struct, zlib, os

BG      = (0x6C, 0x5C, 0xE7)  # purple, full bleed (Android masks the edges)
BG_DARK = (0x4A, 0x3D, 0xB8)  # lower-right half, so the split reads at 48px
BAND    = (0xF5, 0xF3, 0xFF)  # the dividing band

def px(size, x, y):
    n = lambda v: (v + 0.5) / size          # normalised 0..1 centre-of-pixel
    u, v = n(x), n(y)
    # signed distance to the main diagonal (u - v = 0), in normalised units
    d = (u - v) / (2 ** 0.5)
    if abs(d) < 0.045:
        return BAND
    # two dots either side of the band = the two people sharing the bill
    for cx, cy in ((0.31, 0.62), (0.69, 0.38)):
        if ((u - cx) ** 2 + (v - cy) ** 2) ** 0.5 < 0.105:
            return BAND
    return BG if d < 0 else BG_DARK

def png(size, path):
    raw = bytearray()
    for y in range(size):
        raw.append(0)                        # filter type 0 for each scanline
        for x in range(size):
            raw += bytes(px(size, x, y)) + b"\xff"
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    out = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(out)
    print(f"{path}  {size}x{size}  {len(out)}B")

here = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(here, exist_ok=True)
for s in (32, 180, 192, 512):
    png(s, os.path.join(here, f"icon-{s}.png"))
