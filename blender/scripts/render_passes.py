# Renders once (Cycles, multilayer EXR) then splits into images for the app → app/assets/scene/:
#   ambient.jpg   scene lit only by the cold street light + night sky (dark) — background when the neon is off
#   albedo.jpg    base colour (Diffuse Color pass), sRGB
#   normal.png    camera-space normals: R = x (right), G = y (up), B = z (towards camera); 0..1 = −1..1
#   data.png      R = roughness (AOV rough), G = AO (~6 cm: mortar joints, brick bases), B = ground reflectivity (AOV refl)
#   layout.json   440×956 pt design frame (iPhone 17 Pro Max), wall base line (reflection flip), m/pt, drawable area, transformer box position,
#                 drainpipe, puddle area
# Quick preview: render/preview/passes.jpg (4 layers side by side).
#
# Run: Blender -b blender/neon.blend -P blender/scripts/render_passes.py -- [--pct 100] [--samples 128]
import bpy, json, os, sys
import numpy as np
import OpenImageIO as oiio
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "app", "assets", "scene")
TMP = os.path.join(ROOT, "render", "passes")
PREV = os.path.join(ROOT, "render", "preview")
PCT = int(arg("--pct", "100"))
SAMPLES = int(arg("--samples", "128"))
for d in (OUT, TMP, PREV):
    os.makedirs(d, exist_ok=True)

sc = bpy.context.scene
r = sc.render
r.resolution_percentage = PCT
W, H = r.resolution_x, r.resolution_y            # 1320×2868 = 440×956 pt @3x
VW, VH = (list(sc["neon"]["view"]) if "neon" in sc and "view" in sc["neon"] else [W / 3, H / 3])
cam = sc.camera
vl = sc.view_layers[0]
vl.use_pass_diffuse_color = True
vl.use_pass_normal = True
vl.use_pass_ambient_occlusion = True
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
if hasattr(r.image_settings, "media_type"):          # Blender ≥ 5.0: multilayer is a media type of OPEN_EXR
    r.image_settings.media_type = "MULTI_LAYER_IMAGE"
else:
    r.image_settings.file_format = "OPEN_EXR_MULTILAYER"
r.image_settings.color_depth = "32"
exr = os.path.join(TMP, "scene.exr")
r.filepath = exr
bpy.ops.render.render(write_still=True)
print("── render scene.exr", PCT, "%", SAMPLES, "spp")


def channels(path):
    """Read every channel of a multilayer EXR → dict name → array (row 0 = top)."""
    inp = oiio.ImageInput.open(path)
    out = {}
    si = 0
    while inp.seek_subimage(si, 0):
        names = list(inp.spec().channelnames)
        px = np.asarray(inp.read_image(si, 0, 0, len(names), "float"), np.float32)
        for ci, cn in enumerate(names):
            out[cn] = px[..., ci]
        si += 1
    inp.close()
    return out


ch = channels(exr)
print("CHANNELS", sorted(ch.keys()))


def pick(*names):
    for n in names:
        for k in ch:
            if k == n or k.endswith("." + n):
                return ch[k]
    raise KeyError(names)


def rgb(prefix, comps="RGB"):
    return np.dstack([pick(f"{prefix}.{c}") for c in comps])


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def save(arr, name, quality=90, folder=OUT):
    if arr.ndim == 2:
        arr = arr[..., None]
    h, w, c = arr.shape
    spec = oiio.ImageSpec(w, h, c, "uint8")
    if name.endswith(".jpg"):
        spec.attribute("Compression", f"jpeg:{quality}")
    path = os.path.join(folder, name)
    o = oiio.ImageOutput.create(path)
    o.open(path, spec)
    o.write_image(np.ascontiguousarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8)))
    o.close()
    print("SAVE", name, w, h)


combined = rgb("Combined") if any(k.endswith("Combined.R") for k in ch) else rgb("Image")
albedo = rgb("Diffuse Color")
nw = rgb("Normal", "XYZ")
ao = pick("Ambient Occlusion.R")
rough = pick("rough.V", "rough.X", "rough") if any("rough" in k for k in ch) else np.full(ao.shape, 0.8, np.float32)
refl = pick("refl.V", "refl.X", "refl") if any("refl" in k for k in ch) else np.zeros(ao.shape, np.float32)

# normal: world → camera (camera looks along +y, up is +z): x = X, y = Z, z = −Y
ncam = np.dstack([nw[..., 0], nw[..., 2], -nw[..., 1]])
ln = np.linalg.norm(ncam, axis=2, keepdims=True)
ncam = np.where(ln > 1e-4, ncam / np.maximum(ln, 1e-4), np.array([0, 0, 1], np.float32))

save(srgb(combined), "ambient.jpg")
save(srgb(albedo), "albedo.jpg")
save(ncam * 0.5 + 0.5, "normal.png")
save(np.dstack([np.clip(rough, 0, 1), np.clip(ao, 0, 1), np.clip(refl, 0, 1)]), "data.png")

# quick preview: ambient · albedo · normal · data
th = [srgb(combined * 6.0), srgb(albedo), ncam * 0.5 + 0.5, np.dstack([rough, ao, refl])]
step = max(1, W // 300)
save(np.concatenate([t[::step, ::step] for t in th], axis=1), "passes.jpg", folder=PREV)


# ── layout (pt, VW×VH frame; origin top-left) ──
def pt(p):
    v = world_to_camera_view(sc, cam, Vector(p))
    return [round(v.x * VW, 2), round((1 - v.y) * VH, 2)]


O = bpy.data.objects
base_l, base_r = pt((-1, 0, 0)), pt((1, 0, 0))
m_per_pt = 2.0 / (base_r[0] - base_l[0])
rows, cols = np.nonzero(refl > 0.6)
puddle = None
if len(rows):
    k = VW / refl.shape[1]
    puddle = [round(cols.min() * k, 1), round(rows.min() * k, 1), round(cols.max() * k, 1), round(rows.max() * k, 1)]
box = O["transformer"]
bx = [pt(box.matrix_world @ Vector(c)) for c in box.bound_box]
layout = {
    "view": [VW, VH],
    "horizon": base_l[1],                         # y (pt) of the wall base: flip axis for puddle reflections
    "mPerPt": round(m_per_pt, 6),
    "draw": [18, 104, VW - 18, round(base_l[1] - 28, 1)],   # drawable wall area: x0, y0, x1, y1 (avoids the Dynamic Island + wall base)
    "transformer": [round(min(p[0] for p in bx), 1), round(min(p[1] for p in bx), 1),
                    round(max(p[0] for p in bx), 1), round(max(p[1] for p in bx), 1)],
    "pipeX": pt((0.86, 0, 1.0))[0],
    "puddle": puddle,
    "street": pt((-2.6, 0, 4.8)),                 # street light direction (off-frame, top-left)
    "reflK": 2.0,                                 # puddle reflection: y_wall = horizon − (y − horizon)·reflK (compressed so the sign is visible)
}
with open(os.path.join(OUT, "layout.json"), "w") as f:
    json.dump(layout, f, indent=1)
print("LAYOUT", json.dumps(layout))
