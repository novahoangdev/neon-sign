# Neon sign prop sprites, rendered with Cycles (transparent background, shadows cast on the wall via shadow catcher):
#   app/assets/sprites/parts.png   grid of 32×32 pt cells (4 px/pt):
#       row 0: tube clip, back part (round base + standoff + shadow) — 12 angles 0..165° (15° steps), drawn BEFORE the glass body
#       row 1: clip, front part (wire strap looping over the tube)       — 12 angles, drawn AFTER the glow layer
#       row 2: cell 0 = electrode (black rubber boot + metal ring, tube plugged into the wall), cell 1 = cable entry into the transformer box
#   app/assets/sprites/switch.png  toggle switch: cell 0 = brushed stainless plate + nut + indicator light, cells 1..9 = lever
#       (with its shadow on the plate) from flipped down (off) to flipped up (on) — 64×92 pt cells
#   app/assets/sprites/sprites.json  cell size, px/pt, angles, centres
# Reference tube: 7 pt diameter (the app scales by tube thickness). Lighting: cold street light top-left like the scene
# (shadow offset down-right like TubeShadow in the app). Coordinates: 1 Blender unit = 1 pt; the wall is the plane y = 0,
# objects stick out towards y < 0, orthographic camera looking along +y. Angle φ is measured in screen space (y down, clockwise).
#
# Run: Blender -b --factory-startup -P blender/scripts/sprites.py -- [--samples 96] [--only parts|switch]
import bpy, json, math, os, sys, tempfile
import numpy as np
import OpenImageIO as oiio
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "app", "assets", "sprites")
os.makedirs(OUT, exist_ok=True)
TMP = tempfile.mkdtemp(prefix="neon_sprites_")
SAMPLES = int(arg("--samples", "96"))
ONLY = arg("--only", "all")
PX = 4                      # px / pt
CELL = 32                   # pt
ANGLES = list(range(0, 180, 15))
TUBE_W = 7.0                # reference tube diameter (pt)
R = TUBE_W / 2
STAND = 6.5                 # tube centre distance from the wall (pt)
SW_CELL = (64, 92)          # switch cell (pt)
rad = math.radians

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def hexc(h, a=1.0):
    h = h.lstrip("#")
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (a,)


def mat(name, color, rough, metallic=0.0, aniso=0.0, brushed=0.0, coat=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = hexc(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    if aniso:
        b.inputs["Anisotropic"].default_value = aniso
    if coat:
        b.inputs["Coat Weight"].default_value = coat
    if emit:
        b.inputs["Emission Color"].default_value = hexc(emit[0])
        b.inputs["Emission Strength"].default_value = emit[1]
    if brushed:
        # horizontal brush scratches: noise stretched along x → bump
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (0.04, 6.0, 6.0)
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 3.0
        nz.inputs["Detail"].default_value = 12.0
        bp = nt.nodes.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value = brushed
        bp.inputs["Distance"].default_value = 0.05
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
        nt.links.new(nz.outputs["Fac"], bp.inputs["Height"])
        nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
        # slight roughness variation
        nr = nt.nodes.new("ShaderNodeMapRange")
        nr.inputs["To Min"].default_value = rough * 0.75
        nr.inputs["To Max"].default_value = rough * 1.3
        nt.links.new(nz.outputs["Fac"], nr.inputs["Value"])
        nt.links.new(nr.outputs["Result"], b.inputs["Roughness"])
    return m


def link(ob):
    sc.collection.objects.link(ob)
    return ob


def active(name, m=None, smooth=True):
    ob = bpy.context.active_object
    ob.name = name
    if m:
        ob.data.materials.append(m)
    if smooth and ob.type == "MESH":
        bpy.ops.object.shade_smooth()
    return ob


def cyl(name, r, y0, y1, m, x=0.0, z=0.0, verts=48):
    """Cylinder along the y axis (perpendicular to the wall), from y0 to y1 (negative = sticking out)."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=abs(y1 - y0), location=(x, (y0 + y1) / 2, z),
                                        rotation=(rad(90), 0, 0))
    ob = active(name, m)
    bv = ob.modifiers.new("bevel", "BEVEL"); bv.width = min(0.5, r * 0.2, abs(y1 - y0) * 0.3); bv.segments = 3
    bv.limit_method = "ANGLE"
    return ob


# ── materials ──
M_BASE = mat("standoff_base", "#3c3e43", 0.42, metallic=0.7)
M_POST = mat("standoff_post", "#1d1e22", 0.35, coat=0.6)
M_WIRE = mat("tie_wire", "#b8bcc4", 0.28, metallic=1.0)
M_BOOT = mat("boot_rubber", "#101114", 0.55, coat=0.25)
M_RING = mat("boot_ring", "#c9ccd2", 0.22, metallic=1.0)
M_GLAND = mat("gland", "#26282c", 0.4, coat=0.4)
M_PLATE = mat("plate_steel", "#b4b7bd", 0.26, metallic=1.0, aniso=0.6, brushed=0.06)
M_SCREW = mat("screw", "#8d9097", 0.3, metallic=1.0)
M_NUT = mat("nut_chrome", "#d8dbe0", 0.12, metallic=1.0)
M_BAT = mat("bat_chrome", "#e3e5ea", 0.1, metallic=1.0)
M_LENS = mat("pilot_lens", "#3a0f08", 0.15, coat=1.0)
M_HOLE = mat("hole", "#050506", 0.8)

# ── lighting: cold street light top-left (sun, shadow offset down-right) + night sky + two softboxes so the metal has something to reflect ──
def sun(name, energy, color, d, angle):
    ld = bpy.data.lights.new(name, "SUN"); ld.energy = energy; ld.color = hexc(color)[:3]; ld.angle = rad(angle)
    ob = link(bpy.data.objects.new(name, ld))
    ob.rotation_euler = Vector(d).normalized().to_track_quat("-Z", "Y").to_euler()
    return ob


sun("street", 3.2, "#9cbcff", (0.37, 1.0, -0.57), 6)
sun("rim", 0.6, "#ffffff", (-0.5, 1.0, 0.4), 20)


def softbox(name, loc, size, strength, color="#dfe8ff"):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    ob = active(name, mat(name, "#000000", 1.0, emit=(color, strength)), smooth=False)
    ob.scale = (size[0], size[1], 1)
    ob.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("Z", "Y").to_euler()
    ob.visible_camera = False
    ob.visible_shadow = False
    return ob


softbox("box_top", (-30, -60, 70), (60, 30), 1.2)
softbox("box_low", (40, -50, -40), (50, 20), 0.35, "#8ea6d6")
w = bpy.data.worlds.new("night"); sc.world = w; w.use_nodes = True
wb = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
wb.inputs["Color"].default_value = hexc("#1a2238"); wb.inputs["Strength"].default_value = 0.35

# wall = shadow catcher (only the shadow remains in alpha)
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0.0, 0), rotation=(rad(90), 0, 0))
wall = active("wall", mat("wall", "#6a4a40", 0.8), smooth=False)
wall.is_shadow_catcher = True

# ── orthographic camera ──
cam_d = bpy.data.cameras.new("cam"); cam_d.type = "ORTHO"
cam = link(bpy.data.objects.new("cam", cam_d))
cam.rotation_euler = (rad(90), 0, 0)
sc.camera = cam

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
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.render.image_settings.color_depth = "16"


def shoot(name, w_pt, h_pt, cx=0.0, cz=0.0):
    sc.render.resolution_x, sc.render.resolution_y = int(w_pt * PX), int(h_pt * PX)
    sc.render.resolution_percentage = 100
    cam_d.ortho_scale = max(w_pt, h_pt)
    cam.location = (cx, -200, cz)
    p = os.path.join(TMP, name + ".png")
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    return p


def read(p):
    inp = oiio.ImageInput.open(p)
    px = np.asarray(inp.read_image(0, 0, 0, 4, "float"), np.float32)
    inp.close()
    return px


def write(arr, path):
    h, wd, c = arr.shape
    spec = oiio.ImageSpec(wd, h, c, "uint8")
    o = oiio.ImageOutput.create(path)
    o.open(path, spec)
    o.write_image(np.ascontiguousarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8)))
    o.close()
    print("SAVE", os.path.relpath(path, ROOT), wd, h)


M0 = {}


def group(objs, phi):
    """Rotate the whole group around the y axis (wall normal): tube direction φ (screen, y down) → Blender (cos φ, 0, −sin φ)."""
    for ob in objs:
        ob.matrix_world = Matrix.Rotation(phi, 4, "Y") @ M0[ob.name]


def keep(objs):
    bpy.context.view_layer.update()
    for ob in objs:
        M0[ob.name] = ob.matrix_world.copy()


# ═════════════════════ tube clips + electrodes ═════════════════════
def build_parts():
    # clip: screwed round base, standoff, saddle under the tube; steel wire strap looping over the front of the tube
    base = cyl("clip_base", 4.4, 0, -1.1, M_BASE)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.55, depth=0.3, location=(0, -1.2, 0), rotation=(rad(90), 0, 0))
    screw = active("clip_screw", M_SCREW)
    post = cyl("clip_post", 1.45, -1.0, -(STAND - R * 0.55), M_POST)
    # strap: round steel wire hugging the front of the tube, both ends twisted onto the standoff
    bpy.ops.mesh.primitive_torus_add(major_radius=R + 0.28, minor_radius=0.36, major_segments=64, minor_segments=12,
                                     location=(0, -STAND, 0), rotation=(0, rad(90), 0))
    band = active("clip_band", M_WIRE)
    twist = []
    for s in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.42, depth=2.2, location=(0, -STAND + R * 0.55, s * (R + 0.1)),
                                            rotation=(rad(90), 0, 0))
        twist.append(active(f"clip_twist{s}", M_WIRE))
    # reference tube: only gives the strap something to rest on / reflect, not rendered, casts no shadow (the app draws the tube shadow itself)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=R, depth=60, location=(0, -STAND, 0), rotation=(0, rad(90), 0))
    tube = active("tube_ref", mat("tube_ref", "#9a98a8", 0.05), smooth=True)
    tube.visible_camera = False
    tube.visible_shadow = False
    back = [base, screw, post]
    front = [band] + twist
    allo = back + front + [tube]
    keep(allo)

    cells = {}
    for i, a in enumerate(ANGLES):
        group(allo, rad(a))
        for ob in front:
            ob.visible_camera = False
        for ob in back:
            ob.visible_camera = True
        cells[("back", i)] = shoot(f"clip_back_{a:03d}", CELL, CELL)
        for ob in front:
            ob.visible_camera = True
        for ob in back:
            ob.visible_camera = False
        wall.visible_camera = False
        cells[("front", i)] = shoot(f"clip_front_{a:03d}", CELL, CELL)
        wall.visible_camera = True
    for ob in allo:
        bpy.data.objects.remove(ob, do_unlink=True)

    # electrode: black rubber boot (GTO boot) sticking out from the wall, metal ring, glass tube plugged into the front
    boot = cyl("boot", 5.0, -0.2, -STAND - 1.2, M_BOOT)
    bv = boot.modifiers["bevel"]; bv.width = 1.6; bv.segments = 5
    ring = cyl("boot_ring", 5.25, -0.4, -1.8, M_RING)
    flange = cyl("boot_flange", 6.1, 0, -0.6, M_BASE)
    bpy.ops.mesh.primitive_torus_add(major_radius=R * 0.62, minor_radius=0.45, major_segments=40, minor_segments=10,
                                     location=(0, -STAND - 1.25, 0), rotation=(rad(90), 0, 0))
    lip = active("boot_lip", M_BOOT)
    cells[("elec", 0)] = shoot("electrode", CELL, CELL)
    for ob in (boot, ring, flange, lip):
        bpy.data.objects.remove(ob, do_unlink=True)

    # cable entry into the transformer box: small cable gland
    g1 = cyl("gland_nut", 3.2, 0, -2.6, M_GLAND, verts=6)
    g1.modifiers["bevel"].width = 0.4
    g2 = cyl("gland_cap", 2.4, -2.4, -4.6, M_GLAND)
    cells[("gland", 0)] = shoot("gland", CELL, CELL)
    for ob in (g1, g2):
        bpy.data.objects.remove(ob, do_unlink=True)

    n = len(ANGLES)
    c = CELL * PX
    sheet = np.zeros((3 * c, n * c, 4), np.float32)
    for (kind, i), p in cells.items():
        row = {"back": 0, "front": 1, "elec": 2, "gland": 2}[kind]
        col = 1 if kind == "gland" else i
        sheet[row * c:(row + 1) * c, col * c:(col + 1) * c] = read(p)
    write(sheet, os.path.join(OUT, "parts.png"))


# ═════════════════════ toggle switch ═════════════════════
def build_switch():
    W_, H_ = 56.0, 82.0
    # plate: rounded rectangle r=8, thickness 2, soft chamfered edge
    import bmesh
    bm = bmesh.new()
    ring = []
    rr, seg = 8.0, 10
    for cx, cz, a0 in ((W_ / 2 - rr, H_ / 2 - rr, 0), (-W_ / 2 + rr, H_ / 2 - rr, 90), (-W_ / 2 + rr, -H_ / 2 + rr, 180),
                       (W_ / 2 - rr, -H_ / 2 + rr, 270)):
        for k in range(seg + 1):
            t = rad(a0 + 90 * k / seg)
            ring.append(bm.verts.new((cx + rr * math.cos(t), 0.0, cz + rr * math.sin(t))))
    face = bm.faces.new(ring)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, -2.0, 0), verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("plate"); bm.to_mesh(me); bm.free()
    plate = link(bpy.data.objects.new("plate", me)); plate.data.materials.append(M_PLATE)
    bv = plate.modifiers.new("bevel", "BEVEL"); bv.width = 0.9; bv.segments = 4; bv.limit_method = "ANGLE"
    bv.angle_limit = rad(50)
    for zz in (H_ / 2 - 7.5, -H_ / 2 + 7.5):
        s = cyl("screw", 2.4, -1.8, -2.9, M_SCREW)
        s.location.z = zz
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -3.0, zz))
        slot = active("slot", M_HOLE, smooth=False); slot.scale = (3.6, 0.6, 0.55)
        slot.rotation_euler = (0, rad(35 if zz > 0 else -20), 0)
    nut = cyl("nut", 7.2, -1.8, -4.4, M_NUT, verts=6)
    nut.modifiers["bevel"].width = 0.6
    bush = cyl("bushing", 5.0, -4.2, -7.0, M_NUT)
    hole = cyl("bush_hole", 2.6, -6.9, -7.1, M_HOLE)
    # small indicator light below the lever
    lens_ring = cyl("pilot_ring", 3.3, -1.8, -3.0, M_NUT)
    lens_ring.location.z = -H_ / 2 + 19
    bpy.ops.mesh.primitive_uv_sphere_add(radius=2.5, location=(0, -2.9, -H_ / 2 + 19))
    lens = active("pilot_lens", M_LENS)
    lens.scale.y = 0.55
    static = [plate, nut, bush, hole, lens_ring, lens] + [o for o in sc.objects if o.name.startswith(("screw", "slot"))]
    for ob in static:
        ob.visible_camera = True
    p_plate = shoot("switch_plate", *SW_CELL)

    # lever: tapered chrome shaft + ball tip, +z axis with its root at the nut centre; rotates around the x axis
    pivot = Vector((0, -6.5, 0))
    LEN = 27.0
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=2.8, radius2=1.7, depth=LEN, location=(0, 0, LEN / 2))
    bat = active("bat", M_BAT)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=3.2, segments=48, ring_count=24, location=(0, 0, LEN + 0.8))
    ball = active("ball", M_BAT)
    lever = [bat, ball]
    for ob in lever:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    frames = []
    for ob in static:                  # the plate keeps only the lever's shadow (alpha) → the cell holds just the lever + its shadow
        if ob is plate:
            ob.is_shadow_catcher = True
        else:
            ob.visible_camera = False
            ob.visible_shadow = False
    wall.visible_camera = False
    for i in range(9):
        v = i / 8
        a = rad(-40 + 80 * v)          # 0 = flipped down, 1 = flipped up; a = angle from the plate normal
        # +z axis → (0, −cos a, sin a): rotate around x by π/2 − a
        m = Matrix.Translation(pivot) @ Matrix.Rotation(math.pi / 2 - a, 4, "X")
        for ob in lever:
            ob.matrix_world = m
        frames.append(shoot(f"switch_lever_{i}", *SW_CELL))
    c = (SW_CELL[1] * PX, SW_CELL[0] * PX)
    sheet = np.zeros((c[0], 10 * c[1], 4), np.float32)
    for j, p in enumerate([p_plate] + frames):
        sheet[:, j * c[1]:(j + 1) * c[1]] = read(p)
    write(sheet, os.path.join(OUT, "switch.png"))


if ONLY in ("all", "parts"):
    build_parts()
if ONLY in ("all", "switch"):
    build_switch()

meta = {
    "pxPerPt": PX,
    "parts": {"cell": CELL, "angles": ANGLES, "tubeW": TUBE_W, "rows": {"clipBack": 0, "clipFront": 1, "misc": 2},
              "misc": {"electrode": 0, "gland": 1}},
    "switch": {"cell": list(SW_CELL), "plate": 0, "lever": list(range(1, 10))},
}
with open(os.path.join(OUT, "sprites.json"), "w") as f:
    json.dump(meta, f, indent=1)
print("DONE", OUT)
