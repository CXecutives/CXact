"""App icon: coral plate, white glyph - a briefcase with a search lens at its bottom right.

One geometry, every output:
  src-tauri/icons/icon.ico    Windows only: the plate fills the whole square, like the other
                              apps on the desktop and in the taskbar (48 of 48 px). One stage
                              for every size the shell asks for at 100 to 200 % (see SIZES),
                              48 first: Tauri takes the first entry as the window icon
  src-tauri/icons/icon.icns   macOS 14 and 15: Apple's grid - plate 824 of 1024, margin 100,
                              fractional at the smaller entries - over Apple's template drop
                              shadow, which those systems do not draw themselves (see
                              SHADOW_OPACITY). The plate itself is the Windows plate scaled
  src-tauri/icons/icon.png    the 1024 macOS entry (macOS bundle icon, window and Dock icon of
                              `tauri dev`). Deliberately macOS only: no Windows config lists it,
                              Windows takes every size from icon.ico
  src-tauri/icons/CXact.icon  macOS 26: an Icon Composer package (the coral fill and the white
                              glyph as a vector); the system draws shape, glass and shadow. The
                              macOS CI compiles it into Assets.car (see build_icon_composer)
  ui/src/assets/app-icon.svg  the same paths as a vector (brand mark in the title bar)

Edges, in every raster output: coverage is exact - the share of each pixel inside the outline,
from the curves flattened far below a level (see `coverage`), not a supersampled polygon - so
an edge pixel is neither too light nor too dark and the outline stays symmetric. Colour and
coverage are rendered apart, so a partly covered pixel carries the plate colour under it
(straight alpha), and every fully transparent pixel takes the colour of its nearest visible
neighbours (colour bleed). A scaler that filters without premultiplying - the Windows shell
whenever it has no stage of the wanted size - then mixes plate colour into the edge instead of
black: no dark fringe on any background.

Geometry on the 1024 grid (Windows layout; macOS scales everything with its smaller plate):
- The plate is the icon workshop's (.claude/tools/icon-werkstatt.html), which draws it with
  the same rules (user, 2026-10-01: the icon as it looked there).
- Plate 0..1024 on Windows (full bleed: the desktop and the taskbar show it exactly as large
  as the other apps, measured against Claude and Roblox at 48 px) with circular corners of
  22.37 % of the plate (Mike Swanson's fit to Apple's own AppIconMask, 34 of 152). macOS keeps
  Apple's continuous corner (APPLE_CORNER, the curve UIKit draws for app icons: it leaves the
  straight edge 1.53 r before the corner), the convention of that system.
- The glyph (user, 2026-10-24, "Variante D"): Lucide's briefcase with the search lens, in
  Lucide's 24 unit grid, which spans 624 of Apple's 824 plate, centred (see LUCIDE_UNIT). It
  scales with the plate, so it keeps its share of the plate and its optical centre.
- White strokes 2.1 units wide (the app's icon stroke), round joins, drawn as outlines (see
  `glyph`): the body a rounded rectangle, the handle's two legs run down through the body to
  its bottom edge, the lens a ring with a short handle. Everything of the briefcase within 5.9
  units of the lens's centre is cut away, so the lens sits in a clean gap.
- One flat colour: the app's --brand token (the cxpertise coral), the glyph --brand-glyph
  (white), no gradient. No shadow on Windows; Apple's template shadow under the macOS plate.

Colours: the tokens of ui/src/styles/tokens.css, read from tools/palette.json, which
tools/tokens.mjs writes. `npm run regen` runs both: a new palette in tokens.css redraws every
icon (docs/CHANGING.md).

Small stages are hinted (see `layout`): up to 256 px the stroke is a whole number of pixels
with its straight edges on whole pixels (rounded symmetrically) and the lens's ring a whole
number of pixels across; up to 40 px the gap ends the strokes flat on whole pixels, at least
a pixel from the lens. At 16 and 20 px the handle's legs inside the body are left out: there
they turn the body into a grid of one pixel lines. The handle above the body stays.

    python tools/icon.py                        writes every output, then checks icon.ico
                                                (needs Pillow)
    python tools/icon.py --compare OUT OLD.py   comparison sheet against an older generator
    python tools/icon.py --fringe-sheet OUT [OLD.ico]
                                                edge check of icon.ico on dark, grey and white:
                                                1:1, zoomed and scaled as the shell scales;
                                                with OLD.ico as the row before
"""
import json
import math
import struct
import sys
from io import BytesIO
from itertools import accumulate
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# One flat colour each, no gradient (user, 2026-09-25): the plate is the app's --brand token,
# the briefcase with the lens --brand-glyph (tools/palette.json, generated from
# ui/src/styles/tokens.css; core/tests/icon.rs checks the outputs against the same tokens).
_COLOURS = json.loads((Path(__file__).resolve().parent / 'palette.json')
                      .read_text(encoding='utf-8'))['colours']
BRAND = tuple(_COLOURS['brand']['rgb'])
GLYPH = tuple(_COLOURS['brand-glyph']['rgb'])
# The window's background (--bg): the comparison sheet shows the icon on it too.
BACKGROUND = tuple(_COLOURS['bg']['rgb'])
# The diagnostic sheets (--compare, --fringe-sheet) are no part of the app: white paper, black
# labels, and the icon on the desktops the shell draws it on (dark, mid grey, white).
PAPER = (255, 255, 255)
LABEL = (0, 0, 0)
DESKTOPS = [('dark', (32, 32, 32)), ('grey', (128, 128, 128)), ('white', PAPER)]

# 1024 grid. The Windows plate runs from PLATE (0: full bleed) to 1024 - PLATE.
PLATE = 0
PLATE_R = 0.2237 * (1024 - 2 * PLATE)
# macOS: Apple's grid, plate 824 of 1024 (margin 100, fractional at the smaller sizes) with the
# same corner, 22.37 % of the plate.
MAC_PLATE = 100
MAC_PLATE_R = 0.2237 * (1024 - 2 * MAC_PLATE)

# The glyph (user, 2026-10-24, "Variante D"): Lucide 1.48's briefcase with its search lens at
# the bottom right, white strokes in Lucide's style, in Lucide's 24 unit grid. The grid spans
# 624 of Apple's 824 plate (26 px a unit on the macOS 1024 canvas, origin at 200, 200), centred;
# on any plate the glyph keeps that share (LUCIDE_UNIT units of the plate's own 1024 grid).
# Optically centred as it is: its mass centre lies 0.2 units right of the plate's centre, its
# box 0.1 right and down (the lens's weight and the gap balance), so no nudge.
LUCIDE = 24
LUCIDE_UNIT = 1024 * 26 / (1024 - 2 * MAC_PLATE)
# The app's icon stroke (2.1 of 24), round caps and joins.
STROKE = 2.1
# The briefcase: `rect x=2 y=6 width=20 height=14 rx=2` and the handle
# `M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16`: two legs that run down through the body to its
# bottom edge, joined at the top by a bar with the body's corner radius.
BODY = (2, 6, 22, 20)
BODY_R = 2
LEGS = (8, 16)
HANDLE_TOP = 2
HANDLE_R = 2
# The lens: a ring of radius 3.4 about (18, 18), its handle out to (22.2, 22.2) along the
# diagonal (it starts at 20.5, 20.5, inside the ring). Everything of the briefcase within GAP of
# the lens's centre is cut away, so the lens sits in a clean gap (1.45 units wide).
LENS = (18, 18, 3.4)
LENS_TIP = (22.2, 22.2)
GAP = 5.9
# macOS 11 to 15 draw no shadow under an app icon: it is part of the artwork. Apple's template
# shadow, as iccir reverse-engineered it from Apple's own templates (206 plate on a 256 canvas:
# opacity 0.3, offset 3, CIGaussianBlur radius 3), on the 1024 grid: the plate in black at
# 30 %, 12 down, blurred by a Gaussian with a standard deviation (CIGaussianBlur's radius) of
# 12. It stays inside the canvas: its visible part ends near 972 (936 + 3 deviations).
SHADOW_OPACITY = 0.3
SHADOW_OFFSET = 12
SHADOW_BLUR = 12

# ICO stages. The shell asks for these at 100/125/150/175/200 %: small icons 16 20 24 32,
# taskbar 24 30 36 48, desktop 48 60 72 96, Start and Alt+Tab in between, large and extra large
# 96 128 256. An exact stage is drawn 1:1; for the rest (28, 42, 84) the shell scales the next
# larger one. 48 comes first: Tauri takes the first entry as the window icon.
SIZES = [48, 16, 20, 24, 30, 32, 36, 40, 60, 64, 72, 80, 96, 128, 256]
# Stages up to HINTED px are hinted: the stroke the nearest whole number of pixels, its
# straight edges on whole pixels. Rounding makes it bolder than the plain scale at 24 and 40;
# at 20 (1.33 px) and 36 (2.38 px) one pixel more closes the handle's opening, so it stays.
HINTED = 256
# At least this much plate (px) between the lens and the cut briefcase.
MIN_GAP = 1.0
# Up to FLAT_CUT px the gap ends the strokes flat on whole pixels: an arc through a stroke of
# one or two pixels is only a soft pixel next to the lens.
FLAT_CUT = 40
# Below INNER_LEGS px the handle's legs inside the body are left out: at 16 and 20 they turn
# the body into a grid of one pixel lines.
INNER_LEGS = 24
# AND mask of the ICO stages: a pixel counts as transparent below half coverage (as icotool's
# default threshold), so a reader that ignores alpha sees the plate in its right size.
MASK_ALPHA = 128
# No pixel of a Windows stage - transparent or not - may be darker than the plate's darkest
# colour by more than this (per channel): a darker one is a fringe once the shell scales.
FRINGE_TOLERANCE = 2
# ICNS entries: OSType and edge length. 256 and 512 appear twice (plain and @2x), as Apple's
# iconutil writes them; PNG types only (macOS draws 16 from ic11 = 16@2x).
ICNS_ENTRIES = [('ic11', 32), ('ic12', 64), ('ic07', 128), ('ic13', 256),
                ('ic08', 256), ('ic14', 512), ('ic09', 512), ('ic10', 1024)]
# Flattening of the curves for the exact coverage (see Path2.points).
CHORDS = 256
ARC_STEP = math.radians(0.25)


# ----------------------------------------------------------------------------- paths

class Path2:
    """A closed outline of lines, cubic Beziers and circular arcs - written as SVG path data
    and flattened into a polygon for the raster stages, so both use the same curves."""

    def __init__(self, start):
        self.start = start
        self.segs = []
        self.pos = start

    def line(self, p):
        self.segs.append(('L', p))
        self.pos = p

    def cubic(self, c1, c2, p):
        self.segs.append(('C', c1, c2, p))
        self.pos = p

    def arc(self, center, r, a0, a1):
        """Arc around `center` from angle a0 to a1 (radians, y down: increasing = clockwise)."""
        p = (center[0] + r * math.cos(a1), center[1] + r * math.sin(a1))
        self.segs.append(('A', center, r, a0, a1, p))
        self.pos = p

    def svg(self, fmt):
        out = [f'M{fmt(self.start[0])} {fmt(self.start[1])}']
        for seg in self.segs:
            if seg[0] == 'L':
                out.append(f'L{fmt(seg[1][0])} {fmt(seg[1][1])}')
            elif seg[0] == 'C':
                out.append('C' + ' '.join(f'{fmt(x)} {fmt(y)}' for x, y in seg[1:]))
            else:
                _, (cx, cy), r, a0, a1, _ = seg
                # An SVG arc is given by its end points: near a half circle a rounded end point
                # moves the implied centre a lot (0.6 px for a round cap at 1024), so an
                # arc is written in parts of at most a quarter circle.
                parts = max(1, math.ceil(abs(a1 - a0) / (math.pi / 2) - 1e-9))
                for i in range(1, parts + 1):
                    a = a0 + (a1 - a0) * i / parts
                    sweep = 1 if a1 > a0 else 0
                    out.append(f'A{fmt(r)} {fmt(r)} 0 0 {sweep} '
                               f'{fmt(cx + r * math.cos(a))} {fmt(cy + r * math.sin(a))}')
        return ''.join(out) + 'Z'

    def points(self):
        """The outline as a polygon: CHORDS chords per cubic, one chord per ARC_STEP of an arc.
        The chords stay less than 0.001 px inside the curve at 1024, far below one level of
        coverage."""
        pts = [self.start]
        pos = self.start
        for seg in self.segs:
            if seg[0] == 'L':
                pts.append(seg[1])
            elif seg[0] == 'C':
                (x0, y0), (x1, y1), (x2, y2), (x3, y3) = pos, *seg[1:]
                for i in range(1, CHORDS + 1):
                    t = i / CHORDS
                    u = 1 - t
                    pts.append((u**3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t**3 * x3,
                                u**3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t**3 * y3))
            else:
                _, (cx, cy), r, a0, a1, _ = seg
                n = max(2, math.ceil(abs(a1 - a0) / ARC_STEP))
                for i in range(1, n + 1):
                    a = a0 + (a1 - a0) * i / n
                    pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
            pos = seg[-1]
        return pts


def add(p, *terms):
    x, y = p
    for k, v in terms:
        x += k * v[0]
        y += k * v[1]
    return (x, y)


RIGHT, DOWN, LEFT, UP = (1, 0), (0, 1), (-1, 0), (0, -1)


# Apple's continuous-corner curve (the path UIKit draws for rounded rectangles since iOS 7),
# as distances (back along the incoming edge, forward along the outgoing edge) in units of r.
APPLE_CORNER = [
    ((1.08849323, 0.0), (0.86840689, 0.0), (0.63149399, 0.07491100)),
    ((0.37282392, 0.16905899), (0.16905883, 0.37282401), (0.07491176, 0.63149399)),
    ((0.0, 0.86840701), (0.0, 1.08849299), (0.0, 1.52866483)),
]
APPLE_EXTENT = 1.52866483  # the curve starts this many r before the corner


def apple_corner(path, v, e, f, r):
    """One corner of the plate with Apple's continuous curvature; the path stands at
    v - APPLE_EXTENT*r*e (incoming direction e, outgoing f)."""
    def pt(u, w):
        return add(v, (-u * r, e), (w * r, f))
    for c1, c2, end in APPLE_CORNER:
        path.cubic(pt(*c1), pt(*c2), pt(*end))


def squircle(x0, y0, x1, y1, r):
    """The plate: long straight sides, only the corners curve (iOS/macOS app-icon shape)."""
    p = APPLE_EXTENT * r
    path = Path2((x0 + p, y0))
    for v, e, f in [((x1, y0), RIGHT, DOWN), ((x1, y1), DOWN, LEFT),
                    ((x0, y1), LEFT, UP), ((x0, y0), UP, RIGHT)]:
        path.line(add(v, (-p, e)))
        apple_corner(path, v, e, f, r)
    return path


def rounded_plate(x0, y0, x1, y1, r):
    """The Windows plate as the icon workshop draws it: straight sides, circular corners."""
    path = Path2((x0 + r, y0))
    for (cx, cy), a0 in [((x1 - r, y0 + r), -math.pi / 2), ((x1 - r, y1 - r), 0.0),
                         ((x0 + r, y1 - r), math.pi / 2), ((x0 + r, y0 + r), math.pi)]:
        path.line((cx + r * math.cos(a0), cy + r * math.sin(a0)))
        path.arc((cx, cy), r, a0, a0 + math.pi / 2)
    return path


def plate(g, mac=False):
    """The plate of a stage: the workshop's on Windows, Apple's continuous corner on macOS."""
    return (squircle if mac else rounded_plate)(*g['plate'], g['plate_r'])


def bend(path, centre, r, a0, a1):
    """A rounded corner from angle a0 to a1 about `centre`; with no radius left (the inside
    of a stroke bolder than its bend) the sharp corner itself."""
    if r > 1e-9:
        path.arc(centre, r, a0, a1)
    else:
        path.line(centre)


def body(g):
    """The briefcase's body, the stroked rounded rectangle, cut open by the lens's gap: one
    outline. The outer edge clockwise from the cut in the bottom edge round to the cut in the
    right edge, along the gap, the inner edge back, along the gap again."""
    h = g['w'] / 2
    x0, y0, x1, y1 = g['body']
    gx, gy, gr = g['gap']
    ox0, oy0, ox1, oy1, ro = x0 - h, y0 - h, x1 + h, y1 + h, g['body_r'] + h
    ix0, iy0, ix1, iy1, ri = x0 + h, y0 + h, x1 - h, y1 - h, max(0.0, g['body_r'] - h)

    def cut_x(y):
        return gx - math.sqrt(gr * gr - (y - gy) ** 2)

    def cut_y(x):
        return gy - math.sqrt(gr * gr - (x - gx) ** 2)

    if g['cuts']:
        bottom_o = bottom_i = g['cuts']['bottom']
        right_o = right_i = g['cuts']['right']
    else:
        bottom_o, bottom_i, right_o, right_i = cut_x(oy1), cut_x(iy1), cut_y(ox1), cut_y(ix1)
    assert ox0 + ro < bottom_o < ox1 - ro and ix0 + ri < bottom_i < ix1 - ri, \
        f"{g['s']}: the gap must cut the body's bottom edge where it is straight"
    assert oy0 + ro < right_o < oy1 - ro and iy0 + ri < right_i < iy1 - ri, \
        f"{g['s']}: the gap must cut the body's right edge where it is straight"
    ang = lambda x, y: math.atan2(y - gy, x - gx)
    half = math.pi / 2
    path = Path2((bottom_o, oy1))
    path.line((ox0 + ro, oy1))
    bend(path, (ox0 + ro, oy1 - ro), ro, half, math.pi)
    path.line((ox0, oy0 + ro))
    bend(path, (ox0 + ro, oy0 + ro), ro, math.pi, 3 * half)
    path.line((ox1 - ro, oy0))
    bend(path, (ox1 - ro, oy0 + ro), ro, -half, 0.0)
    path.line((ox1, right_o))
    if g['cuts']:
        path.line((ix1, right_i))
    else:
        path.arc((gx, gy), gr, ang(ox1, right_o), ang(ix1, right_i))
    path.line((ix1, iy0 + ri))
    bend(path, (ix1 - ri, iy0 + ri), ri, 0.0, -half)
    path.line((ix0 + ri, iy0))
    bend(path, (ix0 + ri, iy0 + ri), ri, -half, -math.pi)
    path.line((ix0, iy1 - ri))
    bend(path, (ix0 + ri, iy1 - ri), ri, math.pi, half)
    path.line((bottom_i, iy1))
    if not g['cuts']:
        path.arc((gx, gy), gr, ang(bottom_i, iy1), ang(bottom_o, oy1))
    return path


def handle(g):
    """The handle above the body: both legs from the body's outer top edge up, joined by the
    bar with round bends. One outline, clockwise from the left leg's foot."""
    h = g['w'] / 2
    lx, rx = g['legs']
    ty, rc = g['handle_y'], g['handle_r']
    foot = g['body'][1] - h
    ro, ri = rc + h, max(0.0, rc - h)
    half = math.pi / 2
    path = Path2((lx - h, foot))
    path.line((lx - h, ty + rc))
    bend(path, (lx + rc, ty + rc), ro, math.pi, 3 * half)
    path.line((rx - rc, ty - h))
    bend(path, (rx - rc, ty + rc), ro, -half, 0.0)
    path.line((rx + h, foot))
    path.line((rx - h, foot))
    path.line((rx - h, ty + h + ri))
    bend(path, (rx - h - ri, ty + h + ri), ri, 0.0, -half)
    path.line((lx + h + ri, ty + h))
    bend(path, (lx + h + ri, ty + h + ri), ri, -half, -math.pi)
    path.line((lx + h, foot))
    return path


def legs(g):
    """The handle's legs inside the body, from its inner top edge down to its inner bottom
    edge; the right one ends at the lens's gap. None at the stages that leave them out."""
    if not g['inner_legs']:
        return []
    h = g['w'] / 2
    lx, rx = g['legs']
    _, y0, _, y1 = g['body']
    top, bottom = y0 + h, y1 - h
    gx, gy, gr = g['gap']
    assert math.hypot(max(0.0, gx - lx - h), max(0.0, gy - bottom)) > gr, \
        f"{g['s']}: the gap reaches the left leg"
    left = Path2((lx - h, top))
    for p in [(lx + h, top), (lx + h, bottom), (lx - h, bottom)]:
        left.line(p)
    if g['cuts']:
        ends = [g['cuts']['leg']] * 2
    else:
        ends = [gy - math.sqrt(gr * gr - (x - gx) ** 2) for x in (rx + h, rx - h)]
    assert all(top < e < bottom for e in ends), f"{g['s']}: the gap must end the right leg"
    right = Path2((rx - h, top))
    right.line((rx + h, top))
    right.line((rx + h, ends[0]))
    if g['cuts']:
        right.line((rx - h, ends[1]))
    else:
        right.arc((gx, gy), gr, math.atan2(ends[0] - gy, rx + h - gx),
                  math.atan2(ends[1] - gy, rx - h - gx))
    return [left, right]


def lens(g):
    """The lens: the ring's outer edge with the handle as one outline (clockwise round the
    ring from the handle's upper side, out along its lower side, round its end, back), and the
    ring's inner edge, a hole in it."""
    cx, cy, ro, ri = g['lens']
    h = g['w'] / 2
    q = math.pi / 4  # the handle's direction, down to the right
    side = math.asin(h / ro)
    tip = (cx + g['lens_tip'] * math.cos(q), cy + g['lens_tip'] * math.sin(q))
    path = Path2((cx + ro * math.cos(q + side), cy + ro * math.sin(q + side)))
    path.arc((cx, cy), ro, q + side, q - side + 2 * math.pi)
    path.line((tip[0] + h * math.cos(q - math.pi / 2), tip[1] + h * math.sin(q - math.pi / 2)))
    path.arc(tip, h, q - math.pi / 2, q + math.pi / 2)
    hole = Path2((cx + ri, cy))
    hole.arc((cx, cy), ri, 0.0, 2 * math.pi)
    return path, hole


def glyph(g):
    """The glyph as outlines with their weights: the briefcase's pieces (body, handle, legs)
    meet but never overlap, the lens lies in the gap cut out of them, its hole counts -1 - so
    the weighted sum is the exact union, in the raster stages and (even-odd) in the SVG."""
    ring, hole = lens(g)
    return [(p, 1) for p in [body(g), handle(g), *legs(g), ring]] + [(hole, -1)]


# --------------------------------------------------------------------------- layout

def layout(s, mac=False):
    """Geometry of one stage in target pixels. The glyph keeps its share of the plate, centred.
    Up to HINTED px the stroke is a whole number of pixels with its straight edges on whole
    pixels (the left half rounded, the right half mirrored about the plate's centre) and the
    lens's ring a whole number of pixels across; radii scale freely. Up to FLAT_CUT px the gap
    ends the strokes flat on whole pixels, the lens's hole is a quarter pixel wider and its
    handle ends on a pixel centre."""
    # Windows: the plate runs to the edge of every stage (like the other apps in the taskbar);
    # macOS keeps Apple's margin, fractional below 1024 (3.125 at 32): its edge is anti-aliased
    # like any other, so every entry is the same icon scaled.
    margin = (MAC_PLATE if mac else PLATE) * s / 1024
    k = (s - 2 * margin) / 1024 * LUCIDE_UNIT  # one unit of the 24 grid in px
    origin = s / 2 - LUCIDE / 2 * k
    hinted = s <= HINTED
    w = max(1, round(STROKE * k)) if hinted else STROKE * k
    h = w / 2

    def stroke(u):
        """The centre line of a stroke at u units: its edges on whole pixels when hinted."""
        v = origin + u * k
        return round(v - h) + h if hinted else v

    # The briefcase is mirrored about the plate's centre.
    assert BODY[0] + BODY[2] == LEGS[0] + LEGS[1] == LUCIDE
    x0, lx, ty = stroke(BODY[0]), stroke(LEGS[0]), stroke(HANDLE_TOP)
    y0, y1 = stroke(BODY[1]), stroke(BODY[3])
    x1, rx = s - x0, s - lx

    # The lens; its handle runs down the diagonal through its centre.
    assert LENS_TIP[0] - LENS[0] == LENS_TIP[1] - LENS[1] > 0
    lens_x, lens_y = origin + LENS[0] * k, origin + LENS[1] * k
    lens_out, lens_in = (LENS[2] + STROKE / 2) * k, (LENS[2] - STROKE / 2) * k
    tip = (LENS_TIP[0] - LENS[0]) * math.sqrt(2) * k
    clear = (GAP - LENS[2] - STROKE / 2) * k
    if hinted:
        across = round(2 * (LENS[2] * k + h))
        lens_x = round(lens_x - across / 2) + across / 2
        lens_y = round(lens_y - across / 2) + across / 2
        lens_out, lens_in = across / 2, across / 2 - w
        clear = max(clear, MIN_GAP)
    gap = (lens_x, lens_y, lens_out + clear)

    cuts = None
    if s <= FLAT_CUT:
        # The hole's pixels clear, not a pale blur; the handle fills one more pixel instead
        # of tinting two (the diagonal through the lens's centre meets the pixel centres).
        lens_in += 0.25
        tip = (math.floor(lens_x + tip / math.sqrt(2)) + 0.5 - lens_x) * math.sqrt(2)

        def end(along, band, centre):
            """Where the gap ends a stroke that runs towards the lens: the gap's circle at the
            stroke's centre line, rounded, and at least MIN_GAP from the lens (diagonally
            too) over the stroke's band of whole pixels."""
            d = max(0.0, band - h - centre, centre - band - h)
            reach = math.sqrt(max(0.0, (lens_out + MIN_GAP) ** 2 - d * d))
            circle = along - math.sqrt(gap[2] ** 2 - (band - centre) ** 2)
            return min(round(circle), math.floor(along - reach + 1e-9))

        cuts = dict(bottom=end(lens_x, y1, lens_y), right=end(lens_y, x1, lens_x),
                    leg=end(lens_y, rx, lens_x))
    assert lens_in >= 1, f'{s}: the lens has no hole'
    return dict(
        s=s,
        plate=(margin, margin, s - margin, s - margin),
        plate_r=(MAC_PLATE_R if mac else PLATE_R) * s / 1024,
        w=w,
        body=(x0, y0, x1, y1),
        body_r=BODY_R * k,
        legs=(lx, rx),
        handle_y=ty,
        # The bends stay within the legs' straight run above the body.
        handle_r=min(HANDLE_R * k, y0 - h - ty, (rx - lx) / 2),
        inner_legs=s >= INNER_LEGS,
        lens=(lens_x, lens_y, lens_out, lens_in),
        lens_tip=tip,
        gap=gap,
        cuts=cuts,
    )


# --------------------------------------------------------------------------- raster

def coverage(s, shapes):
    """Exact area coverage of every pixel of an s x s canvas: [(points, weight), ...] summed
    per pixel, row by row, as floats. Each polygon counts with its weight whatever its
    orientation, so a cut-out that lies inside its shape is `(cut, -1)`.

    Signed-area accumulation (as font-rs): every edge adds, to each cell it crosses in a row,
    the signed area between itself and the cell's right side; a running sum along the row then
    gives the covered share of each pixel. Exact for polygons - no supersampling, no rounding
    before the end, so an edge pixel is neither too light nor too dark and the outline stays
    symmetric."""
    stride = s + 2
    acc = [0.0] * (s * stride + 2)
    for pts, weight in shapes:
        xs = [x for x, _ in pts]
        assert min(xs) > -1e-9 and max(xs) < s + 1e-9, 'shape leaves the canvas sideways'
        pts = [(min(max(x, 0.0), float(s)), y) for x, y in pts]
        n = len(pts)
        area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1]
                   for i in range(n))
        # A clockwise outline on screen (positive shoelace area, y down) sums to -1 inside.
        orient = -weight if area > 0 else weight
        for i in range(n):
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
            if y0 == y1:
                continue
            sign = orient
            if y0 > y1:
                x0, y0, x1, y1, sign = x1, y1, x0, y0, -orient
            dxdy = (x1 - x0) / (y1 - y0)
            x = x0 - (y0 * dxdy if y0 < 0 else 0)
            for y in range(max(0, math.floor(y0)), min(s, math.ceil(y1))):
                row = y * stride
                dy = min(y + 1.0, y1) - max(float(y), y0)
                xn = x + dxdy * dy
                d = dy * sign
                xa, xb = (x, xn) if x < xn else (xn, x)
                fa = math.floor(xa)
                ia, ib = int(fa), int(math.ceil(xb))
                if ib <= ia + 1:
                    m = 0.5 * (x + xn) - fa
                    acc[row + ia] += d - d * m
                    acc[row + ia + 1] += d * m
                else:
                    inv = 1.0 / (xb - xa)
                    f0 = xa - fa
                    a0 = 0.5 * inv * (1 - f0) ** 2
                    f1 = xb - ib + 1
                    am = 0.5 * inv * f1 * f1
                    acc[row + ia] += d * a0
                    if ib == ia + 2:
                        acc[row + ia + 1] += d * (1 - a0 - am)
                    else:
                        a1 = inv * (1.5 - f0)
                        acc[row + ia + 1] += d * (a1 - a0)
                        for xi in range(ia + 2, ib - 1):
                            acc[row + xi] += d * inv
                        acc[row + ib - 1] += d * (1 - (a1 + (ib - ia - 3) * inv) - am)
                    acc[row + ib] += d * am
                x = xn
    out = []
    for y in range(s):
        out.extend(accumulate(acc[y * stride:y * stride + s]))
    return out


def level(v):
    """A share 0..1 as an 8 bit value."""
    return 0 if v <= 0 else 255 if v >= 1 else int(v * 255 + 0.5)


def glyph_colour(w):
    """The plate's colour mixed with the glyph's by the glyph's coverage w."""
    if w <= 0:
        return BRAND
    if w >= 1:
        return GLYPH
    return tuple(int(c + (h - c) * w + 0.5) for c, h in zip(BRAND, GLYPH))


def shadow(s, g):
    """macOS: Apple's template shadow under the plate of layout `g`, as a share 0..1 per pixel
    (see SHADOW_OPACITY). The moved plate's exact coverage, blurred by a Gaussian."""
    k = s / 1024
    x0, y0, x1, y1 = g['plate']
    dy = SHADOW_OFFSET * k
    moved = coverage(s, [(squircle(x0, y0 + dy, x1, y1 + dy, g['plate_r']).points(), 1)])
    mask = Image.new('L', (s, s))
    mask.putdata([level(v) for v in moved])
    blurred = pixels(mask.filter(ImageFilter.GaussianBlur(SHADOW_BLUR * k)))
    border = [blurred[i] for i in range(s)] + [blurred[i] for i in range(s * (s - 1), s * s)]
    border += [blurred[y * s + x] for y in range(s) for x in (0, s - 1)]
    assert not any(border), f'{s}: the shadow reaches the edge of the canvas'
    return [SHADOW_OPACITY * v / 255 for v in blurred]


def render(s, mac=False):
    """One stage as straight (not premultiplied) RGBA. Colour and coverage are rendered apart:
    the colour is the coral, mixed with white by the glyph's exact coverage (`glyph`),
    everywhere on the canvas; the alpha is the plate's exact coverage. A partly
    covered edge pixel therefore carries the plate colour, never a mix with the black of an
    empty canvas. Transparent pixels are coloured by `bleed`.

    macOS puts the plate over Apple's black template shadow (`shadow`), composited exactly:
    alpha = plate + shadow x (1 - plate), colour = plate colour x plate / alpha. The plate itself
    is the same as without the shadow; around it only black shows through."""
    g = layout(s, mac)
    covered = coverage(s, [(plate(g, mac).points(), 1)])
    white = coverage(s, [(path.points(), weight) for path, weight in glyph(g)])
    if not mac:
        data = [(*glyph_colour(w), level(c)) for c, w in zip(covered, white)]
    else:
        data = []
        for c, w, below in zip(covered, white, shadow(s, g)):
            c = min(max(c, 0.0), 1.0)
            a = c + below * (1 - c)
            rgb = glyph_colour(w)
            if 0 < c < 1:
                rgb = tuple(int(v * c / a + 0.5) for v in rgb)
            elif c <= 0:
                rgb = (0, 0, 0)
            data.append((*rgb, level(a)))
    img = Image.new('RGBA', (s, s))
    img.putdata(data)
    return bleed(img)


def pixels(img):
    """The pixel values in row order (Pillow 12 replaced `getdata`)."""
    flat = getattr(img, 'get_flattened_data', None)
    return flat() if flat else tuple(img.getdata())


def bleed(img):
    """Colour bleed: every fully transparent pixel takes the mean colour of its visible
    8-neighbours, ring by ring outwards from the visible pixels; alpha stays 0. The nearest
    visible pixel is a plate pixel (or, on macOS, the black shadow), so a filter that mixes a
    transparent pixel into the edge mixes in that colour, never the black of an empty canvas."""
    s = img.width
    px = pixels(img)
    colour = [p[:3] if p[3] else None for p in px]

    def around(i):
        x, y = i % s, i // s
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if (dx or dy) and 0 <= x + dx < s and 0 <= y + dy < s:
                    yield i + dy * s + dx

    ring = {i for i, c in enumerate(colour)
            if c is None and any(colour[j] is not None for j in around(i))}
    while ring:
        fill = {}
        for i in ring:
            near = [colour[j] for j in around(i) if colour[j] is not None]
            fill[i] = tuple(round(sum(c[k] for c in near) / len(near)) for k in range(3))
        for i, c in fill.items():
            colour[i] = c
        ring = {j for i in fill for j in around(i) if colour[j] is None}
    img.putdata([(*c, p[3]) if c is not None else p for c, p in zip(colour, px)])
    return img


def dib(img):
    """A stage as an uncompressed DIB: BITMAPINFOHEADER, straight BGRA bottom up (Windows
    premultiplies itself), then the AND mask: 1 where the pixel is less than half covered, so
    a reader that uses only the mask gets the plate in its size - with the bled colour, not
    black, at the edge. Only 256 is stored as PNG: older image libraries cannot read smaller
    compressed stages, and Windows then shows nothing without an error."""
    s = img.width
    head = struct.pack('<IiiHHIIiiII', 40, s, s * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    bottom_up = img.transpose(Image.FLIP_TOP_BOTTOM)
    r, g, b, a = bottom_up.split()
    xor = Image.merge('RGBA', (b, g, r, a)).tobytes()  # byte order B G R A
    alpha = a.tobytes()
    stride = ((s + 31) // 32) * 4
    mask = bytearray()
    for y in range(s):
        row = bytearray(stride)
        for x in range(s):
            if alpha[y * s + x] < MASK_ALPHA:
                row[x >> 3] |= 0x80 >> (x & 7)
        mask += row
    return head + xor + bytes(mask)


def build_ico(out):
    frames = []
    for s in SIZES:
        img = render(s)
        if s >= 256:
            buf = BytesIO()
            img.save(buf, 'PNG')
            frames.append((s, buf.getvalue()))
        else:
            frames.append((s, dib(img)))
    header = struct.pack('<HHH', 0, 1, len(frames))
    offset = len(header) + 16 * len(frames)
    entries, blobs = b'', b''
    for s, data in frames:
        entries += struct.pack('<BBBBHHII', s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    out.write_bytes(header + entries + blobs)


def read_ico(path):
    """The stages of an ICO file in file order: (size, straight RGBA image, AND mask as rows of
    booleans - None for a PNG stage)."""
    data = Path(path).read_bytes()
    count = struct.unpack_from('<H', data, 4)[0]
    stages = []
    for i in range(count):
        w, _, _, _, _, _, length, offset = struct.unpack_from('<BBBBHHII', data, 6 + 16 * i)
        s = w or 256
        blob = data[offset:offset + length]
        if blob.startswith(b'\x89PNG'):
            img = Image.open(BytesIO(blob))
            img.load()
            stages.append((s, img.convert('RGBA'), None))
            continue
        head, bpp = struct.unpack_from('<I', blob)[0], struct.unpack_from('<H', blob, 14)[0]
        assert bpp == 32, f'stage {s}: {bpp} bpp'
        pixels = blob[head:head + s * s * 4]
        b, g, r, a = Image.frombytes('RGBA', (s, s), pixels).split()  # stored as B G R A
        img = Image.merge('RGBA', (r, g, b, a)).transpose(Image.FLIP_TOP_BOTTOM)
        stride = ((s + 31) // 32) * 4
        and_mask = blob[head + s * s * 4:]
        mask = [[bool(and_mask[(s - 1 - y) * stride + (x >> 3)] & (0x80 >> (x & 7)))
                 for x in range(s)] for y in range(s)]
        stages.append((s, img, mask))
    return stages


def dark_pixels(img, visible_only=False):
    """Pixels darker than the icon's darkest colour (any channel below the smaller of BRAND
    and GLYPH by more than FRINGE_TOLERANCE): (x, y, rgba). Every colour of the Windows icon -
    the plate, the glyph and their mixes - lies at or above that in each channel."""
    floor = [min(b, g) - FRINGE_TOLERANCE for b, g in zip(BRAND, GLYPH)]
    s = img.width
    return [(i % s, i // s, p) for i, p in enumerate(pixels(img))
            if (p[3] or not visible_only) and any(p[k] < floor[k] for k in range(3))]


def check_ico(path):
    """Problems of the written ICO (empty when it is right): stage order, dark pixels (a
    transparent one bleeds into the edge as soon as the shell scales), AND mask."""
    stages = read_ico(path)
    problems = []
    if [s for s, _, _ in stages] != SIZES:
        problems.append(f'stages {[s for s, _, _ in stages]} instead of {SIZES}')
    for s, img, mask in stages:
        dark = dark_pixels(img)
        if dark:
            problems.append(f'stage {s}: {len(dark)} pixels darker than the plate, e.g. {dark[0]}')
        if mask is not None:
            alpha = img.getchannel('A').load()
            wrong = sum(mask[y][x] != (alpha[x, y] < MASK_ALPHA) for y in range(s) for x in range(s))
            if wrong:
                problems.append(f'stage {s}: {wrong} AND mask bits do not match the alpha')
    return problems


def shell_scale(img, size):
    """Scale as a filter that ignores alpha does (no premultiplication) - the Windows shell
    when it has no stage of the wanted size: transparent pixels mix their RGB into the edge."""
    return Image.merge('RGBA', [c.resize((size, size), Image.BILINEAR) for c in img.split()])


def fringe_sheet(out, ico, before=None):
    """The ICO stages 16 24 32 48 64 96 256 on dark, mid grey and white: 1:1, zoomed, and
    scaled as the shell scales (256 -> 48, 64 -> 60), each zoomed x4; one row per version.
    Prints the dark pixels per stage."""
    shown = [16, 24, 32, 48, 64, 96, 256]
    scaled = [(256, 48), (64, 60)]
    versions = ([('before', before)] if before else []) + [('after', ico)]
    backgrounds = DESKTOPS
    gap, label_w, zoom_to = 16, 120, 192
    font = ImageFont.load_default(size=14)
    rows = []
    for name, path in versions:
        stages = {s: img for s, img, _ in read_ico(path)}
        tiles = [stages[s] for s in shown]
        tiles += [stages[s].resize((s * (zoom_to // s),) * 2, Image.NEAREST) for s in shown if s < 256]
        for src, size in scaled:
            small = shell_scale(stages[src], size)
            tiles += [small, small.resize((size * 4,) * 2, Image.NEAREST)]
            dark = dark_pixels(small, visible_only=True)
            darkest = f', darkest {min(p for _, _, p in dark)}' if dark else ''
            print(f'{name}: {src} scaled to {size} as the shell scales: {len(dark)} visible '
                  f'pixels darker than the plate{darkest}')
        for s in shown:
            visible = dark_pixels(stages[s], visible_only=True)
            hidden = len(dark_pixels(stages[s])) - len(visible)
            print(f'{name}: stage {s}: {len(visible)} visible and {hidden} transparent pixels '
                  f'darker than the plate')
        rows.append((name, tiles))
    width = label_w + sum(t.width + gap for t in rows[0][1]) + gap
    row_h = 256 + 2 * gap
    head_h = 28
    sheet = Image.new('RGB', (width, head_h + row_h * len(rows) * len(backgrounds)), PAPER)
    draw = ImageDraw.Draw(sheet)
    captions = [f'{s}' for s in shown] + [f'{s} x{zoom_to // s}' for s in shown if s < 256]
    captions += [c for src, size in scaled for c in (f'shell {src}>{size}, 1:1 and x4', '')]
    x = label_w
    for caption, tile in zip(captions, rows[0][1]):
        draw.text((x, 6), caption, fill=LABEL, font=font)
        x += tile.width + gap
    y = head_h
    for bg_name, bg in backgrounds:
        for name, tiles in rows:
            band = Image.new('RGB', (width, row_h), bg)
            ImageDraw.Draw(band).text((gap, gap), f'{name}\n{bg_name}',
                                      fill=PAPER if bg != PAPER else LABEL, font=font)
            x = label_w
            for tile in tiles:
                band.paste(tile, (x, gap + (256 - tile.height) // 2), tile)
                x += tile.width + gap
            sheet.paste(band, (0, y))
            y += row_h
    sheet.save(out)


def build_mac(icns_out, png_out):
    """ICNS (a plain container: `icns`, total length, then per entry OSType, length incl. the
    8 header bytes and a complete PNG) and the 1024 PNG."""
    frames = {}
    for _, s in ICNS_ENTRIES:
        if s not in frames:
            buf = BytesIO()
            render(s, mac=True).save(buf, 'PNG')
            frames[s] = buf.getvalue()
    body = b''.join(ostype.encode('ascii') + struct.pack('>I', len(frames[s]) + 8) + frames[s]
                    for ostype, s in ICNS_ENTRIES)
    icns_out.write_bytes(b'icns' + struct.pack('>I', len(body) + 8) + body)
    png_out.write_bytes(frames[1024])


def svg_number(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')


def hex_colour(c):
    return '#' + ''.join(f'{v:02X}' for v in c)


def glyph_svg(g):
    """The glyph's outlines as one SVG path (even-odd: the lens's hole is a hole)."""
    return ''.join(path.svg(svg_number) for path, _ in glyph(g))


def build_svg(out):
    g = layout(1024)
    fmt = svg_number
    x0, y0, x1, y1 = g['plate']
    out.write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{fmt(x0)} {fmt(y0)} {fmt(x1 - x0)} {fmt(y1 - y0)}" width="{fmt(x1 - x0)}" height="{fmt(y1 - y0)}">
  <!-- Generated by tools/icon.py - do not edit. The app icon as a vector: the same paths as
       icon.ico, icon.icns and icon.png; briefcase and lens in one path (even-odd). -->
  <path fill="{hex_colour(BRAND)}" d="{plate(g).svg(fmt)}"/>
  <path fill="{hex_colour(GLYPH)}" fill-rule="evenodd" d="{glyph_svg(g)}"/>
</svg>
''', encoding='utf-8', newline='\n')


def build_icon_composer(package):
    """macOS 26: an Icon Composer package (`<name>.icon`: icon.json and its Assets). The system
    draws the shape, the glass, the lighting and the shadow itself, so the package holds only
    the background fill (the coral) and one group with one layer, the white glyph (briefcase
    and lens). The glyph is laid out on the full 1024 square as on the full-bleed plate:
    the system's own mask takes the plate's place. No mask, no shadow baked in. The macOS CI
    compiles it with actool into Assets.car (see .github/workflows/ci.yml); icon.icns stays
    the icon of macOS 14 and 15. The keys follow Tauri's own example (examples/.icons)."""
    g = layout(1024)
    fmt = svg_number
    (package / 'Assets').mkdir(parents=True, exist_ok=True)
    (package / 'Assets' / 'glyph.svg').write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- Generated by tools/icon.py - do not edit. The glyph of the macOS 26 icon: the same path
       as in app-icon.svg, on the full square: the briefcase with the lens. -->
  <path fill="{hex_colour(GLYPH)}" fill-rule="evenodd" d="{glyph_svg(g)}"/>
</svg>
''', encoding='utf-8', newline='\n')
    fill = ','.join(f'{c / 255:.5f}' for c in BRAND)
    spec = {
        'fill': {'solid': f'extended-srgb:{fill},1.00000'},
        'groups': [{
            'layers': [{
                'blend-mode': 'normal',
                'glass': False,
                'hidden': False,
                'image-name': 'glyph.svg',
                'name': 'glyph',
                'position': {'scale': 1, 'translation-in-points': [0, 0]},
            }],
            'shadow': {'kind': 'neutral', 'opacity': 0.5},
            'translucency': {'enabled': True, 'value': 0.5},
        }],
        'supported-platforms': {'squares': 'shared'},
    }
    (package / 'icon.json').write_text(json.dumps(spec, indent=2) + '\n', encoding='utf-8',
                                       newline='\n')


# ----------------------------------------------------------------------- comparison

def compare(out, old_generator):
    """Old vs new at 16, 24, 32, 48 (1:1 and x4), 256 and 512 (Windows and macOS layout), on
    white and on the app's background (--bg)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('icon_old', old_generator)
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    small = [16, 24, 32, 48]
    gap = 24

    def stages(mod):
        imgs = [mod.render(s) for s in small]
        imgs += [i.resize((i.width * 4, i.width * 4), Image.NEAREST) for i in imgs]
        imgs.append(mod.render(256))
        imgs += [mod.render(1024).resize((512, 512), Image.LANCZOS),
                 mod.render(1024, mac=True).resize((512, 512), Image.LANCZOS)]
        return imgs

    rows = [('old', stages(old)), ('new', stages(sys.modules[__name__]))]
    width = gap + sum(i.width + gap for i in rows[0][1])
    row_h = 512 + 2 * gap
    sheet = Image.new('RGB', (width, 4 * row_h), PAPER)
    y = 0
    for bg in (PAPER, BACKGROUND):
        for _, imgs in rows:
            band = Image.new('RGB', (width, row_h), bg)
            x = gap
            for img in imgs:
                band.paste(img, (x, gap + (512 - img.height) // 2), img)
                x += img.width + gap
            sheet.paste(band, (0, y))
            y += row_h
    sheet.save(out)


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    icons = root / 'src-tauri' / 'icons'
    args = sys.argv[1:]
    if len(args) == 3 and args[0] == '--compare':
        compare(args[1], args[2])
    elif len(args) in (2, 3) and args[0] == '--fringe-sheet':
        fringe_sheet(args[1], icons / 'icon.ico', args[2] if len(args) == 3 else None)
    elif not args:
        build_ico(icons / 'icon.ico')
        build_mac(icons / 'icon.icns', icons / 'icon.png')
        build_svg(root / 'ui' / 'src' / 'assets' / 'app-icon.svg')
        build_icon_composer(icons / 'CXact.icon')
        problems = check_ico(icons / 'icon.ico')
        if problems:
            sys.exit('icon.ico failed its check:\n  ' + '\n  '.join(problems))
    else:
        sys.exit(__doc__)
