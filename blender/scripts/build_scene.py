# Builds the night-alley scene in code: brick wall (each brick bevelled + chipped edges, recessed mortar), damp streaks, torn posters, faded graffiti,
# drainpipe, transformer box, wet concrete ground with puddles, cold street light top-left, portrait camera 1320×2868 (iPhone 17 Pro Max, 440×956 pt @3x).
# Saves blender/neon.blend. Units are metres. The wall face is the plane y = 0 (bricks stick out towards y < 0), wall base at z = 0;
# the camera is level and looks along +y, so the wall is parallel to the image plane: 1 screen pt = M_PER_PT metres on the wall.
#
# Run: Blender -b --factory-startup -P blender/scripts/build_scene.py
import bpy, bmesh, math, os, random
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TEX = os.path.join(ROOT, "blender", "textures")
BLEND = os.environ.get("NEON_BLEND", os.path.join(ROOT, "blender", "neon.blend"))
rng = random.Random(7)
rad = math.radians

# ── camera: level, at height CAM_H, CAM_D from the wall, 50 mm, 36 mm horizontal sensor ──
CAM_D, CAM_H, LENS = 2.6, 1.15, 50.0
FRAME_W = CAM_D * 36.0 / LENS                    # visible wall width (m)
SCREEN_PX = (1320, 2868)                         # iPhone 17 Pro Max screen (px)
VIEW_PT = (440, 956)                             # design frame (pt)
FRAME_H = FRAME_W * SCREEN_PX[1] / SCREEN_PX[0]
WALL_X = (-1.25, 1.25)
WALL_Z = (0.0, CAM_H + FRAME_H / 2 + 0.25)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def hexc(h, a=1.0):
    h = h.lstrip("#")
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (a,)


def obj(name, data, coll=None):
    ob = bpy.data.objects.new(name, data)
    (coll or sc.collection).objects.link(ob)
    return ob


def img(name, colorspace="sRGB"):
    im = bpy.data.images.load(os.path.join(TEX, name), check_existing=True)
    im.colorspace_settings.name = colorspace
    return im


class M:
    """Material node-building helpers. Every material also writes 2 AOVs: rough (roughness) and refl (ground reflectivity)."""

    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.m.use_nodes = True
        self.nt = self.m.node_tree
        self.n = self.nt.nodes
        self.bsdf = next(n for n in self.n if n.type == "BSDF_PRINCIPLED")
        self.out = next(n for n in self.n if n.type == "OUTPUT_MATERIAL")

    def node(self, t, **kw):
        nd = self.n.new(t)
        for k, v in kw.items():
            if k in nd.inputs:
                nd.inputs[k].default_value = v
            else:
                setattr(nd, k, v)
        return nd

    def link(self, a, b):
        self.nt.links.new(a, b)

    def val(self, v):
        n = self.node("ShaderNodeValue"); n.outputs[0].default_value = v
        return n.outputs[0]

    def math(self, op, a, b=None, clamp=False):
        n = self.node("ShaderNodeMath", operation=op); n.use_clamp = clamp
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                n.inputs[i].default_value = x
            else:
                self.link(x, n.inputs[i])
        return n.outputs[0]

    def mix(self, fac, a, b, blend="MIX"):
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        ins = [s for s in n.inputs if s.type == "RGBA"]
        for s, x in ((n.inputs["Factor"], fac), (ins[0], a), (ins[1], b)):
            if isinstance(x, (int, float)):
                s.default_value = x
            elif isinstance(x, tuple):
                s.default_value = x
            else:
                self.link(x, s)
        return [s for s in n.outputs if s.type == "RGBA"][0]

    def ramp(self, fac, stops):
        r = self.node("ShaderNodeValToRGB")
        el = r.color_ramp.elements
        for i, (p, c) in enumerate(stops):
            e = el[i] if i < len(el) else el.new(p)
            e.position, e.color = p, c
        self.link(fac, r.inputs["Fac"])
        return r.outputs["Color"]

    def noise(self, scale, detail=4.0, vec=None, rough=0.5):
        n = self.node("ShaderNodeTexNoise", **{"Scale": scale, "Detail": detail, "Roughness": rough})
        if vec is not None:
            self.link(vec, n.inputs["Vector"])
        return n

    def world_xyz(self, scale=(1, 1, 1)):
        tc = self.node("ShaderNodeTexCoord")
        mp = self.node("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = scale
        self.link(tc.outputs["Object"], mp.inputs["Vector"])
        return mp.outputs["Vector"]

    def tex(self, image, vec, colorspace="sRGB"):
        t = self.node("ShaderNodeTexImage"); t.image = img(image, colorspace); t.extension = "REPEAT"
        self.link(vec, t.inputs["Vector"])
        return t

    def bump(self, height, strength, dist=0.002, normal=None):
        b = self.node("ShaderNodeBump", **{"Strength": strength, "Distance": dist})
        self.link(height, b.inputs["Height"])
        if normal is not None:
            self.link(normal, b.inputs["Normal"])
        return b.outputs["Normal"]

    def smooth(self, x, a, b, lo=0.0, hi=1.0):
        """smoothstep(a, b, x) → lo..hi (Map Range, clamped)."""
        n = self.node("ShaderNodeMapRange", **{"From Min": a, "From Max": b, "To Min": lo, "To Max": hi})
        n.interpolation_type = "SMOOTHSTEP"; n.clamp = True
        self.link(x, n.inputs["Value"])
        return n.outputs[0]

    def aov(self, name, value):
        a = self.node("ShaderNodeOutputAOV"); a.aov_name = name
        if isinstance(value, (int, float)):
            a.inputs["Value"].default_value = value
        else:
            self.link(value, a.inputs["Value"])

    def finish(self, color, rough, normal=None, refl=0.0, metallic=0.0, spec=0.5):
        if isinstance(color, tuple):
            self.bsdf.inputs["Base Color"].default_value = color
        else:
            self.link(color, self.bsdf.inputs["Base Color"])
        if isinstance(rough, (int, float)):
            self.bsdf.inputs["Roughness"].default_value = rough
        else:
            self.link(rough, self.bsdf.inputs["Roughness"])
        if normal is not None:
            self.link(normal, self.bsdf.inputs["Normal"])
        self.bsdf.inputs["Metallic"].default_value = metallic
        self.bsdf.inputs["Specular IOR Level"].default_value = spec
        self.aov("rough", rough)
        self.aov("refl", refl)
        return self.m


def damp(mm, xyz):
    """Vertical damp streaks (0..1): noise stretched along z, darkening towards the wall base."""
    st = mm.node("ShaderNodeMapping"); st.inputs["Scale"].default_value = (5.0, 5.0, 0.35)
    mm.link(xyz, st.inputs["Vector"])
    n = mm.noise(3.0, 6.0, st.outputs["Vector"], 0.62)
    streak = mm.smooth(n.outputs["Fac"], 0.52, 0.66)
    sep = mm.node("ShaderNodeSeparateXYZ"); mm.link(xyz, sep.inputs[0])
    rmp = mm.node("ShaderNodeMapRange", **{"From Min": 0.9, "From Max": 0.05, "To Min": 0.0, "To Max": 1.0})
    rmp.clamp = True
    mm.link(sep.outputs["Z"], rmp.inputs["Value"])
    # strong damp streaks in the upper half (water leaking from the gutter) + damp wall base
    top = mm.node("ShaderNodeMapRange", **{"From Min": 1.2, "From Max": 3.6, "To Min": 0.25, "To Max": 1.0}); top.clamp = True
    mm.link(sep.outputs["Z"], top.inputs["Value"])
    s2 = mm.math("MULTIPLY", streak, top.outputs[0])
    return mm.math("MAXIMUM", s2, mm.math("MULTIPLY", rmp.outputs[0], 0.8), clamp=True)


def graffiti_mask(mm, xyz):
    """Faded graffiti: Codex image (black background) projected onto a patch of the wall, returns (paint colour, coverage)."""
    mp = mm.node("ShaderNodeMapping")
    # graffiti patch 1.6 m × 1.6 m, bottom-left corner at (-0.95, 0.35)
    mp.inputs["Location"].default_value = (0.95 / 1.6, 0, -0.35 / 1.6)
    mp.inputs["Scale"].default_value = (1 / 1.6, 1, 1 / 1.6)
    mm.link(xyz, mp.inputs["Vector"])
    sw = mm.node("ShaderNodeSeparateXYZ"); mm.link(mp.outputs["Vector"], sw.inputs[0])
    cmb = mm.node("ShaderNodeCombineXYZ"); mm.link(sw.outputs["X"], cmb.inputs["X"]); mm.link(sw.outputs["Z"], cmb.inputs["Y"])
    t = mm.node("ShaderNodeTexImage"); t.image = img("graffiti.jpg"); t.extension = "CLIP"
    mm.link(cmb.outputs["Vector"], t.inputs["Vector"])
    lum = mm.node("ShaderNodeRGBToBW"); mm.link(t.outputs["Color"], lum.inputs[0])
    cov = mm.smooth(lum.outputs[0], 0.08, 0.4, 0.0, 0.38)
    return t.outputs["Color"], cov


# ── materials ──
def mat_brick():
    mm = M("brick")
    xyz = mm.world_xyz()
    attr = mm.node("ShaderNodeAttribute", attribute_name="brick_rnd", attribute_type="GEOMETRY")
    rnd = attr.outputs["Fac"]
    # each brick samples a different area of the texture (offset by the brick's random number)
    off = mm.node("ShaderNodeCombineXYZ")
    mm.link(mm.math("MULTIPLY", rnd, 7.31), off.inputs["X"]); mm.link(mm.math("MULTIPLY", rnd, 3.17), off.inputs["Z"])
    va = mm.node("ShaderNodeVectorMath", operation="ADD"); mm.link(xyz, va.inputs[0]); mm.link(off.outputs[0], va.inputs[1])
    uvm = mm.node("ShaderNodeMapping"); uvm.inputs["Scale"].default_value = (2.2, 2.2, 2.2); mm.link(va.outputs[0], uvm.inputs["Vector"])
    sep = mm.node("ShaderNodeSeparateXYZ"); mm.link(uvm.outputs["Vector"], sep.inputs[0])
    uv = mm.node("ShaderNodeCombineXYZ"); mm.link(sep.outputs["X"], uv.inputs["X"]); mm.link(sep.outputs["Z"], uv.inputs["Y"])
    t = mm.tex("brick_tile.jpg", uv.outputs["Vector"])
    # brick tone: orange-red → dark brown → a few burnt-black / faded bricks
    tint = mm.ramp(rnd, [(0.0, hexc("#5a1d14")), (0.25, hexc("#8a3322")), (0.55, hexc("#a2462c")),
                         (0.8, hexc("#6e2a1f")), (0.93, hexc("#3a2420")), (1.0, hexc("#9a7a66"))])
    col = mm.mix(0.75, t.outputs["Color"], tint, "MULTIPLY")
    col = mm.mix(0.55, col, tint, "MIX")
    # dirt / soot: large dark noise
    dirt = mm.noise(1.4, 5.0, xyz, 0.6)
    # darken at most ~10 %: previously ×0.55 → under the neon it became black soot stains spreading below the heart (art director v61–v63)
    dk = mm.ramp(dirt.outputs["Fac"], [(0.35, (1, 1, 1, 1)), (0.7, (0.9, 0.89, 0.88, 1))])
    col = mm.mix(1.0, col, dk, "MULTIPLY")
    # white salt (efflorescence) blotches in the lower half
    ef = mm.noise(4.0, 6.0, xyz, 0.65)
    sepz = mm.node("ShaderNodeSeparateXYZ"); mm.link(xyz, sepz.inputs[0])
    low = mm.smooth(sepz.outputs["Z"], 1.4, 0.2)
    efm = mm.math("MULTIPLY", mm.smooth(ef.outputs["Fac"], 0.56, 0.72, 0.0, 0.55), low)
    col = mm.mix(efm, col, hexc("#9c9187"))
    gcol, gcov = graffiti_mask(mm, xyz)
    col = mm.mix(gcov, col, gcol)
    wet = damp(mm, xyz)
    col = mm.mix(mm.math("MULTIPLY", wet, 0.5), col, (0.0, 0.0, 0.0, 1.0))
    rough = mm.math("SUBTRACT", 0.82, mm.math("MULTIPLY", wet, 0.55))
    # brick surface pitting
    pit = mm.noise(55.0, 3.0, xyz, 0.7)
    tl = mm.node("ShaderNodeRGBToBW"); mm.link(t.outputs["Color"], tl.inputs[0])
    h = mm.math("ADD", mm.math("MULTIPLY", pit.outputs["Fac"], 0.6), mm.math("MULTIPLY", tl.outputs[0], 0.8))
    return mm.finish(col, rough, mm.bump(h, 0.35, 0.002))


def mat_mortar():
    mm = M("mortar")
    xyz = mm.world_xyz()
    n = mm.noise(18.0, 6.0, xyz, 0.65)
    col = mm.ramp(n.outputs["Fac"], [(0.3, hexc("#2b2622")), (0.6, hexc("#5a524a")), (0.8, hexc("#6e665c"))])
    gcol, gcov = graffiti_mask(mm, xyz)
    col = mm.mix(gcov, col, gcol)
    wet = damp(mm, xyz)
    col = mm.mix(mm.math("MULTIPLY", wet, 0.55), col, (0.0, 0.0, 0.0, 1.0))
    rough = mm.math("SUBTRACT", 0.92, mm.math("MULTIPLY", wet, 0.45))
    g = mm.noise(90.0, 2.0, xyz, 0.8)
    return mm.finish(col, rough, mm.bump(g.outputs["Fac"], 0.6, 0.003))


def mat_ground():
    mm = M("ground")
    xyz = mm.world_xyz()
    sep = mm.node("ShaderNodeSeparateXYZ"); mm.link(xyz, sep.inputs[0])
    uv = mm.node("ShaderNodeCombineXYZ")
    mm.link(mm.math("MULTIPLY", sep.outputs["X"], 0.9), uv.inputs["X"]); mm.link(mm.math("MULTIPLY", sep.outputs["Y"], 0.9), uv.inputs["Y"])
    t = mm.tex("concrete_tile.jpg", uv.outputs["Vector"])
    col = mm.mix(0.6, t.outputs["Color"], hexc("#2a2a2c"), "MULTIPLY")
    # puddles: thresholded noise, stretched along x, concentrated in the middle in front of the wall base
    pm = mm.node("ShaderNodeMapping")
    pm.inputs["Location"].default_value = (0.0, 0.0, 0.0); pm.inputs["Scale"].default_value = (0.75, 1.35, 1.0)
    mm.link(xyz, pm.inputs["Vector"])
    pn = mm.noise(1.1, 3.0, pm.outputs["Vector"], 0.55)
    # distance to the puddle centre (0.05, -0.62)
    d = mm.node("ShaderNodeVectorMath", operation="DISTANCE")
    mm.link(pm.outputs["Vector"], d.inputs[0]); d.inputs[1].default_value = (0.0, -0.55 * 1.35, 0.0)
    shape = mm.math("SUBTRACT", mm.math("MULTIPLY", pn.outputs["Fac"], 1.0), mm.math("MULTIPLY", d.outputs["Value"], 0.8))
    sm = mm.node("ShaderNodeMapRange", **{"From Min": 0.12, "From Max": 0.17, "To Min": 0.0, "To Max": 1.0}); sm.clamp = True
    mm.link(shape, sm.inputs["Value"])
    puddle = sm.outputs[0]
    # ground wet everywhere (roughness 0.35), puddles nearly mirror-like
    col = mm.mix(mm.math("MULTIPLY", puddle, 0.75), col, hexc("#060607"))
    rough = mm.math("SUBTRACT", 0.38, mm.math("MULTIPLY", puddle, 0.36))
    refl = mm.math("ADD", 0.22, mm.math("MULTIPLY", puddle, 0.78))
    bn = mm.noise(40.0, 4.0, xyz, 0.6)
    bmp = mm.math("MULTIPLY", bn.outputs["Fac"], mm.math("SUBTRACT", 1.0, puddle))
    return mm.finish(col, rough, mm.bump(bmp, 0.5, 0.004), refl=refl, spec=0.6)


def mat_poster(name, image):
    mm = M(name)
    t = mm.node("ShaderNodeTexImage"); t.image = img(image)
    t.extension = "CLIP"
    uvn = mm.node("ShaderNodeUVMap"); mm.link(uvn.outputs["UV"], t.inputs["Vector"])
    xyz = mm.world_xyz()
    wet = damp(mm, xyz)
    col = mm.mix(0.35, t.outputs["Color"], hexc("#3a3028"), "MULTIPLY")
    col = mm.mix(mm.math("MULTIPLY", wet, 0.4), col, (0, 0, 0, 1))
    w = mm.noise(9.0, 4.0, xyz, 0.5)
    m_ = mm.finish(col, 0.7, mm.bump(w.outputs["Fac"], 0.25, 0.004))
    mm.link(t.outputs["Alpha"], mm.bsdf.inputs["Alpha"])
    m_.blend_method = "HASHED" if hasattr(m_, "blend_method") else None
    return m_


def mat_metal(name, color, rough, rust=0.0):
    mm = M(name)
    xyz = mm.world_xyz()
    col = hexc(color)
    r = rough
    if rust > 0:
        n = mm.noise(14.0, 6.0, xyz, 0.6)
        rm = mm.ramp(n.outputs["Fac"], [(0.55, (0, 0, 0, 1)), (0.7, (1, 1, 1, 1))])
        bw = mm.node("ShaderNodeRGBToBW"); mm.link(rm, bw.inputs[0])
        f = mm.math("MULTIPLY", bw.outputs[0], rust)
        col = mm.mix(f, col, hexc("#4a2414"))
        r = mm.math("ADD", rough, mm.math("MULTIPLY", f, 0.5))
    return mm.finish(col, r, metallic=0.85)


def mat_plain(name, color, rough, metallic=0.0):
    mm = M(name)
    return mm.finish(hexc(color), rough, metallic=metallic)


MAT_BRICK, MAT_MORTAR, MAT_GROUND = mat_brick(), mat_mortar(), mat_ground()

# ── brick wall: each brick is a box with varied size / colour / protrusion, bevel + displace for chipped edges ──
me = bpy.data.meshes.new("bricks")
bm = bmesh.new()
rnd_layer = bm.faces.layers.float.new("brick_rnd")
z = WALL_Z[0] + 0.004
row = 0
n_bricks = 0
while z < WALL_Z[1]:
    bh = rng.uniform(0.060, 0.068)
    x = WALL_X[0] - (0.11 if row % 2 else 0.0) - rng.uniform(0, 0.03)
    while x < WALL_X[1]:
        bl = rng.uniform(0.195, 0.232)
        joint = rng.uniform(0.008, 0.013)
        cx, cz = x + bl / 2, z + bh / 2 + rng.uniform(-0.0015, 0.0015)
        out = rng.uniform(0.0, 0.004) if rng.random() < 0.8 else rng.uniform(0.004, 0.009)
        r = rng.random()
        res = bmesh.ops.create_cube(bm, size=1.0)
        vs = res["verts"]
        bmesh.ops.scale(bm, vec=(bl, 0.1, bh), verts=vs)
        rot_y = rng.uniform(-0.6, 0.6)
        for v in vs:
            v.co = Vector((v.co.x * math.cos(rad(rot_y)) - v.co.z * math.sin(rad(rot_y)), v.co.y,
                           v.co.x * math.sin(rad(rot_y)) + v.co.z * math.cos(rad(rot_y))))
            v.co += Vector((cx, 0.05 - out, cz))
        fs = {f for v in vs for f in v.link_faces}
        for f in fs:
            f[rnd_layer] = r
        x += bl + joint
        n_bricks += 1
    z += bh + rng.uniform(0.009, 0.012)
    row += 1
bm.to_mesh(me)
bm.free()
bricks = obj("bricks", me)
me.materials.append(MAT_BRICK)
bv = bricks.modifiers.new("bevel", "BEVEL"); bv.width, bv.segments, bv.limit_method = 0.004, 2, "ANGLE"
ss = bricks.modifiers.new("subd", "SUBSURF"); ss.subdivision_type = "SIMPLE"; ss.levels = ss.render_levels = 3
tx = bpy.data.textures.new("chip", "VORONOI"); tx.noise_scale = 0.06; tx.distance_metric = "DISTANCE"
dp = bricks.modifiers.new("chip", "DISPLACE"); dp.texture = tx; dp.texture_coords = "GLOBAL"; dp.strength = -0.005; dp.mid_level = 0.8
print("BRICKS", n_bricks, "rows", row)

# mortar: a plane recessed 1 cm behind the brick faces
bpy.ops.mesh.primitive_plane_add(size=1)
mort = bpy.context.active_object; mort.name = "mortar"
# the plane lies in local XY then rotates 90° around X → wall height is the scale along local Y (not Z). Previously
# (…, 1, height) → mortar only covered z 1.2–2.2 m, outside that band the brick joints showed the black background → a horizontal seam right below "hello"
# (image y ≈ 1388 px) and the lower brick rows had black gaps.
mort.scale = (WALL_X[1] - WALL_X[0], WALL_Z[1] - WALL_Z[0] + 0.1, 1)
mort.rotation_euler = (rad(90), 0, 0)
mort.location = (0, 0.010, (WALL_Z[0] + WALL_Z[1]) / 2)
mort.data.materials.append(MAT_MORTAR)

# ── wet concrete ground ──
bpy.ops.mesh.primitive_plane_add(size=1)
gr = bpy.context.active_object; gr.name = "ground"
gr.scale = (6, 5, 1); gr.location = (0, -2.5 + 0.06, 0)
gr.data.materials.append(MAT_GROUND)

# ── torn posters (Codex images, green background keyed to alpha) ──
def poster(name, image, w, h, loc, rot=0.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    nx, nz = 8, 10
    uvl = bm.loops.layers.uv.new()
    grid = [[bm.verts.new((((i / nx) - 0.5) * w, 0, ((k / nz) - 0.5) * h)) for i in range(nx + 1)] for k in range(nz + 1)]
    for k in range(nz):
        for i in range(nx):
            f = bm.faces.new((grid[k][i], grid[k][i + 1], grid[k + 1][i + 1], grid[k + 1][i]))
            for l in f.loops:
                l[uvl].uv = (l.vert.co.x / w + 0.5, l.vert.co.z / h + 0.5)
    # wet paper slightly bulging, following the brick surface
    for v in bm.verts:
        v.co.y = -0.012 - 0.0025 * math.sin(v.co.x * 23 + v.co.z * 17) * math.sin(v.co.z * 31)
    bm.to_mesh(me); bm.free()
    ob = obj(name, me)
    ob.location = loc; ob.rotation_euler = (0, rad(rot), 0)
    me.materials.append(mat_poster(name, image))
    return ob


poster("poster_a", "poster_a.png", 0.42, 0.60, (-0.66, 0, 2.55), 2.5)
# poster_b moved 0.26 m left (02/11, art director v61: the poster under the star was lit by the star, competing for attention) → half of it
# outside the frame (app frame zoomed 1.13: visible left edge at x ≈ −0.83 m)
poster("poster_b", "poster_b.png", 0.36, 0.48, (-0.84, 0, 0.62), -3.0)

# ── drainpipe on the right edge + brackets ──
MAT_PIPE = mat_metal("pipe", "#5d6266", 0.42, rust=0.6)
bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=0.048, depth=WALL_Z[1] + 0.3, location=(0.86, -0.075, WALL_Z[1] / 2))
pipe = bpy.context.active_object; pipe.name = "pipe"; pipe.data.materials.append(MAT_PIPE)
bpy.ops.object.shade_smooth()
for zz in (0.35, 1.45, 2.55, 3.45):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.052, minor_radius=0.007, location=(0.86, -0.075, zz))
    t_ = bpy.context.active_object; t_.data.materials.append(MAT_PIPE); bpy.ops.object.shade_smooth()
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.86, -0.012, zz))
    b_ = bpy.context.active_object; b_.scale = (0.03, 0.03, 0.012); b_.data.materials.append(MAT_PIPE)
# pipe joint
for zz in (1.0, 2.1, 3.1):
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=0.053, depth=0.06, location=(0.86, -0.075, zz))
    c_ = bpy.context.active_object; c_.data.materials.append(MAT_PIPE); bpy.ops.object.shade_smooth()

# ── small transformer box hanging below the sign + cable conduit ──
MAT_BOX = mat_metal("box", "#2a2d30", 0.5, rust=0.3)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.42, -0.045, 0.62))
box = bpy.context.active_object; box.name = "transformer"; box.scale = (0.17, 0.08, 0.12)
bm_ = box.modifiers.new("bevel", "BEVEL"); bm_.width = 0.006; bm_.segments = 2
box.data.materials.append(MAT_BOX)
# small yellow warning label
bpy.ops.mesh.primitive_plane_add(size=1, location=(0.42, -0.0855, 0.635))
lab = bpy.context.active_object; lab.scale = (0.05, 0.03, 1); lab.rotation_euler = (rad(90), 0, 0)
lab.data.materials.append(mat_plain("label", "#b8932a", 0.6))
# conduit running from the box upwards then turning towards the drainpipe
MAT_COND = mat_metal("conduit", "#3b3f42", 0.45, rust=0.2)
cu = bpy.data.curves.new("conduit", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.011; cu.bevel_resolution = 4
sp = cu.splines.new("POLY")
pts = [(0.42, -0.02, 0.68), (0.42, -0.02, 0.95), (0.47, -0.02, 1.0), (0.79, -0.02, 1.0)]
sp.points.add(len(pts) - 1)
for p, c in zip(sp.points, pts):
    p.co = (*c, 1)
cond = obj("conduit", cu); cu.materials.append(MAT_COND)

# Object coords in materials must be world coordinates → apply transforms to the mesh
bpy.context.view_layer.update()
for ob in sc.objects:
    if ob.type == "MESH" and ob.name != "bricks":
        ob.data = ob.data.copy() if ob.data.users > 1 else ob.data
        mw = ob.matrix_world.copy()
        ob.data.transform(mw)
        ob.matrix_world.identity()

# ── camera ──
cam_d = bpy.data.cameras.new("cam")
cam_d.lens, cam_d.sensor_fit, cam_d.sensor_width = LENS, "HORIZONTAL", 36.0
cam = obj("cam", cam_d)
cam.location = (0, -CAM_D, CAM_H)
cam.rotation_euler = (rad(90), 0, 0)
sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = *SCREEN_PX, 100

# ── lighting: very dim cold street light top-left (raking light brings out the bricks) + a bit of night sky ──
def light(name, kind, energy, color, loc, rot=None, **kw):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color[:3]
    for k, v in kw.items():
        setattr(ld, k, v)
    ob = obj(name, ld); ob.location = loc
    if rot is not None:
        ob.rotation_euler = rot
    else:
        d = Vector((0.1, 0, 1.6)) - Vector(loc)
        ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


light("street", "SPOT", 900, hexc("#8fb6ff"), (-2.6, -1.6, 4.8), spot_size=rad(70), spot_blend=0.9, shadow_soft_size=0.25)
light("street_fill", "AREA", 30, hexc("#5f7fc4"), (0.0, -3.0, 1.5), size=3.0)
w = bpy.data.worlds.new("night"); sc.world = w; w.use_nodes = True
wb = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
wb.inputs["Color"].default_value = hexc("#0b1020"); wb.inputs["Strength"].default_value = 0.25

# ── Cycles ──
try:
    sc.render.engine = "CYCLES"
except TypeError as e:
    print("engine", e)
prefs = bpy.context.preferences.addons["cycles"].preferences
for t in ("METAL", "OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = t
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        break
    except TypeError:
        continue
sc.cycles.device = "GPU" if prefs.compute_device_type != "NONE" else "CPU"
sc.cycles.samples = 64
sc.cycles.use_denoising = True
sc.view_settings.view_transform = "Standard"
w.light_settings.distance = 0.06                  # short AO: mortar joints, brick bases

vl = sc.view_layers[0]
for name in ("rough", "refl"):
    a = vl.aovs.add(); a.name = name; a.type = "VALUE"
sc["neon"] = {"cam_d": CAM_D, "cam_h": CAM_H, "frame_w": FRAME_W, "view": list(VIEW_PT)}
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print("SAVED", BLEND, "frame", round(FRAME_W, 3), "×", round(FRAME_H, 3), "m")
