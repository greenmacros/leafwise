"""Regenerates public/icons/*.png and favicon.svg (a white leaf on LeafWise green). Needs Pillow."""
import math
from PIL import Image, ImageDraw

GREEN = (47, 158, 91, 255)
DARK = (30, 120, 66, 255)
WHITE = (255, 255, 255, 255)
SS = 4  # supersampling for smooth edges


def leaf_points(cx, cy, length, width, angle_deg, n=60):
    pts_top, pts_bot = [], []
    a = math.radians(angle_deg)
    for i in range(n + 1):
        u = i / n
        x = -length + 2 * length * u
        y = width * math.sin(math.pi * u) ** 0.85
        for sign, bucket in ((1, pts_top), (-1, pts_bot)):
            yy = sign * y
            bucket.append((cx + x * math.cos(a) - yy * math.sin(a), cy + x * math.sin(a) + yy * math.cos(a)))
    return pts_top + pts_bot[::-1], (
        (cx + -length * math.cos(a), cy + -length * math.sin(a)),
        (cx + length * math.cos(a), cy + length * math.sin(a)),
    )


def make(size, leaf_scale, rounded, path):
    s = size * SS
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=GREEN)
    else:
        d.rectangle([0, 0, s, s], fill=GREEN)
    length = s * 0.30 * leaf_scale
    width = s * 0.17 * leaf_scale
    poly, (tail, tip) = leaf_points(s / 2, s / 2, length, width, -45)
    d.polygon(poly, fill=WHITE)
    # midrib and stem
    d.line([tail, tip], fill=DARK, width=max(2, int(s * 0.018)))
    a = math.radians(-45)
    stem_end = (tail[0] - s * 0.07 * leaf_scale * math.cos(a), tail[1] - s * 0.07 * leaf_scale * math.sin(a))
    d.line([tail, stem_end], fill=WHITE, width=max(2, int(s * 0.03)))
    img.resize((size, size), Image.LANCZOS).save(path)


make(192, 1.0, True, 'public/icons/icon-192.png')
make(512, 1.0, True, 'public/icons/icon-512.png')
make(512, 0.78, False, 'public/icons/maskable-512.png')  # content inside the 80% safe zone
make(180, 0.9, False, 'public/icons/apple-touch-icon.png')  # iOS applies its own rounding

open('public/favicon.svg', 'w').write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2f9e5b"/>'
    '<path d="M18 46C16 28 28 16 48 16c0 20-12 32-30 30z" fill="#fff"/>'
    '<path d="M18 46L40 24" stroke="#1e7842" stroke-width="2" stroke-linecap="round" fill="none"/></svg>\n'
)
print('icons written')
