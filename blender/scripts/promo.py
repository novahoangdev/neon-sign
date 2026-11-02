# Demo clip for X (4:3, "phone mockup" style): a 3D titanium-frame iPhone playing the Neon Sign app screen recording.
# "Director" camera following the app's beats (copied and adapted from ../pumpkin-carve/blender/scripts/promo.py): flies in, pushes close on the finger
# while writing "hello" and drawing the heart, pans down to the switch → punch-zoom + shake on the flip, pulls back while the lights flicker, then punches again when
# the lights burst on, close-up on the colour change, the phone tilts in 3D in sync with the in-app tilt, end card with a real neon logo (glass tubes
# that glow, flicker, then light up fully).
# Neon glow spills out of the phone: halo behind the phone + point light in front of the screen + bloom, coloured by the currently lit neon
# (beat sheet "glow"). Background gradient changes colour per section. Background text DRAW → SWITCH → GLOW pops in letter by letter.
# The recording plays at exactly 1.0x, frame-synced to the first light flash at the switch flip; no cross-dissolve.
#
# All timings / camera moves live in the beat sheet JSON (blender/scripts/beats/v1.json…).
#
# Run: Blender -b --factory-startup -P blender/scripts/promo.py -- --beats blender/scripts/beats/v1.json \
#         --screen render/promo/screen.mp4 --film-start 2.36 --out render/promo/frames [--pct 100] [--stills 2,9,12]
#   --film-start: second in screen.mp4 matching app t=0 (from the light flash: burst − beats.burst)
import bpy, bmesh, json, math, os, random, sys
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
BEATS_PATH = os.path.abspath(arg("--beats", os.path.join(os.path.dirname(os.path.abspath(__file__)), "beats", "v2.json")))
BEATS = json.load(open(BEATS_PATH))
SCREEN = os.path.abspath(arg("--screen", "render/promo/screen.mp4"))
FILM0 = float(arg("--film-start", "2.36"))     # second in the recording at app t=0
OUT = os.path.abspath(arg("--out", "render/promo/frames"))
PCT = int(arg("--pct", "100"))
LABEL = arg("--label", "")                     # small bottom-left label (e.g. "v2"), to compare versions
FPS = 60
APP0 = float(arg("--app-start", BEATS["app_start"]))   # app second at the first clip frame (skips the black screen at app launch)
APP_END = float(arg("--app-end", BEATS["app_end"]))     # app second when the end card starts (so the bat-sound tail plays out)
CARD = float(arg("--card", BEATS.get("card", 3.6)))     # end card length
DUR = APP_END - APP0 + CARD
FR = lambda sec: round(sec * FPS)              # clip second → frame
A = lambda t: FR(t - APP0)                     # app second → clip frame
rad = math.radians
rng = random.Random(BEATS.get("seed", 31))

T_SWITCH, T_BURST, T_LIT = BEATS["switch"], BEATS["burst"], BEATS["lit"]   # switch flip, first flash (sync point), fully lit
C_CARD = APP_END - APP0                        # clip second where the end card starts
F_CARD = FR(C_CARD)
NF = FR(DUR)


def TT(v):
    """Beat sheet timing → clip frame: number = app second; "start"; "card" / "card+0.9"; "end"."""
    if isinstance(v, (int, float)):
        return A(v)
    if v == "start":
        return 0
    if v == "end":
        return NF
    if v.startswith("card"):
        return F_CARD + FR(float(v[4:] or 0))
    raise ValueError(f"unknown timing: {v}")


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1440, PCT
sc.render.fps = FPS
sc.frame_start, sc.frame_end = 0, FR(DUR) - 1
sc.view_settings.view_transform = "Standard"
sc.eevee.taa_render_samples = 16
sc.eevee.use_fast_gi = False
sc.render.film_transparent = False
sc.render.use_motion_blur = True               # EEVEE: velocity-vector motion blur, almost free
sc.render.motion_blur_shutter = 0.5
sc.eevee.motion_blur_steps = 1


def hexc(h):
    h = h.lstrip("#")
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def mat_emit(name, color, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    n = m.node_tree.nodes
    n.clear()
    e = n.new("ShaderNodeEmission"); e.inputs["Color"].default_value = hexc(color); e.inputs["Strength"].default_value = strength
    o = n.new("ShaderNodeOutputMaterial")
    m.node_tree.links.new(e.outputs[0], o.inputs[0])
    return m, e


def link(ob):
    sc.collection.objects.link(ob)
    return ob


def fcurves(idb):
    # Blender 5.x: layered/slotted Actions, no more action.fcurves → go through the slot's channelbag
    ad = idb.animation_data
    if ad is None or ad.action is None:
        return []
    if hasattr(ad.action, "fcurves"):
        return ad.action.fcurves
    from bpy_extras.anim_utils import action_get_channelbag_for_slot
    cb = action_get_channelbag_for_slot(ad.action, ad.action_slot)
    return cb.fcurves if cb else []


def key(idb, path, f, value):
    setattr(idb, path, value)
    idb.keyframe_insert(path, frame=f)


def key_sock(sock, f, value):
    sock.default_value = value
    sock.keyframe_insert("default_value", frame=f)


def sock_in(node, name, typ):
    return [s for s in node.inputs if s.name == name and s.type == typ][0]


def sock_out(node, typ):
    return [s for s in node.outputs if s.type == typ][0]


def flicker(idb, path, strength, scale=2.5, index=-1):
    # flicker: F-curve Noise (deterministic, independent of frame render order)
    for fc in fcurves(idb):
        if fc.data_path.endswith(path) and (index < 0 or fc.array_index == index):
            m = fc.modifiers.new("NOISE"); m.strength, m.scale, m.phase = strength, scale, rng.uniform(0, 50)


# ── background: emissive plane, 2-colour vertical gradient + halo behind the phone, colour changes per section ──
# palette: night #141a33, mist #3b4a6b, pumpkin #f07a1a / #b34a0c, fire #ffd27a → #ff9a2e
# (timing, top colour, bottom colour, halo colour, halo strength, transition frames from the timing) — see beat sheet "sections"
SECTIONS = [(TT(t), *rest) for t, *rest in BEATS["sections"]]
bg_me = bpy.data.meshes.new("bg")
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1)
bm.to_mesh(bg_me); bm.free()
bg = link(bpy.data.objects.new("bg", bg_me))
bg.scale = (20, 15, 1)
bg.rotation_euler = (rad(90), 0, 0)
bg.location = (0, 7, 0)
bgm = bpy.data.materials.new("bg"); bgm.use_nodes = True
N, Lk = bgm.node_tree.nodes, bgm.node_tree.links
N.clear()
tc = N.new("ShaderNodeTexCoord"); sep = N.new("ShaderNodeSeparateXYZ"); Lk.new(tc.outputs["Generated"], sep.inputs[0])
top = N.new("ShaderNodeRGB"); bot = N.new("ShaderNodeRGB"); halo = N.new("ShaderNodeRGB")
mix = N.new("ShaderNodeMix"); mix.data_type = "RGBA"
Lk.new(sep.outputs["Y"], mix.inputs["Factor"])
Lk.new(bot.outputs[0], sock_in(mix, "A", "RGBA")); Lk.new(top.outputs[0], sock_in(mix, "B", "RGBA"))
grad = N.new("ShaderNodeTexGradient"); grad.gradient_type = "SPHERICAL"   # round halo behind the phone
mp = N.new("ShaderNodeMapping"); mp.inputs["Location"].default_value = (0.5, 0.5, 0); mp.inputs["Scale"].default_value = (1.6, 2.1, 1)
sub = N.new("ShaderNodeVectorMath"); sub.operation = "SUBTRACT"; sub.inputs[1].default_value = (0.5, 0.5, 0)
Lk.new(tc.outputs["Generated"], sub.inputs[0]); Lk.new(sub.outputs[0], mp.inputs[0]); Lk.new(mp.outputs[0], grad.inputs[0])
glow = N.new("ShaderNodeMath"); glow.operation = "MULTIPLY"
Lk.new(grad.outputs["Fac"], glow.inputs[0])
add = N.new("ShaderNodeMix"); add.data_type = "RGBA"; add.blend_type = "ADD"
Lk.new(glow.outputs[0], add.inputs["Factor"])
Lk.new(sock_out(mix, "RGBA"), sock_in(add, "A", "RGBA")); Lk.new(halo.outputs[0], sock_in(add, "B", "RGBA"))
em = N.new("ShaderNodeEmission"); Lk.new(sock_out(add, "RGBA"), em.inputs["Color"])
out = N.new("ShaderNodeOutputMaterial"); Lk.new(em.outputs[0], out.inputs[0])
bg_me.materials.append(bgm)


def key_bg(f, sec, gs=None):
    _, ct, cb, ch, g, _ = sec
    for sock, v in ((top.outputs[0], hexc(ct)), (bot.outputs[0], hexc(cb)), (halo.outputs[0], hexc(ch)), (glow.inputs[1], g if gs is None else gs)):
        key_sock(sock, f, v)


for i, s in enumerate(SECTIONS):
    if i:
        key_bg(s[0] - 1, SECTIONS[i - 1])      # old colour held until the frame just before the timing (no colour change earlier than in the app)
    key_bg(s[0] + s[5], s)
# lights burst on: background halo flashes strongly then settles
fb = A(T_BURST)
fl_ = A(T_LIT)
key_sock(glow.inputs[1], fl_, 0.95); key_sock(glow.inputs[1], fl_ + 10, 0.7); key_sock(glow.inputs[1], fl_ + 50, 0.42)
GLOW = [(TT(t), c, e) for t, c, e in BEATS["glow"]]   # (frame, currently lit neon colour, level 0..1)


def key_glow(fn):
    """fn(frame, colour, level): keys at the glow timings (hold the old colour until just before the new timing, 8-frame transition)."""
    for i, (f, c, e) in enumerate(GLOW):
        if i:
            fn(f - 1, GLOW[i - 1][1], GLOW[i - 1][2])
        fn(f + (8 if i else 0), c, e)

# ── world: reflections on the titanium frame; darkens when the lights are off ──
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
wbg = w.node_tree.nodes["Background"]
wbg.inputs["Color"].default_value = hexc("#B9B4C4")
for f, s in ((0, 0.55), (fb - 1, 0.55), (fb + 30, 0.45)):
    key_sock(wbg.inputs["Strength"], f, s)


# ── iPhone (same as Goku) ──
def rounded_rect(bm, w, h, r, z, segs=14):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(segs + 1):
            a = rad(a0 + 90 * k / segs)
            pts.append(bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), z)))
    return bm.faces.new(pts)


PW, PH, PR, THICK = 1.0, 2.13, 0.16, 0.09
SW = PW - 0.06
# app screen frame from layout.json (iPhone 17 Pro Max: 440×956 pt, 1320×2868 px)
LAYOUT = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "app", "assets", "scene", "layout.json")))
VW, VH = LAYOUT["view"]
SH = SW * VH / VW
SCR_Y = -THICK / 2 - 0.006                     # screen surface (phone's local y axis, negative = towards the camera)
phone = link(bpy.data.objects.new("PHONE", None))
me = bpy.data.meshes.new("body"); bm = bmesh.new()
f0 = rounded_rect(bm, PW, PH, PR, -THICK / 2)
ext = bmesh.ops.extrude_face_region(bm, geom=[f0])
bmesh.ops.translate(bm, vec=(0, 0, THICK), verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me); bm.free()
body = link(bpy.data.objects.new("body", me))
bev = body.modifiers.new("bevel", "BEVEL"); bev.width, bev.segments, bev.limit_method = 0.025, 5, "ANGLE"
me.shade_smooth() if hasattr(me, "shade_smooth") else None
ti = bpy.data.materials.new("titanium"); ti.use_nodes = True
bsdf = next(n for n in ti.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = hexc("#8F8A83"); bsdf.inputs["Metallic"].default_value = 1.0; bsdf.inputs["Roughness"].default_value = 0.32
me.materials.append(ti)
body.parent = phone
body.rotation_euler = (rad(90), 0, 0)
for name, wdt, hgt, r, yoff, kind in (("glass", PW - 0.012, PH - 0.012, PR - 0.006, -THICK / 2 - 0.004, "black"),
                                      ("screen", SW, SH, PR - 0.035, SCR_Y, "screen")):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    rounded_rect(bm, wdt, hgt, r, 0)
    uv = bm.loops.layers.uv.new()
    for face in bm.faces:
        for l in face.loops:
            l[uv].uv = (l.vert.co.x / wdt + 0.5, l.vert.co.y / hgt + 0.5)
    bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.parent = phone
    ob.rotation_euler = (rad(90), 0, 0)
    ob.location = (0, yoff, 0)
    if kind == "black":
        me.materials.append(mat_emit("glass", "#050505")[0])
    else:
        sm = bpy.data.materials.new("screen"); sm.use_nodes = True
        n = sm.node_tree.nodes; n.clear()
        tex = n.new("ShaderNodeTexImage")
        img = bpy.data.images.load(SCREEN); img.source = "MOVIE"
        tex.image = img
        iu = tex.image_user
        iu.frame_duration = 100000
        # clip frame f shows frame (f − frame_start) of the recording → clip frame 0 = second FILM0 + APP0 of the recording
        iu.frame_start = -round((FILM0 + APP0) * FPS)
        iu.use_auto_refresh = True
        iu.use_cyclic = False
        e = n.new("ShaderNodeEmission"); e.inputs["Strength"].default_value = float(BEATS.get("screen_gain", 1.0))   # vignette compensation
        o = n.new("ShaderNodeOutputMaterial")
        sm.node_tree.links.new(tex.outputs["Color"], e.inputs["Color"]); sm.node_tree.links.new(e.outputs[0], o.inputs[0])
        me.materials.append(sm)
me = bpy.data.meshes.new("island"); bm = bmesh.new()
rounded_rect(bm, 0.3, 0.085, 0.0425, 0)
bm.to_mesh(me); bm.free()
isl = link(bpy.data.objects.new("island", me))
isl.parent = phone; isl.rotation_euler = (rad(90), 0, 0); isl.location = (0, -THICK / 2 - 0.008, SH / 2 - 0.075)
me.materials.append(mat_emit("island", "#000000")[0])
for i, (x, z, hh) in enumerate(((PW / 2 + 0.006, 0.45, 0.22), (-PW / 2 - 0.006, 0.55, 0.12), (-PW / 2 - 0.006, 0.3, 0.16), (-PW / 2 - 0.006, 0.08, 0.16))):
    me = bpy.data.meshes.new(f"btn{i}"); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1); bmesh.ops.scale(bm, vec=(0.02, 0.04, hh), verts=bm.verts)
    bm.to_mesh(me); bm.free()
    b = link(bpy.data.objects.new(f"btn{i}", me)); b.parent = phone; b.location = (x, 0, z); me.materials.append(ti)


def scr_local(x, y):
    """Point on the app screen (pt, VW×VH frame) → phone local coordinates."""
    return Vector(((x / VW - 0.5) * SW, SCR_Y, (0.5 - y / VH) * SH))


def scr_world(x, y, rot=(0, 0, 0), loc=(0, 0, 0)):
    return Euler(tuple(rad(a) for a in rot)).to_matrix() @ scr_local(x, y) + Vector(loc)


# ── lights ──
key_l = bpy.data.lights.new("key", "AREA"); key_l.size = 6
kl = link(bpy.data.objects.new("key", key_l)); kl.location = (-4, -5, 5); kl.rotation_euler = (rad(50), 0, rad(-40))
for f, en in ((0, 700), (fb - 1, 700), (fb + 20, 420)):
    key(key_l, "energy", f, en)
# back-right rim light + point light in front of the screen: current neon colour → the titanium frame picks up the colour, glow spills outside the phone
rim_d = bpy.data.lights.new("rim", "AREA"); rim_d.size = 4
rim = link(bpy.data.objects.new("rim", rim_d)); rim.location = (4.5, -1.5, 1.5); rim.rotation_euler = (rad(90), 0, rad(70))
glow_d = bpy.data.lights.new("screen_glow", "POINT"); glow_d.shadow_soft_size = 0.5
gl_ob = link(bpy.data.objects.new("screen_glow", glow_d)); gl_ob.parent = phone
gl_ob.location = scr_local(VW / 2, VH * 0.54) + Vector((0, -0.5, 0))


def _glow_lights(f, c, e):
    col = hexc(c)[:3]
    key(rim_d, "color", f, col); key(rim_d, "energy", f, 900 * e)
    key(glow_d, "color", f, col); key(glow_d, "energy", f, 180 * e)


key_glow(_glow_lights)
flicker(glow_d, "energy", 10, 2.0)

# soft halo behind the phone (emissive disc, round gradient) — "glow spilling out of the frame"
halo_me = bpy.data.meshes.new("halo"); bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1)
uvl = bm.loops.layers.uv.new()
for face in bm.faces:
    for l in face.loops:
        l[uvl].uv = (l.vert.co.x / 2 + 0.5, l.vert.co.y / 2 + 0.5)
bm.to_mesh(halo_me); bm.free()
halo = link(bpy.data.objects.new("halo", halo_me))
halo.rotation_euler = (rad(90), 0, 0); halo.location = (0, 0.9, 0); halo.scale = (2.6, 2.6, 1)
halo.parent = phone
hm = bpy.data.materials.new("halo"); hm.use_nodes = True
hn, hl_ = hm.node_tree.nodes, hm.node_tree.links
hn.clear()
huv = hn.new("ShaderNodeUVMap"); hsub = hn.new("ShaderNodeVectorMath"); hsub.operation = "SUBTRACT"; hsub.inputs[1].default_value = (0.5, 0.5, 0)
hl_.new(huv.outputs[0], hsub.inputs[0])
hlen = hn.new("ShaderNodeVectorMath"); hlen.operation = "LENGTH"; hl_.new(hsub.outputs[0], hlen.inputs[0])
hmr = hn.new("ShaderNodeMapRange"); hmr.inputs["From Min"].default_value = 0.5; hmr.inputs["From Max"].default_value = 0.0
hmr.interpolation_type = "SMOOTHSTEP"; hl_.new(hlen.outputs["Value"], hmr.inputs["Value"])
hpow = hn.new("ShaderNodeMath"); hpow.operation = "POWER"; hpow.inputs[1].default_value = 2.2; hl_.new(hmr.outputs[0], hpow.inputs[0])
hem = hn.new("ShaderNodeEmission"); hl_.new(hpow.outputs[0], hem.inputs["Strength"])
hstr = hn.new("ShaderNodeMath"); hstr.operation = "MULTIPLY"; hl_.new(hpow.outputs[0], hstr.inputs[0])
hl_.new(hstr.outputs[0], hem.inputs["Strength"])
htr = hn.new("ShaderNodeBsdfTransparent"); hadd = hn.new("ShaderNodeAddShader")
hl_.new(htr.outputs[0], hadd.inputs[0]); hl_.new(hem.outputs[0], hadd.inputs[1])
hout = hn.new("ShaderNodeOutputMaterial"); hl_.new(hadd.outputs[0], hout.inputs[0])
if hasattr(hm, "surface_render_method"):
    hm.surface_render_method = "BLENDED"
halo_me.materials.append(hm)


def _glow_halo(f, c, e):
    key_sock(hem.inputs["Color"], f, hexc(c)); key_sock(hstr.inputs[1], f, 0.75 * e)


key_glow(_glow_halo)

# ── text ──
def text(name, body, font, size, color, loc, strength=1.0, align="CENTER", extrude=0.0, parent=None):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.size, cu.align_x, cu.align_y, cu.extrude = body, size, align, "CENTER", extrude
    cu.font = bpy.data.fonts.load(font)
    ob = link(bpy.data.objects.new(name, cu))
    ob.rotation_euler = (rad(90), 0, 0)
    ob.location = loc
    ob.parent = parent
    cu.materials.append(mat_emit(name + "_m", color, strength)[0])
    return ob


IMPACT = "/System/Library/Fonts/Supplemental/Impact.ttf"
BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
ARIAL = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"   # has the "·" glyph
DIN = "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf"


def big_word(word, f0, f1, color, strength, size=2.5):
    """Big background text behind the phone: letters pop in staggered, the whole group slides + scales slightly through the section, hard cut at the end."""
    rig = link(bpy.data.objects.new("rig_" + word, None))
    letters = [text(f"big_{word}_{i}", ch, IMPACT, size, color, (0, 0, 0), strength, parent=rig) for i, ch in enumerate(word)]
    bpy.context.view_layer.update()
    gap = 0.06 * size
    widths = [ob.dimensions.x for ob in letters]
    x = -(sum(widths) + gap * (len(word) - 1)) / 2
    for i, (ob, wd) in enumerate(zip(letters, widths)):
        lx = x + wd / 2; x += wd + gap
        fi = f0 + 3 * i
        for f, vis in ((0, False), (fi, True), (f1, False)):
            key(ob, "hide_render", f, not vis)
        for f, s, dz in ((fi, 0.2, -0.9), (fi + 9, 1.12, 0.08), (fi + 18, 1.0, 0.0)):   # pop in with overshoot
            key(ob, "scale", f, (s, s, s)); key(ob, "location", f, (lx, 0, dz))
    for f, x_, s in ((f0, 0.9, 0.94), (f1, -0.9, 1.06)):
        key(rig, "location", f, (x_, 4.2, 0.15)); key(rig, "scale", f, (s, s, s))
    return rig


for w_, t0, t1, col, st, size in BEATS["words"]:
    big_word(w_, TT(t0), TT(t1), col, st, size)

# end card: the "Neon Sign" logo is a real neon sign — handwritten text (SignPainter) built into round glass tubes following the
# letter outlines, near-white core + pink, flickers a few beats then lights fully; subtitle lines pop in one by one, phone drifts right.
EX = -1.2
SCRIPT_FONT = "/System/Library/Fonts/Supplemental/SignPainter.ttc"


def neon_text(name, body, size, color, loc, f_on, seed):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.size, cu.align_x, cu.align_y = body, size, "CENTER", "CENTER"
    try:
        cu.font = bpy.data.fonts.load(SCRIPT_FONT)
    except RuntimeError:
        cu.font = bpy.data.fonts.load(BLACK)
    ob = link(bpy.data.objects.new(name, cu))
    ob.rotation_euler = (rad(90), 0, 0); ob.location = loc
    # text → outline curve → round tube (bevel), no fill
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target="CURVE")
    ob.data.fill_mode = "NONE" if ob.data.dimensions == "2D" else "FULL"
    ob.data.bevel_mode = "ROUND"
    ob.data.bevel_depth = size * 0.02
    ob.data.bevel_resolution = 3
    ob.data.extrude = 0.0
    m = bpy.data.materials.new(name + "_m"); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.35
    mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"
    nt.links.new(lw.outputs["Facing"], mx.inputs["Factor"])
    sock_in(mx, "A", "RGBA").default_value = hexc(color); sock_in(mx, "B", "RGBA").default_value = hexc("#fff4fa")
    em = nt.nodes.new("ShaderNodeEmission"); nt.links.new(sock_out(mx, "RGBA"), em.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(em.outputs[0], out.inputs[0])
    ob.data.materials.clear(); ob.data.materials.append(m)
    # real-neon flicker: off (dark glass) → 3–4 beats → fully on
    r = random.Random(seed)
    key(ob, "hide_render", 0, True); key(ob, "hide_render", f_on, False)
    # 3 flicker beats then fully on, synced to the crackle in mix_v3.py (card + 0.30 / 0.38 / 0.47 / 0.58 s; f_on = card + 0.30)
    key_sock(em.inputs["Strength"], f_on, 0.05)
    for dt_on, dt_off in ((0.0, 0.05), (0.08, 0.12), (0.17, 0.22)):
        key_sock(em.inputs["Strength"], f_on + FR(dt_on) + 1, r.uniform(5, 9))
        key_sock(em.inputs["Strength"], f_on + FR(dt_off) + 1, 0.15)
    f = f_on + FR(0.28) + 1
    key_sock(em.inputs["Strength"], f, 14); key_sock(em.inputs["Strength"], f + 14, 9.0)
    for fc in fcurves(m.node_tree):
        for k in fc.keyframe_points:
            k.interpolation = "CONSTANT"
    return ob


f_logo = F_CARD + FR(0.3)
EX = float(BEATS.get("card_x", EX))
neon_text("logo", "Neon Sign", 1.05, "#ff3fa4", (EX, 0, 0.78), f_logo, 3)
# compact end card (feedback from Hoa, 01/11): title, stack line, author, studio
end = [text("credit", "Expo · React Native · Skia · Reanimated · Blender", ARIAL, 0.152, "#d6f8ff", (EX, 0, -0.12), 0.95),
       text("by", "by Hoa Hoang · @novahoangdev", ARIAL, 0.19, "#3ff3ff", (EX, 0, -0.58), 1.05),
       text("love", "From @vgangstudio with love", ARIAL, 0.165, "#ffd6ec", (EX, 0, -1.0), 1.0)]
for i, ob in enumerate(end):
    f_in = F_CARD + FR(0.75) + 7 * i
    key(ob, "hide_render", 0, True); key(ob, "hide_render", f_in, False)
    z = ob.location.z
    for f, s_, dz in ((f_in, 0.3, -0.25), (f_in + 10, 1.1, 0.02), (f_in + 20, 1.0, 0.0)):
        key(ob, "scale", f, (s_, s_, s_)); key(ob, "location", f, (EX, 0, z + dz))
# pink halo behind the logo when it lights up
logo_l = bpy.data.lights.new("logo_glow", "POINT"); logo_l.color = hexc("#ff3fa4")[:3]; logo_l.shadow_soft_size = 1.0
lg = link(bpy.data.objects.new("logo_glow", logo_l)); lg.location = (EX, -0.6, 0.6)
for f, en in ((0, 0), (f_logo + 18, 0), (f_logo + 24, 260)):
    key(logo_l, "energy", f, en)


# ── fireflies / floating dust behind the phone (blurred by depth of field) ──
mote_m, mote_e = mat_emit("mote", "#9fb2e0", 2.0)


def _glow_motes(f, c, e):
    key_sock(mote_e.inputs["Color"], f, hexc(c if e > 0.05 else "#9fb2e0")); key_sock(mote_e.inputs["Strength"], f, 2.0 + 7.0 * e)


key_glow(_glow_motes)
mote_me = bpy.data.meshes.new("mote"); bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1)
bm.to_mesh(mote_me); bm.free(); mote_me.materials.append(mote_m)
RAIN_BG = BEATS.get("rain_bg", False)
for i in range(0 if RAIN_BG else 80):
    ob = link(bpy.data.objects.new(f"mote{i}", mote_me))
    r = rng.uniform(0.01, 0.028); ob.scale = (r, r, r)
    x, y, z0 = rng.uniform(-5, 5), rng.uniform(0.7, 5.5), rng.uniform(-7.5, 2.5)
    rise = rng.uniform(0.12, 0.32) * DUR
    key(ob, "location", 0, (x, y, z0)); key(ob, "location", NF, (x + rng.uniform(-0.6, 0.6), y, z0 + rise))
    for fc in fcurves(ob):
        for k in fc.keyframe_points:
            k.interpolation = "LINEAR"
        if fc.array_index in (0, 2):
            m = fc.modifiers.new("NOISE"); m.scale, m.strength, m.phase = rng.uniform(60, 140), rng.uniform(0.08, 0.25), rng.uniform(0, 100)

# background rain (beat sheet "rain_bg"): thin, slightly slanted streaks looping behind the phone, tinted by the current neon (material shared with mote)
if RAIN_BG:
    rain_m, rain_e = mat_emit("rainbg", "#9fb2e0", 0.6)

    def _glow_rain(f, c, e):
        key_sock(rain_e.inputs["Color"], f, hexc(c if e > 0.05 else "#9fb2e0")); key_sock(rain_e.inputs["Strength"], f, 0.5 + 1.3 * e)

    key_glow(_glow_rain)
    rain_me = bpy.data.meshes.new("rain"); bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1)
    bm.to_mesh(rain_me); bm.free(); rain_me.materials.append(rain_m)
    for i in range(int(BEATS.get("rain_n", 108))):         # 108: 40 % fewer than 180 (feedback 11:25: less cluttered)
        ob = link(bpy.data.objects.new(f"rain{i}", rain_me))
        y = rng.uniform(0.8, 6.0)                          # farther from the phone → smaller, blurrier (DOF)
        r = rng.uniform(0.0022, 0.0038) * (1 + y * 0.12)
        ob.scale = (r, r, r * rng.uniform(40, 70))
        ob.rotation_euler = (0, rad(-8), 0)
        x0 = rng.uniform(-6.5, 6.5)
        period = rng.randint(34, 52)                       # frames per fall cycle (~0.6–0.9 s)
        off = rng.randint(0, period)
        top, bot = 4.6 + y * 0.4, -4.6 - y * 0.4
        drift = (top - bot) * math.tan(rad(8))
        key(ob, "location", -off, (x0, y, top)); key(ob, "location", -off + period, (x0 + drift, y, bot))
        for fc in fcurves(ob):
            for k in fc.keyframe_points:
                k.interpolation = "LINEAR"
            fc.modifiers.new("CYCLES")

# ── camera rig: focus (look-at point, rotation = orbit) → shake → camera at (0, −d, 0) ──
focus = link(bpy.data.objects.new("focus", None))
shake = link(bpy.data.objects.new("shake", None)); shake.parent = focus
cam_d = bpy.data.cameras.new("cam"); cam_d.lens = 50; cam_d.sensor_fit = "VERTICAL"; cam_d.sensor_height = 24
cam_d.clip_start = 0.05
cam_d.dof.use_dof = True; cam_d.dof.focus_object = focus; cam_d.dof.aperture_fstop = 2.2
cam = link(bpy.data.objects.new("cam", cam_d)); sc.camera = cam
cam.parent = shake
cam.rotation_euler = (rad(90), 0, 0)
if LABEL:                                      # parented to the camera so it stays fixed in a screen corner
    lb = text("label", LABEL, DIN, 0.032, "#FFFFFF", (0, 0, 0), 0.75, align="LEFT")
    lb.parent = cam
    lb.location, lb.rotation_euler = (-0.6, -0.43, -2.0), (0, 0, 0)

def kphone(f, rot=(0, 0, 0), loc=(0, 0, 0)):
    key(phone, "rotation_euler", f, tuple(rad(a) for a in rot)); key(phone, "location", f, tuple(loc))


def phone_at(f):
    """Phone pose (degrees, position) at frame f — read from the keyed F-curves."""
    rot, loc = [0.0] * 3, [0.0] * 3
    for fc in fcurves(phone):
        if fc.data_path == "rotation_euler":
            rot[fc.array_index] = math.degrees(fc.evaluate(f))
        elif fc.data_path == "location":
            loc[fc.array_index] = fc.evaluate(f)
    return rot, loc


def kcam(f, at, d, orbit=(0, 0)):
    """at: [x, y] point on the app screen (pt) or {"world": [x,y,z]}; d: camera distance; orbit: [pitch, yaw] degrees."""
    p = Vector(at["world"]) if isinstance(at, dict) else scr_world(*at, *phone_at(f))
    key(focus, "location", f, p); key(focus, "rotation_euler", f, (rad(orbit[0]), 0, rad(orbit[1])))
    key(cam, "location", f, (0, -d, 0))


def punch(f, amt=1.07, back=30):
    """punch-zoom: fast zoom via focal length, then slow release (ease-out)."""
    key(cam_d, "lens", f - 1, 50); key(cam_d, "lens", f + 4, 50 * amt); key(cam_d, "lens", f + 4 + back, 50)


def kshake(f0, n, amp):
    for i in range(n):
        a = amp * (1 - i / n)
        key(shake, "rotation_euler", f0 + 2 * i, (rad(rng.uniform(-a, a)), rad(rng.uniform(-a, a) * 0.5), rad(rng.uniform(-a, a))))
    key(shake, "rotation_euler", f0 + 2 * n, (0, 0, 0))


def demo_tilt(t, t0=11.9):
    """Python version of demoTilt (app/src/demo/script.ts): (x, y) in −1..1."""
    idle = (math.sin(t * 0.9) * 0.16, math.sin(t * 0.6 + 1) * 0.08)
    u = t - t0
    if u < 0 or u > 2.6:
        return idle
    e = lambda x: 0.5 - 0.5 * math.cos(math.pi * min(max(x, 0), 1))
    x = -e(u / 0.8) if u < 0.8 else (-1 + 2 * e((u - 0.8) / 1.1) if u < 1.9 else 1 - e((u - 1.9) / 0.7))
    w = min(1, u / 0.3, (2.6 - u) / 0.3)
    return (idle[0] * (1 - w) + x * 0.95 * w, idle[1] * (1 - w) + math.sin(u * 2.2) * 0.3 * w)


def ease_all(idbs):
    # all camera/phone moves use auto Bezier (ease in/out, holding still between beats)
    for idb in idbs:
        for fc in fcurves(idb):
            for k in fc.keyframe_points:
                k.interpolation = "BEZIER"; k.handle_left_type = k.handle_right_type = "AUTO_CLAMPED"
            fc.update()


CENTER = [VW / 2, VH / 2]                      # screen centre (pt)
key(shake, "rotation_euler", 0, (0, 0, 0)); key(cam_d, "lens", 0, 50)
# phone: keyed from the beat sheet + tilt section synced to demoTilt
for k_ in BEATS["phone"]:
    kphone(TT(k_["t"]), k_.get("rot", (0, 0, 0)), k_.get("loc", (0, 0, 0)))
TL_ = BEATS.get("tilt")
if TL_:
    # in-app parallax: tilt.x > 0 → scene drifts left → the phone's left edge turns towards the camera (rz > 0);
    # tilt.y > 0 → scene drifts up → top edge towards the camera (rx > 0). The app smooths tilt → "lag" seconds of delay.
    t = TL_["from"]
    while t <= TL_["to"] + 1e-6:
        tx, ty = demo_tilt(t - TL_.get("lag", 0.1), TL_.get("t0", 11.9))
        w_ = min(1.0, (t - TL_["from"]) / TL_.get("ramp", 0.4))
        kphone(A(t), (TL_["rx"] * ty * w_, 0, TL_["rz"] * tx * w_))
        t = round(t + TL_.get("step", 0.15), 3)
ease_all([phone])
# camera: keyed from the beat sheet (look-at point computed from the phone pose at that exact frame)
for k_ in BEATS["camera"]:
    kcam(TT(k_["t"]), k_.get("at", CENTER), k_["d"], k_.get("orbit", (0, 0)))
if TL_:
    t = TL_["from"]
    while t <= TL_["to"] + 1e-6:
        tx, ty = demo_tilt(t - TL_.get("lag", 0.1), TL_.get("t0", 11.9))
        kcam(A(t), TL_.get("at", CENTER), TL_["d"] - TL_.get("d_tilt", 0) * abs(tx), (TL_.get("pitch", 0) * ty, TL_.get("yaw", 0) * tx))
        t = round(t + TL_.get("step", 0.15), 3)
for t_, amt, back in BEATS.get("punches", []):
    punch(TT(t_), amt, back)
for t_, n, amp in BEATS.get("shakes", []):
    kshake(TT(t_), n, amp)
# background blur: close-ups heavily blurred, wide shots/end card sharper so text is readable
for t_, fs in BEATS.get("fstops", []):
    key(cam_d.dof, "aperture_fstop", TT(t_), fs)

# ── compositor: bloom, chromatic aberration on bursts, vignette, light leak, flash ──
tree = bpy.data.node_groups.new("promo_comp", "CompositorNodeTree")
tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
sc.compositing_node_group = tree
T, TL = tree.nodes, tree.links
rl = T.new("CompositorNodeRLayers"); rl.scene = sc
gl = T.new("CompositorNodeGlare")
gl.inputs["Type"].default_value = "Bloom"
gl.inputs["Threshold"].default_value = 0.8
gl.inputs["Size"].default_value = 0.7
TL.new(rl.outputs["Image"], gl.inputs["Image"])
for f, s in ((0, 0.3), (fb - 1, 0.3), (fl_, 0.95), (fl_ + 30, 0.6)):
    key_sock(gl.inputs["Strength"], f, s)
ld = T.new("CompositorNodeLensdist")
TL.new(gl.outputs["Image"], ld.inputs["Image"])
for f, s in ((0, 0.0), (fl_ - 1, 0.0), (fl_ + 2, 0.05), (fl_ + 22, 0.004)):
    key_sock(ld.inputs["Dispersion"], f, s)
# vignette: ellipse (inner 1.0, outer 0.66) blurred then multiplied into the image
vg = T.new("CompositorNodeEllipseMask")
vg.inputs["Mask"].default_value = 0.66; vg.inputs["Value"].default_value = 0.34
vg.inputs["Size"].default_value = (1.05, 1.0)
try:
    vg.inputs["Operation"].default_value = "Add"
except TypeError as ex:
    print("ellipse op", ex)
vb = T.new("CompositorNodeBlur"); vb.inputs["Size"].default_value = (260 * PCT / 100, 260 * PCT / 100)
TL.new(vg.outputs[0], vb.inputs["Image"])
mul = T.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1.0
TL.new(ld.outputs["Image"], sock_in(mul, "A", "RGBA")); TL.new(vb.outputs["Image"], sock_in(mul, "B", "RGBA"))
# light leak: soft warm streak drifting slowly in the top corner
lk = T.new("CompositorNodeEllipseMask")
lk.inputs["Mask"].default_value = 0.0; lk.inputs["Value"].default_value = 1.0
lk.inputs["Size"].default_value = (0.55, 0.45); lk.inputs["Rotation"].default_value = rad(-30)
try:
    lk.inputs["Operation"].default_value = "Add"
except TypeError:
    pass
for f, p in ((0, (-0.05, 1.05)), (NF, (0.3, 1.08))):
    key_sock(lk.inputs["Position"], f, p)
lb_ = T.new("CompositorNodeBlur"); lb_.inputs["Size"].default_value = (300 * PCT / 100, 300 * PCT / 100)
TL.new(lk.outputs[0], lb_.inputs["Image"])
lc = T.new("ShaderNodeMix"); lc.data_type = "RGBA"; lc.blend_type = "MULTIPLY"; lc.inputs["Factor"].default_value = 1.0
sock_in(lc, "A", "RGBA").default_value = hexc("#ff5fb4")
TL.new(lb_.outputs["Image"], sock_in(lc, "B", "RGBA"))
scr = T.new("ShaderNodeMix"); scr.data_type = "RGBA"; scr.blend_type = "SCREEN"
TL.new(sock_out(mul, "RGBA"), sock_in(scr, "A", "RGBA")); TL.new(sock_out(lc, "RGBA"), sock_in(scr, "B", "RGBA"))
for f, s in ((0, 0.02), (fb - 1, 0.02), (fl_ + 4, 0.07), (fl_ + 60, 0.04)):
    key_sock(scr.inputs["Factor"], f, s)
# warm flash when the candle flares up
fl = T.new("ShaderNodeMix"); fl.data_type = "RGBA"; fl.blend_type = "ADD"
sock_in(fl, "B", "RGBA").default_value = hexc("#ff7fc4")
TL.new(sock_out(scr, "RGBA"), sock_in(fl, "A", "RGBA"))
for f, s in ((0, 0.0), (fl_ - 1, 0.0), (fl_ + 1, 0.22), (fl_ + 6, 0.08), (fl_ + 20, 0.0)):
    key_sock(fl.inputs["Factor"], f, s)
go = T.new("NodeGroupOutput")
TL.new(sock_out(fl, "RGBA"), go.inputs[0])

ease_all([focus, cam, shake, cam_d])
if BEATS.get("static"):
    # static phone: hold each key as is (no interpolation), so there's only one straight cut to the end card
    for idb in (phone, focus, cam, shake, cam_d):
        for fc in fcurves(idb):
            for k in fc.keyframe_points:
                k.interpolation = "CONSTANT"

os.makedirs(OUT, exist_ok=True)
sc.render.image_settings.file_format = "PNG"
print(f"PROMO beats {os.path.basename(BEATS_PATH)} | timings: dur {DUR:.2f}s ({sc.frame_end + 1} frames), app t0 {APP0}, "
      f"flash @ {fb / FPS:.2f}s, lit @ {fl_ / FPS:.2f}s, end card @ {C_CARD:.2f}s")
STILLS = arg("--stills", "")
if STILLS:                                     # quick look at a few moments (seconds in the promo clip)
    for sec in (float(x) for x in STILLS.split(",")):
        sc.frame_set(FR(sec))
        sc.render.filepath = os.path.join(OUT, f"still_{sec:06.3f}.png")
        bpy.ops.render.render(write_still=True)
    sys.exit(0)
RANGE = arg("--range", "")                     # "a,b": render only frames a..b (parallel rendering across processes)
if RANGE:
    sc.frame_start, sc.frame_end = (int(x) for x in RANGE.split(","))
if os.environ.get("PROMO_FAST") == "1":
    sc.eevee.taa_render_samples = 8
sc.render.filepath = os.path.join(OUT, "####")
print("PROMO frames", sc.frame_end + 1)
bpy.ops.render.render(animation=True)
print("PROMO DONE", OUT)
