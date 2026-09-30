"""App icon: coral plate, white folder, check cut out of the folder.

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
- Plate 0..1024 (full bleed: the desktop and the taskbar show it exactly as large as the
  other apps, measured against Claude and Roblox at 48 px) with Apple's continuous corner,
  the curve UIKit draws for app icons (APPLE_CORNER): it leaves the straight edge 1.53 r
  before the corner and bends with continuous curvature. r is 22.37 % of the plate, Mike
  Swanson's fit to Apple's own AppIconMask (34 of 152); Apple publishes no number.
- The glyph is drawn on the grid of a 16..1008 plate (GRID) and scales with the plate, so it
  keeps its share of the plate and its optical centre.
- Folder 181..843 wide; tab 226..300 (45 degree slope 425 -> 499), body 300..778. One radius
  (69) everywhere: the body and tab corners with 60 % corner smoothing (SMOOTHING, as Figma:
  the curve leaves the straight edge at 1.6 r with zero curvature, the circular middle keeps
  radius r), the slope with two circular fillets. Its bounding box sits 10 of 1024 above the
  middle (the classical optical centre); the centroid of the white area (folder minus check)
  lies about 8 below it. 10 lower than before (user, 2026-09-26: the folder looked slightly
  too high).
- Check: one stroke width (83), round caps and join, cut out of the folder (even-odd), so the
  plate shows through. Optically centred in the body: the box is centred and moved
  up by half the distance between box centre and mass centre (the heavy bottom vertex).
- One flat colour: the app's --brand token (the cxpertise coral), the glyph --brand-glyph
  (white), no gradient. No shadow on Windows; Apple's template shadow under the macOS plate.

Colours: the tokens of ui/src/styles/tokens.css, read from tools/palette.json, which
tools/tokens.mjs writes. `npm run regen` runs both: a new palette in tokens.css redraws every
icon (docs/CHANGING.md).

Small stages are hinted: straight edges on whole pixels (proportional positions, rounded
symmetrically), check vertices on half pixels, the check bolder up to 40 px.

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
# the folder with the check cut out of it --brand-glyph (tools/palette.json, generated from
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
# Corner smoothing of the folder's corners (see `smooth_corner`). The plate has Apple's own
# continuous corner instead (see `apple_corner`), with a radius of 22.37 % of the plate.
SMOOTHING = 0.6

# 1024 grid. The glyph's coordinates below are drawn on a plate from GRID to 1024 - GRID;
# the Windows plate itself runs from PLATE (0: full bleed) to 1024 - PLATE.
GRID = 16
PLATE = 0
PLATE_R = 0.2237 * (1024 - 2 * PLATE)
# The folder 75 % of the plate wide, the check 65 units thick and 70 % of its arms (user,
# 2026-09-30, set in the icon workshop against the Claude app's icon): the first shape scaled
# about its centre, the check's arms at 45 degrees, placed like before.
FOLDER_X0, FOLDER_X1 = 140, 884
TAB_Y, BODY_Y0, BODY_Y1 = 190, 273, 810
SLOPE_X0, SLOPE_X1 = 414, 497
FOLDER_R = 78
CHECK_POINTS = [(392.5, 530), (475.5, 613), (631.5, 457)]
CHECK_W = 65
# macOS: Apple's grid, plate 824 of 1024 (margin 100, fractional at the smaller sizes) with the
# same corner, 22.37 % of the plate.
MAC_PLATE = 100
MAC_PLATE_R = 0.2237 * (1024 - 2 * MAC_PLATE)
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
# Check width in pixels at the small stages (bolder than the plain scale, which would be
# 1.1 px at 16).
MIN_CHECK_W = {16: 1.57, 20: 1.79, 24: 1.95, 30: 2.11, 32: 2.17, 36: 2.28, 40: 2.38}
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
                # moves the implied centre a lot (0.6 px for the check's caps at 1024), so an
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


def smooth_corner(path, v, e, f, r, xi=SMOOTHING):
    """A 90 degree corner at `v` (incoming direction e, outgoing f, clockwise) with radius r and
    corner smoothing xi: straight -> cubic (curvature from 0) -> circular arc -> cubic ->
    straight, symmetric about the diagonal. The path must stand at v - p*e."""
    p = (1 + xi) * r
    arc_deg = 90 * (1 - xi)
    s = math.sin(math.radians(arc_deg / 2)) * r * math.sqrt(2)  # arc chord per axis
    alpha = (90 - arc_deg) / 2
    p3p4 = r * math.tan(math.radians(alpha / 2))
    beta = 45 * xi
    c = p3p4 * math.cos(math.radians(beta))
    d = c * math.tan(math.radians(beta))
    b = (p - s - c - d) / 3
    a = 2 * b
    start = add(v, (-p, e))
    path.cubic(add(start, (a, e)), add(start, (a + b, e)), add(start, (a + b + c, e), (d, f)))
    center = add(v, (-r, e), (r, f))
    mid0 = path.pos
    arc_end = add(mid0, (s, e), (s, f))
    for q in (mid0, arc_end):
        assert abs(math.dist(q, center) - r) < 1e-6 * max(r, 1), 'arc points off the circle'
    a0 = math.atan2(mid0[1] - center[1], mid0[0] - center[0])
    a1 = math.atan2(arc_end[1] - center[1], arc_end[0] - center[0])
    if a1 < a0:  # clockwise on screen = increasing angle
        a1 += 2 * math.pi
    path.arc(center, r, a0, a1)
    path.cubic(add(arc_end, (d, e), (c, f)), add(arc_end, (d, e), (b + c, f)),
               add(arc_end, (d, e), (a + b + c, f)))
    return p


def fillet(path, v, e, f, r):
    """A circular fillet of radius r at `v` between directions e and f (any angle, either
    turn). The path must stand at v - t*e with t = fillet_length(e, f, r)."""
    cross = e[0] * f[1] - e[1] * f[0]
    phi = math.acos(max(-1, min(1, e[0] * f[0] + e[1] * f[1])))
    t = r * math.tan(phi / 2)
    t1 = add(v, (-t, e))
    n = (-e[1], e[0]) if cross > 0 else (e[1], -e[0])
    center = add(t1, (r, n))
    t2 = add(v, (t, f))
    a0 = math.atan2(t1[1] - center[1], t1[0] - center[0])
    a1 = math.atan2(t2[1] - center[1], t2[0] - center[0])
    if cross > 0 and a1 < a0:
        a1 += 2 * math.pi
    if cross < 0 and a1 > a0:
        a1 -= 2 * math.pi
    path.arc(center, r, a0, a1)


def fillet_length(e, f, r):
    phi = math.acos(max(-1, min(1, e[0] * f[0] + e[1] * f[1])))
    return r * math.tan(phi / 2)


def unit(dx, dy):
    n = math.hypot(dx, dy)
    return (dx / n, dy / n)


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


def folder(g):
    """Folder outline, clockwise from the tab's top edge."""
    r = g['folder_r']
    x0, x1, tab_y, y0, y1 = g['x0'], g['x1'], g['tab_y'], g['y0'], g['y1']
    s0, s1 = g['slope_x0'], g['slope_x1']
    slope = unit(s1 - s0, y0 - tab_y)
    p = (1 + SMOOTHING) * r
    path = Path2((x0 + p, tab_y))
    t_top = fillet_length(RIGHT, slope, r)
    path.line(add((s0, tab_y), (-t_top, RIGHT)))
    fillet(path, (s0, tab_y), RIGHT, slope, r)
    t_bottom = fillet_length(slope, RIGHT, r)
    path.line(add((s1, y0), (-t_bottom, slope)))
    fillet(path, (s1, y0), slope, RIGHT, r)
    for v, e, f in [((x1, y0), RIGHT, DOWN), ((x1, y1), DOWN, LEFT), ((x0, y1), LEFT, UP)]:
        path.line(add(v, (-p, e)))
        smooth_corner(path, v, e, f, r)
    path.line(add((x0, tab_y), (-p, UP)))
    smooth_corner(path, (x0, tab_y), UP, RIGHT, r)
    return path


def check(g):
    """Outline of the check stroke (round caps, round outer join), clockwise."""
    (ax, ay), (bx, by), (cx, cy) = g['check']
    h = g['check_w'] / 2
    u1, u2 = unit(bx - ax, by - ay), unit(cx - bx, cy - by)
    # Left normals in screen coordinates (y down): rotate the direction by -90 degrees.
    n1, n2 = (u1[1], -u1[0]), (u2[1], -u2[0])
    a_l, b_l1 = add((ax, ay), (h, n1)), add((bx, by), (h, n1))
    b_l2, c_l = add((bx, by), (h, n2)), add((cx, cy), (h, n2))
    # Inner corner: the two left offset lines meet.
    den = u1[0] * u2[1] - u1[1] * u2[0]
    t = ((b_l2[0] - a_l[0]) * u2[1] - (b_l2[1] - a_l[1]) * u2[0]) / den
    inner = add(a_l, (t, u1))
    ang = lambda v: math.atan2(v[1], v[0])
    path = Path2(a_l)
    path.line(inner)
    path.line(c_l)
    # Cap at C: half circle from the left side over the tip to the right side.
    a0 = ang(n2)
    path.arc((cx, cy), h, a0, a0 + math.pi)
    path.line(add((bx, by), (-h, n2)))
    # Outer join at B: from the right side of the second arm back to that of the first.
    a0, a1 = ang((-n2[0], -n2[1])), ang((-n1[0], -n1[1]))
    if a1 < a0:
        a1 += 2 * math.pi
    path.arc((bx, by), h, a0, a1)
    path.line(add((ax, ay), (-h, n1)))
    a0 = ang((-n1[0], -n1[1]))
    path.arc((ax, ay), h, a0, a0 + math.pi)
    return path


# --------------------------------------------------------------------------- layout

def layout(s, mac=False):
    """Geometry of one stage in target pixels. Straight edges are placed proportionally on
    the plate and rounded symmetrically to whole pixels; radii and the check scale freely
    (check vertices on half pixels at small sizes)."""
    # Windows: the plate runs to the edge of every stage (like the other apps in the taskbar);
    # macOS keeps Apple's margin, fractional below 1024 (3.125 at 32): its edge is anti-aliased
    # like any other, so every entry is the same icon scaled.
    margin = (MAC_PLATE if mac else PLATE) * s / 1024
    plate = s - 2 * margin
    unit_ = plate / (1024 - 2 * GRID)  # one unit of the glyph's grid on this plate

    def pos(v):
        return margin + (v - GRID) * unit_

    def snap(v):
        return round(pos(v)) if s <= 256 else pos(v)

    side = snap(FOLDER_X0) - margin
    g = dict(
        s=s,
        plate=(margin, margin, s - margin, s - margin),
        plate_r=(MAC_PLATE_R if mac else PLATE_R) * s / 1024,
        x0=margin + side,
        x1=s - margin - side,
        tab_y=snap(TAB_Y),
        y0=snap(BODY_Y0),
        y1=snap(BODY_Y1),
        slope_x0=pos(SLOPE_X0),
        folder_r=FOLDER_R * unit_,
    )
    g['slope_x1'] = g['slope_x0'] + (g['y0'] - g['tab_y'])  # keep the slope at 45 degrees

    def point(x, y):
        """Same place in the (snapped) folder body as on the grid."""
        px = g['x0'] + (x - FOLDER_X0) / (FOLDER_X1 - FOLDER_X0) * (g['x1'] - g['x0'])
        py = g['y0'] + (y - BODY_Y0) / (BODY_Y1 - BODY_Y0) * (g['y1'] - g['y0'])
        if s <= 64:
            px, py = round(px * 2) / 2, round(py * 2) / 2
        return (px, py)

    g['check'] = [point(x, y) for x, y in CHECK_POINTS]
    g['check_w'] = max(CHECK_W * unit_, MIN_CHECK_W.get(s, 0))
    # The check stays a check: its arms keep the 45 degree directions after snapping.
    (ax, ay), (bx, by), (cx, cy) = g['check']
    g['check'][0] = (bx - (by - ay), ay)
    g['check'][2] = (bx + (by - cy), cy)
    return g


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
    the colour is the coral, mixed with white by the glyph's exact coverage (folder minus the
    check), everywhere on the canvas; the alpha is the plate's exact coverage. A partly
    covered edge pixel therefore carries the plate colour, never a mix with the black of an
    empty canvas. Transparent pixels are coloured by `bleed`.

    macOS puts the plate over Apple's black template shadow (`shadow`), composited exactly:
    alpha = plate + shadow x (1 - plate), colour = plate colour x plate / alpha. The plate itself
    is the same as without the shadow; around it only black shows through."""
    g = layout(s, mac)
    plate = coverage(s, [(squircle(*g['plate'], g['plate_r']).points(), 1)])
    glyph = coverage(s, [(folder(g).points(), 1), (check(g).points(), -1)])
    if not mac:
        data = [(*glyph_colour(w), level(c)) for c, w in zip(plate, glyph)]
    else:
        data = []
        for c, w, below in zip(plate, glyph, shadow(s, g)):
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


def build_svg(out):
    g = layout(1024)
    fmt = svg_number
    x0, y0, x1, y1 = g['plate']
    out.write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{fmt(x0)} {fmt(y0)} {fmt(x1 - x0)} {fmt(y1 - y0)}" width="{fmt(x1 - x0)}" height="{fmt(y1 - y0)}">
  <!-- Generated by tools/icon.py - do not edit. The app icon as a vector: the same paths as
       icon.ico, icon.icns and icon.png; the check is cut out of the folder (even-odd). -->
  <path fill="{hex_colour(BRAND)}" d="{squircle(x0, y0, x1, y1, g['plate_r']).svg(fmt)}"/>
  <path fill="{hex_colour(GLYPH)}" fill-rule="evenodd" d="{folder(g).svg(fmt)}{check(g).svg(fmt)}"/>
</svg>
''', encoding='utf-8', newline='\n')


def build_icon_composer(package):
    """macOS 26: an Icon Composer package (`<name>.icon`: icon.json and its Assets). The system
    draws the shape, the glass, the lighting and the shadow itself, so the package holds only
    the background fill (the coral) and one group with one layer, the white glyph with the
    check cut out. The glyph is laid out on the full 1024 square as on the full-bleed plate:
    the system's own mask takes the plate's place. No mask, no shadow baked in. The macOS CI
    compiles it with actool into Assets.car (see .github/workflows/ci.yml); icon.icns stays
    the icon of macOS 14 and 15. The keys follow Tauri's own example (examples/.icons)."""
    g = layout(1024)
    fmt = svg_number
    (package / 'Assets').mkdir(parents=True, exist_ok=True)
    (package / 'Assets' / 'glyph.svg').write_text(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- Generated by tools/icon.py - do not edit. The glyph of the macOS 26 icon: the same path
       as in app-icon.svg, on the full square; the check is cut out of the folder. -->
  <path fill="{hex_colour(GLYPH)}" fill-rule="evenodd" d="{folder(g).svg(fmt)}{check(g).svg(fmt)}"/>
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
