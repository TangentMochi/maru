"""maru のアプリアイコン (1024x1024 PNG) を標準ライブラリだけで描く。

グレーの立体キーの上に、シアンの選択欄と紺色のマル。
usage: python3 make_icon.py out.png
"""
import math
import struct
import sys
import zlib

S = 1024
C = S / 2

FACE = (192, 192, 192)
CYAN = (0, 255, 255)
NAVY = (10, 26, 107)

KEY_HALF, KEY_R, KEY_BEVEL = 412, 185, 34
FIELD_HALF, FIELD_BEVEL = 262, 22
RING_OUT, RING_IN = 196, 122


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def key_sdf(x, y):
    """角丸四角の符号付き距離と、外向き法線。"""
    dx, dy = x - C, y - C
    qx, qy = abs(dx) - (KEY_HALF - KEY_R), abs(dy) - (KEY_HALF - KEY_R)
    sx, sy = (1 if dx >= 0 else -1), (1 if dy >= 0 else -1)
    if qx > 0 and qy > 0:
        ln = math.hypot(qx, qy)
        return ln - KEY_R, (sx * qx / ln, sy * qy / ln)
    if qx > qy:
        return qx - KEY_R, (sx, 0.0)
    return qy - KEY_R, (0.0, sy)


def key_color(d, n):
    """キーの面。縁は左上が明るく右下が暗い。"""
    if d < -KEY_BEVEL:
        return FACE
    lit = clamp(0.5 - (n[0] + n[1]) * 2.2)  # 左上向きの法線で 1
    outer = mix((48, 48, 48), (255, 255, 255), lit)
    inner = mix((128, 128, 128), (226, 226, 226), lit)
    t = clamp(-d - KEY_BEVEL / 2 + 0.5)  # 0: 外側の帯, 1: 内側の帯
    col = mix(outer, inner, t)
    return mix(col, FACE, clamp(-d - KEY_BEVEL + 0.5))


def field_color(dx, dy, d):
    """くぼんだ入力欄。縁は左上が暗く右下が明るい。"""
    if d <= -FIELD_BEVEL:
        return CYAN
    top_left = (dx < 0) if abs(dx) > abs(dy) else (dy < 0)
    half = d > -FIELD_BEVEL / 2
    if top_left:
        edge = (128, 128, 128) if half else (0, 0, 0)
    else:
        edge = (255, 255, 255) if half else (223, 223, 223)
    return mix(edge, CYAN, clamp(-d - FIELD_BEVEL + 0.5))


def pixel(x, y):
    d, n = key_sdf(x, y)
    alpha = clamp(0.5 - d)
    if alpha <= 0:
        return (0, 0, 0, 0)
    col = key_color(d, n)

    dx, dy = x - C, y - C
    fd = max(abs(dx), abs(dy)) - (FIELD_HALF + FIELD_BEVEL)
    if fd < 0.5:
        col = mix(col, field_color(dx, dy, fd), clamp(0.5 - fd))

    r = math.hypot(dx, dy)
    ring = clamp(RING_OUT - r + 0.5) * clamp(r - RING_IN + 0.5)
    if ring > 0:
        col = mix(col, NAVY, ring)

    return (round(col[0]), round(col[1]), round(col[2]), round(alpha * 255))


def write_png(path, rows):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = b"".join(b"\x00" + row for row in rows)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


rows = []
for j in range(S):
    row = bytearray()
    for i in range(S):
        row += bytes(pixel(i + 0.5, j + 0.5))
    rows.append(bytes(row))
write_png(sys.argv[1], rows)
