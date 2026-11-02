# Codex images (blender/textures/raw/*.png) → compact textures for Blender (blender/textures/):
#   poster_*.png  green chroma background keyed to alpha (green fringe removed), 1024 px long edge
#   *_tile.jpg    1024² tiling textures, graffiti.jpg 1024² (black background = no paint)
# Run: Blender -b --factory-startup -P blender/scripts/prep_textures.py
import os
import numpy as np
import OpenImageIO as oiio

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
RAW = os.path.join(ROOT, "blender", "textures", "raw")
OUT = os.path.join(ROOT, "blender", "textures")


def load(name):
    buf = oiio.ImageBuf(os.path.join(RAW, name))
    return buf


def resize(buf, long_side):
    s = buf.spec()
    k = long_side / max(s.width, s.height)
    w, h = round(s.width * k), round(s.height * k)
    return oiio.ImageBufAlgo.resize(buf, roi=oiio.ROI(0, w, 0, h, 0, 1, 0, s.nchannels))


def save(arr, name, quality=88):
    h, w, c = arr.shape
    spec = oiio.ImageSpec(w, h, c, "uint8")
    if name.endswith(".jpg"):
        spec.attribute("Compression", f"jpeg:{quality}")
    out = oiio.ImageOutput.create(os.path.join(OUT, name))
    out.open(os.path.join(OUT, name), spec)
    out.write_image(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8))
    out.close()
    print("TEX", name, w, h)


for name in ("poster_a", "poster_b"):
    a = resize(load(name + ".png"), 1024).get_pixels(oiio.FLOAT)[..., :3]
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = g - np.maximum(r, b)
    alpha = 1.0 - np.clip((green - 0.12) / 0.35, 0, 1)
    # remove green fringe: pull g down to max(r, b) where a green cast remains
    a[..., 1] = np.where(green > 0.02, np.maximum(r, b) + 0.02, g)
    save(np.dstack([a, alpha]), name + ".png")

for name in ("brick_tile", "concrete_tile", "graffiti"):
    a = resize(load(name + ".png"), 1024).get_pixels(oiio.FLOAT)[..., :3]
    save(a, name + ".jpg")
