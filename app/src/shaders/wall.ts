import { Skia } from "react-native-skia";
import { PUDDLE } from "../scene/layout";
import { SLOTS } from "../neon/model";

/**
 * How much street light (the ambient image) remains (linear): neon must be the main light — power off means a truly dark alley
 * (bricks ~8–12 luma after vignette), not a self-lit wall. 0.1 linear ≈ −65 % display value. The ground keeps a bit
 * more so the puddle still reads in the dark. (The intro adds light on top of the ambient base → multiply by the same factor.)
 */
export const AMB_WALL = 0.1;
export const AMB_GROUND = 0.14;
/**
 * Moonlight / distant street light from above (06/11 round 6: the blacked-out alley at ~9.5 luma read as a frozen video). Cold,
 * directional light (from above, slightly left) → brick top edges catch light, mortar stays dark, wet streaks glint; strong at the
 * top of the wall, fading toward its foot (the alley shades it). Target: power-off frame ~18–22 luma — clearly dark but readable.
 * E = linear irradiance (multiplies albedo): wall top, wall foot, ground.
 */
export const MOON = { top: 0.17, foot: 0.1, ground: 0.065 }; // v84: −35 % — the outage "never went dark" (critics v80, v83)

/** Shared SkSL: read the light atlas per flicker slot (SLOTS / 3 tiles × RGB), multiply by each slot's brightness + linear colour. */
export const ATLAS_SKSL = `
// exact sRGB encode for atlas samples (a plain 1/2.2 power lifted the faint blur tails 2–3× → flat magenta wall, v89)
float3 srgbEnc(float3 l) {
  l = max(l, float3(0.0));
  return mix(l * 12.92, 1.055 * pow(l, float3(1.0 / 2.4)) - 0.055, step(float3(0.0031308), l));
}
uniform float bright[${SLOTS}];
uniform float3 col[${SLOTS}];
uniform float2 view;       // design frame (440×956 pt)
uniform float2 aTile;      // px per tile of atlas A
uniform float  aK;         // px atlas A / pt

float lum(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

/** Reads one atlas (SkSL can't take a child shader as a parameter → generate one function per atlas). */
export const atlasFn = (fn: string, child: string, tile: string, k: string, curve = false) => {
  // curve: weight each slot by b^1.5 instead of b. The puddle image of the tubes uses it: a tube at ~10 % during an
  // ignition blink is dead glass on the wall, but a linear 10 % image still read as "the reflection stays lit" (critic v80)
  const B = (i: string) => (curve ? `(bright[${i}] * sqrt(max(bright[${i}], 0.0)))` : `bright[${i}]`);
  return `
float3 ${fn}(float2 p) {
  float2 q = clamp(p * ${k}, float2(0.5), ${tile} - 0.5);
  float3 acc = float3(0.0);
  for (int t = 0; t < ${Math.ceil(SLOTS / 3)}; t++) {
    if (bright[t * 3] + bright[t * 3 + 1] + bright[t * 3 + 2] <= 0.0) continue;
    // the atlas packs 3 slots in R/G/B; Skia hands child samples over in the display's working space (P3 on iOS), where
    // sRGB-pure green leaks ~18 % (linear) into red → slot k+1's shape lit with slot k's brightness and colour (the
    // pink star piece in the puddle while the heart was lit, critics v80/v86). Back to sRGB channels, then re-encode
    // so the tuned look is unchanged.
    float3 s = srgbEnc(float3(toLinearSrgb(${child}.eval(q + float2(float(t) * ${tile}.x, 0.0)).rgb)));
    acc += s.r * ${B("t * 3")} * col[t * 3]
         + s.g * ${B("t * 3 + 1")} * col[t * 3 + 1]
         + s.b * ${B("t * 3 + 2")} * col[t * 3 + 2];
  }
  return acc;
}
`;
};

/**
 * Brick wall + ground + puddle, lit by the neon (PLAN section 4; POLISH 01/11).
 *  - Base: ambient.jpg (cold, dim street light). Neon adds: albedo · light · (N·L) · AO + specular.
 *  - Light at a point = atlas A (sum of 3 gaussians of the tube ≈ line source, falls off fast with distance) × brightness × colour
 *    per slot; light direction L follows its gradient (toward the tube). The tube sits ~2 cm off the wall so light arrives almost grazing
 *    the wall: brick edges facing the tube catch strong light, the far side stays dark.
 *  - Mortar (low AO in data.g): recessed, dark, absorbs light → receives little neon, darker base too.
 *  - Rain-wet: low-roughness spots (data.r, damp streaks running down) get mirror gloss under grazing light (small L.z) → glinting brick edges;
 *    plus a few rain rivulets running down the wall (visible only where neon hits).
 *  - Puddle (data.b): reflects the actual wall (dark base and lit bricks, with normals) and the sharp tubes (atlas B),
 *    distorted by small waves + raindrop rings (spreading circular ripples, squashed by perspective), Fresnel. No fake glow added.
 *    Tube reflections ONLY inside the puddle (mirror surface, mask data.b) + ~2 pt vertical blur; wet concrete around it no longer shows tubes
 *    (flipped letters on dry ground read like chalk / a glitch — feedback 01/11), it only receives direct neon light.
 */
export const wall = Skia.RuntimeEffect.Make(`
uniform shader ambient;
uniform shader albedo;
uniform shader normalMap;
uniform shader dataMap;
uniform shader lightA;
uniform shader lightB;
${ATLAS_SKSL}
uniform float  imgK;       // scene image px / pt
uniform float2 bTile;
uniform float  bK;
uniform float  horizon;
uniform float  reflK;
uniform float  time;
uniform float  gain;       // neon intensity on the wall
uniform float  relief;     // normal-map relief 0..1
uniform float2 tilt;
uniform float  bolt;       // 0..1 lightning flash (NeonScene boltAt)
uniform float  ambK;       // street-light level: the switch cuts the whole alley (v84: the outage "never went dark")
${atlasFn("lightAt", "lightA", "aTile", "aK")}
${atlasFn("tubesAt", "lightB", "bTile", "bK", true)}
const float AMB_WALL = ${AMB_WALL.toFixed(3)};
const float4 PUD = float4(${PUDDLE.map((v) => v.toFixed(1)).join(", ")});   // bounding box of the main puddle (pt)
const float AMB_GROUND = ${AMB_GROUND.toFixed(3)};
const float3 MOON_C = float3(0.80, 0.98, 1.30);   // cold bluish white, lum ≈ 1
const float MOON_TOP = ${MOON.top.toFixed(3)};
const float MOON_FOOT = ${MOON.foot.toFixed(3)};
const float MOON_GROUND = ${MOON.ground.toFixed(3)};

float3 toLin(half3 c) { return pow(max(float3(c), float3(0.0)), float3(2.2)); }

// rain rivulet running down the wall: 0..1 (glossy wet streak + drop head)
float rivulet(float2 p) {
  float cw = 11.0;
  float ci = floor(p.x / cw);
  float h = hash21(float2(ci, 7.3));
  if (h < 0.72) return 0.0;
  float cx = (ci + 0.5) * cw + (hash21(float2(ci, 1.9)) - 0.5) * 6.0;
  float dx = p.x - cx + sin(p.y * 0.05 + ci) * 1.2;      // the rivulet meanders slightly over the brick surface
  float wid = exp(-dx * dx / 0.35);
  if (wid < 0.01) return 0.0;
  float span = horizon + 120.0;
  float spd = 26.0 + h * 40.0;
  float head = fract(time * spd / span + hash21(float2(ci, 4.4))) * span - 60.0;
  float d = head - p.y;                                   // > 0: above the drop head
  float trail = d > 0.0 ? exp(-d / 22.0) * 0.35 : 0.0;
  float drop = exp(-d * d / 3.0);
  return wid * (trail + drop * 1.1);
}

// Diffuse colour of neon light on the surface (= effective albedo × light, before gloss / AO / gain).
// Brick (red, highly saturated) near a lit tube (~120 pt, by atlas brightness): albedo is almost fully greyed (keeps 20 % brick hue) with
// luminance between the physical reflectance under that light and the albedo luminance, light NOT desaturated → brick takes the light's hue: under
// cyan it turns teal, under pink clearly pink, under amber orange-yellow. (v68: mixing red albedo with equal-luma cyan then
// multiplying by desaturated light → dirty grey on the thumbnail.) Other surfaces (posters, paint, grey mortar): light desaturated 25 % as before.
// Only multiplies the neon light → no change during an outage (I = 0).
float3 spillDiff(float3 alb, float3 L0, float I) {
  float mx = max(alb.r, max(alb.g, alb.b));
  float sat = (mx - min(alb.r, min(alb.g, alb.b))) / (mx + 1e-4);
  float bk = smoothstep(0.5, 0.75, sat) * step(max(alb.g, alb.b), alb.r) * smoothstep(0.002, 0.02, I);
  float r = mix(lum(alb * L0) / max(I, 1e-4), lum(alb), 0.5);
  float3 albS = mix(alb, float3(r), 0.8 * bk);
  return albS * mix(L0, float3(I), 0.25 * (1.0 - bk));
}

// neon light added to the surface at p (linear)
float3 neonAt(float2 p, float3 alb, float3 n, float rough, float ao, float mortar) {
  float3 L0 = lightAt(p);
  float I = lum(L0);
  if (I < 0.0004) return float3(0.0);
  float wetX = p.y < horizon - 4.0 ? rivulet(p) : 0.0;     // only computed where neon shines
  // 2-texel atlas difference (8 pt): the atlas is 8-bit, in the faint tail the difference is only 0–1 quantisation steps → relative gradient
  // steps per texel; fade the gradient out in very faint areas (dir → 0: head-on light, no grazing edge)
  float e = 8.0;
  float Ix = lum(lightAt(p + float2(e, 0.0)));
  float Iy = lum(lightAt(p + float2(0.0, e)));
  float2 g = float2(Ix - I, Iy - I) / e;                 // image: y down
  float2 dir = g / (I + 0.01) * 26.0 * smoothstep(0.004, 0.03, I);  // relative gradient → tilt of the light ray
  float3 L = normalize(float3(dir.x, -dir.y, 0.5));
  float nl = max(dot(n, L), 0.0) / L.z;
  float shade = mix(1.0, nl, relief);
  // diffuse light desaturated 25 %: cyan on red brick becomes neutral grey, not mossy green
  float3 diff = spillDiff(alb, L0, I) * shade * ao * mix(1.0, 0.22, mortar);
  // wet gloss: grazing ray (small z), smooth where damp; porous mortar has no gloss
  float wet = clamp((1.0 - rough) * 1.25 + wetX, 0.0, 1.0) * (1.0 - mortar * 0.85);
  float3 Ls = normalize(float3(dir.x, -dir.y, 0.2));
  float3 H = normalize(Ls + float3(0.0, 0.0, 1.0));
  // wide gloss lobe (exponent ≤ 56) + ±1 8-bit-step normal jitter: exponent 140 on an 8-bit normal map drew stair-stepped glint patches on
  // the brick face (obvious on a dark wall, v60) — now a soft gloss streak mixed with grain
  float2 nj = float2(hash21(p * 2.3), hash21(p * 3.7 + 1.3)) - 0.5;
  float3 ns = normalize(n + float3(nj * 0.016, 0.0));
  float shin = mix(56.0, 10.0, rough);
  float spec = pow(max(dot(ns, H), 0.0), shin) * wet * wet * 1.2;
  float3 glossC = mix(L0, float3(lum(L0)), 0.15);
  // round 8: pink / red light (R channel dominant, B ≥ G) piles into one channel → R clips, the wall becomes a flat magenta patch
  // losing brick + mortar texture (cyan splits evenly over G/B so it holds up): cut 20 % + soft knee per channel above 0.5 to keep brick contrast
  float3 hs = L0 / (L0.r + L0.g + L0.b + 1e-4);
  diff *= 1.0 - 0.2 * smoothstep(0.5, 0.7, hs.r) * step(hs.g, hs.b);
  float3 dg = diff * gain;
  float3 ex = max(dg - 0.5, float3(0.0));
  dg = min(dg, float3(0.5)) + ex / (1.0 + ex * 1.2);
  return dg + glossC * (spec + wetX * 0.9) * gain;
}

// whitish-grey paint drips on the wall (crown graffiti, paint streaks): bright + low saturation + not warm → under cyan light reads
// as noise; compress ~50 %. Poster paper (warm cream) and brick (red) are unaffected.
float3 paint(float3 a) {
  float mx = max(a.r, max(a.g, a.b));
  float sat = (mx - min(a.r, min(a.g, a.b))) / (mx + 1e-4);
  // paint ≈ (0.20, 0.165, 0.145) linear: lum 0.17, saturation 0.27, b/r 0.73 · cream paper: saturation 0.54, b/r 0.46 · brick: saturation 0.9
  float k = smoothstep(0.07, 0.15, lum(a)) * (1.0 - smoothstep(0.3, 0.45, sat)) * smoothstep(0.55, 0.7, a.b / (a.r + 1e-4));
  return a * (1.0 - 0.5 * k);
}

// palm-tree poster under the star (baked into the scene image, ~81 × 105 pt): the amber star lighting the bright paper made the poster
// compete with the star (art director v61) → moved 0.26 m (61 pt) left in Blender (build_scene.py, half outside the
// frame) + dimmed another 40 % here. Box mask with 3 pt soft edge around the new centre (21.1, 602) pt; on albedo, exclude brick (red, saturation
// > 0.8) so the torn paper edge doesn't darken the bricks around it.
float posterBox(float2 p) {
  float2 d = abs(p - float2(21.1, 602.0)) - float2(40.5, 52.5);
  return 1.0 - smoothstep(-1.0, 3.0, max(d.x, d.y));
}
// red/blue circle poster, top left (centre (65, 147.4) pt, ~93 × 133 pt): the last saturated object that isn't neon,
// right where the eye enters the frame (art director v64) → 30 % brightness + 80 % desaturation (v72: 50 % / 60 % was still an opaque patch). Don't exclude brick by saturation (the poster's red
// ring is as saturated as brick); the box hugs the paper edge, 3 pt soft edge.
float posterABox(float2 p) {
  float2 d = abs(p - float2(65.0, 147.4)) - float2(45.5, 65.5);
  return 1.0 - smoothstep(-1.0, 3.0, max(d.x, d.y));
}
float3 posterA(float2 p, float3 a) {
  float m = posterABox(p);
  return m <= 0.0 ? a : mix(a, mix(a, float3(lum(a)), 0.8) * 0.3, m);
}
float3 posterDim(float2 p, float3 a) {
  a = posterA(p, a);
  float m = posterBox(p);
  if (m <= 0.0) return a;
  float mx = max(a.r, max(a.g, a.b));
  float sat = (mx - min(a.r, min(a.g, a.b))) / (mx + 1e-4);
  return a * (1.0 - 0.4 * m * (1.0 - smoothstep(0.78, 0.9, sat)));
}

// moonlight irradiance by height (linear)
float moonE(float2 p) {
  return p.y < horizon ? mix(MOON_TOP, MOON_FOOT, smoothstep(0.0, horizon, p.y)) : MOON_GROUND;
}

// moonlight at p: directional diffuse (normal map) + broad wet gloss (low exponent: no stair-stepping on the 8-bit normals)
float3 moonAt(float2 p, float3 alb, float3 n, float rough, float ao, float mortar) {
  const float3 Lm = float3(-0.164, 0.82, 0.548);          // normalize(-0.2, 1.0, 0.67): from above, slightly left
  float E = moonE(p);
  float nl = max(dot(n, Lm), 0.0) / Lm.z;                  // flat = 1, brick top edge > 1, bottom edge dark
  float3 diff = alb * mix(1.0, nl, 0.85) * ao * mix(1.0, 0.3, mortar);
  float wet = clamp((1.0 - rough) * 1.25, 0.0, 1.0) * (1.0 - mortar * 0.85);
  float spec = pow(max(dot(n, normalize(Lm + float3(0.0, 0.0, 1.0))), 0.0), mix(28.0, 8.0, rough)) * wet * wet * 0.06;
  return MOON_C * E * (diff + spec);
}

// Lightning (round 6): distant source in the upper-left sky, grazing the wall → brick edges facing the flash glint, flat faces
// get ~56 %, mortar dark; falls off with distance from the top-left corner (≈ 1/r²). Replaces NeonScene's flat additive albedo layer
// (read like a daytime wall, exposing the backdrop as a pasted-on texture).
const float BOLT_E = 2.6;   // v81: 3.5 lit the wall "flat like daylight" (critic v80) → dimmer, steeper falloff
//   // peak ≈ 40–45 mean frame luma (top left ~52, bottom right ~23; offline estimate)
const float3 BOLT_C = float3(0.86, 0.93, 1.15);          // cold bluish white (#d6e4ff), lum ≈ 1
float boltFall(float2 p) {
  float2 d = p - float2(-80.0, -120.0);
  return BOLT_E * bolt / (1.0 + dot(d, d) / (400.0 * 400.0));
}
float3 boltLight(float2 p, float3 alb, float3 n, float rough, float mortar) {
  const float3 Lb = float3(-0.55, 0.62, 0.56);           // from the top left, grazing
  float nl = max(dot(n, Lb), 0.0);
  float wet = clamp((1.0 - rough) * 1.25, 0.0, 1.0) * (1.0 - mortar * 0.85);
  float spec = pow(max(dot(n, normalize(Lb + float3(0.0, 0.0, 1.0))), 0.0), mix(28.0, 8.0, rough)) * wet * wet * 0.5;
  return BOLT_C * boltFall(p) * (alb * nl * mix(1.0, 0.25, mortar) + spec);
}

float3 surf(float2 p, out float refl, out float aoRaw, out float albL) {
  float2 ip = p * imgK;
  float3 alb = posterDim(p, paint(toLin(albedo.eval(ip).rgb)));
  float3 n = normalize(float3(normalMap.eval(ip).rgb) * 2.0 - 1.0);
  albL = lum(alb);
  // rain splashing back from the ground soaks the wall foot: bottom ~45 pt band drenched → darker, glossier
  float wb = p.y < horizon ? smoothstep(horizon - 46.0, horizon - 1.0, p.y) : 0.0;
  alb *= 1.0 - 0.38 * wb;  half4 d = dataMap.eval(ip);
  refl = float(d.b);
  aoRaw = float(d.g);
  float mortar = 1.0 - smoothstep(0.42, 0.82, float(d.g));
  float rough = float(d.r) * (1.0 - 0.3 * wb), ao = mix(0.35, 1.0, float(d.g));
  // during the outage the moon dims too (clouds with the storm): the blackout has to read as dark (critics v83–v86)
  float3 c = neonAt(p, alb, n, rough, ao, mortar) + moonAt(p, alb, n, rough, ao, mortar) * (0.35 + 0.65 * ambK);
  if (bolt > 0.0) c += boltLight(p, alb, n, rough, mortar);
  return c;
}

// water surface waves: xy = distortion (pt), z = ripple ring slope (catches light)
float3 ripple(float2 p) {
  float2 o = float2(sin(p.y * 0.42 + time * 2.3) * 0.5 + sin(p.x * 0.06 + p.y * 0.23 - time * 1.4) * 0.7,
                    sin(p.x * 0.11 + time * 1.7) * 0.35);
  float hl = 0.0;
  for (int i = 0; i < 6; i++) {
    float per = 0.9 + float(i) * 0.23;
    float ti = time + float(i) * 0.37;
    float w = floor(ti / per);
    float u = fract(ti / per);
    float2 c = float2(24.0 + hash21(float2(w, float(i))) * (view.x - 48.0),
                      horizon + 18.0 + hash21(float2(float(i), w + 3.1)) * (view.y - horizon - 40.0));
    float2 dv = (p - c) * float2(1.0, 3.2);              // circle tilted by perspective
    float r = length(dv);
    float R = 3.0 + u * 30.0;
    float x = r - R;
    if (abs(x) > 14.0) continue;
    float env = exp(-x * x / 30.0) * (1.0 - u) * (1.0 - u);
    float wv = sin(x * 1.1) * env;                       // spreading circular wave: a few concentric ripples
    o += dv / (r + 0.001) * wv * 5.5;
    hl += max(0.0, cos(x * 1.1)) * env;
  }
  return float3(o, hl);
}

// raindrops hitting wet ground: a glint dot + small ring spreading over ~0.15 s (cell grid squashed by perspective)
float splash(float2 p) {
  float2 cs = float2(16.0, 5.0);
  float2 ci = floor(p / cs);
  float h = hash21(ci + 17.0);
  float per = 0.8 + h * 1.4;
  float u = fract((time + h * 7.0) / per) * per;          // seconds since the drop landed
  if (u > 0.16) return 0.0;
  float2 c = (ci + float2(0.2 + 0.6 * hash21(ci + 3.1), 0.3 + 0.4 * hash21(ci + 5.7))) * cs;
  float2 d = (p - c) * float2(1.0, 3.0);
  float r = length(d);
  float k = 1.0 - u / 0.16;
  float dot0 = exp(-r * r / 1.2) * k * k;                  // glint dot on impact
  float ring = exp(-pow((r - u * 30.0) / 0.9, 2.0)) * k;   // spreading ring
  return dot0 * 1.4 + ring * 0.6;
}

// Extra puddle lobe toward the bottom left (0..1). The star (centre y 556) sits higher than the heart so its reflection lands lower
// (y 828–864 pt), but the Blender mask's bottom edge at x 82–162 only reaches y ≈ 836–857 → star tip lost, the two legs read as an "M"
// (art director v66). Add an elliptical lobe with a slightly rippled edge, bottom ≈ 873 pt (still inside the PUD box → PUD clamp unchanged).
// No Blender re-render needed.
float puddleExt(float2 p) {
  float2 d = (p - float2(120.0, 848.0)) / float2(74.0, 25.0);
  if (abs(d.x) > 1.3 || abs(d.y) > 1.3) return 0.0;
  float e = length(d) + 0.06 * sin(p.x * 0.11 + 1.3) + 0.04 * sin(p.x * 0.23 + p.y * 0.3);
  return 1.0 - smoothstep(0.8, 1.0, e);
}

half4 main(float2 p) {
  float2 ip = p * imgK;
  // street light is only a very faint fill (wall near black during an outage), the ground keeps a bit more
  float3 amb = toLin(ambient.eval(ip).rgb) * mix(AMB_WALL, AMB_GROUND, smoothstep(horizon - 2.0, horizon + 6.0, p.y)) * (1.0 - 0.4 * posterBox(p)) * ambK;
  amb = posterA(p, amb);
  float refl, ao;
  float albL;
  float3 c = surf(p, refl, ao, albL);
  c += amb * mix(0.72, 1.0, smoothstep(0.42, 0.82, ao));  // mortar darker even under street light
  float pe = puddleExt(p);
  if (pe > 0.0) {
    // water-dark base (near-black puddle albedo) only in the added lobe — the original puddle is already dark in the image
    c *= 1.0 - 0.45 * pe * (1.0 - smoothstep(0.3, 0.85, refl));
    // reflectance as in the Blender puddle (0.22 + 0.78·mask)
    refl = max(refl, 0.22 + 0.78 * pe);
  }
  // wall–ground corner: wet dark wall foot (street light) + thin contact shadow on the ground right at the wall foot
  float dyB = p.y - horizon;
  c *= dyB < 0.0 ? 1.0 - 0.28 * smoothstep(-46.0, -1.0, dyB) : 1.0 - 0.5 * exp(-dyB / 4.0);

  if (p.y > horizon - 2.0 && refl > 0.02) {
    float depth = clamp((p.y - horizon) / (view.y - horizon), 0.0, 1.0);
    // water smoothness: puddle (high refl) is almost a mirror; wet concrete around it is only slightly darker + grainy, no tube image
    float glassy = smoothstep(0.3, 0.85, refl);
    // the Blender mask still has a wet strip at the frame bottom (y ≈ 900+) → a flipped "hello" showed on dry asphalt like graffiti
    // (art director v52/v59): mirror only inside the main puddle box, 6 pt soft edge
    glassy *= (1.0 - smoothstep(PUD.w - 8.0, PUD.w + 4.0, p.y)) * smoothstep(PUD.x - 4.0, PUD.x + 8.0, p.x) * (1.0 - smoothstep(PUD.z - 8.0, PUD.z + 4.0, p.x));
    float3 rw = ripple(p);
    // ripples only on the water (puddle); rough concrete doesn't ripple → no frayed distortion
    float2 rp = rw.xy * (0.5 + depth) * mix(0.12, 1.0, glassy);
    float2 q = float2(p.x, horizon - (p.y - horizon) * reflK) + rp * float2(1.0, reflK);
    q.y = max(q.y, 2.0);
    // wet asphalt: the thin water film is mirror-flat only on stone grains (bright albedo), pits between grains are dark, scattering
    // → the reflection breaks up along the gravel instead of a smooth colour band on top. Mean ≈ 1 (mean linear albedo luminance
    // of the ground 0.027) so total reflected light is unchanged. (No normal map: its ±0.06 micro x/z drifted when
    // Skia converted the image's colour gamut → broken.)
    float brk = mix(1.0, min(0.45 + albL * 28.0, 2.8), 1.0 - glassy);  // mean ≈ 1.2: sparse highlights look darker through gamma
    // tube image only inside the puddle (glassy from mask data.b, already soft-edged): ~2 pt (≈ 6 px) vertical blur with 3 per-pixel
    // jittered samples (small noise blends into film grain, no ghosting like a few fixed taps). Outside the puddle: atlas B not read.
    float3 tb = float3(0.0);
    if (glassy > 0.01) {
      // final round: tube image in the puddle as bright / sharp as the real tube → fake. Double vertical blur (~4–8 pt) + rain ripples bend the image
      // harder (×1.8 distortion, tube image only)
      float s = 6.0 + depth * 4.0;
      float2 qt = q + rw.xy * float2(1.0, reflK) * (0.5 + depth) * 0.8 * glassy;
      float j = hash21(p * 1.7 + fract(time * 3.0)) - 0.5;
      tb = (tubesAt(qt + float2(0.0, (j - 1.0) * s * 0.5)) + tubesAt(qt + float2(0.0, j * s * 0.5))
          + tubesAt(qt + float2(0.0, (j + 1.0) * s * 0.5))) / 3.0 * glassy;
    }
    // under the lightning the phosphor afterglow (still ~8 % at the strike) is swamped by the flash on the tubes but
    // stood out in the dark pool → "the tubes are still lit" (critic v78): the flash washes it out here too
    float3 tubes = mix(tb, float3(lum(tb)), 0.2) * 1.4 * brk * (1.0 - 0.85 * clamp(bolt, 0.0, 1.0));    // −30 % (2.0 → 1.4): reflection darker than the real tube
    // neon light at the reflected point: read atlas A ONCE, shared by the wall image, puddle rim and splashes
    // (the reflected wall is already blurred/distorted → skip light-direction gradient + wet gloss, diffuse only: saves 2 atlas reads)
    float3 Lq = glassy > 0.05 ? lightAt(q) : float3(0.0);
    float3 wallR = float3(0.0);
    if (glassy > 0.05) {
      float2 iq = q * imgK;
      half4 dq = dataMap.eval(iq);
      float mq = 1.0 - smoothstep(0.42, 0.82, float(dq.g));
      float3 albQ = posterDim(q, paint(toLin(albedo.eval(iq).rgb)));
      float3 neonR = spillDiff(albQ, Lq, lum(Lq)) * mix(0.35, 1.0, float(dq.g)) * mix(1.0, 0.22, mq) * gain;
      // + wall under moonlight (flat diffuse) → the puddle reads even during an outage
      wallR = neonR * 0.45 + posterA(q, toLin(ambient.eval(iq).rgb)) * (0.35 * AMB_WALL * ambK)
            + albQ * (MOON_C * moonE(q) * (0.35 + 0.65 * ambK) + BOLT_C * boltFall(q) * 0.56) * mix(0.35, 1.0, float(dq.g)) * mix(1.0, 0.3, mq) * 0.45;
    }
    float F = refl * mix(0.9, 0.4, depth);
    // critic v77: the puddle read as a sharp window onto a second brick wall → the mirrored wall is dimmer (×0.6) and
    // flattened toward its own mean, so the pool reads as dark water that carries the neon, not a cut-out
    wallR = mix(wallR, float3(lum(wallR)) * float3(0.8, 0.9, 1.15), 0.25) * 0.6;
    c = c * (1.0 - F * 0.55 * glassy) + (wallR * glassy + tubes) * F;
    // ripple rings catch cold moonlight + nearby neon colour (round 6: bright enough to read falling rain during an outage)
    c += rw.z * glassy * F * (float3(0.024, 0.03, 0.042) + tb * 0.3);
    // puddle rim (water meniscus): thin bright edge in the reflectance transition band, catching cold light + reflected neon colour
    float edge = smoothstep(0.42, 0.62, refl) * (1.0 - smoothstep(0.66, 0.86, refl));
    // (no constant cold rim any more: it outlined the whole pool like a sticker before anything reflected in it)
    c += edge * (tb * 0.25 + Lq * 0.04);
    // raindrop splashes: glint with street light + neon light (inside the puddle: the reflection; outside: neon shining
    // straight down on the ground at p — not the flipped point q, otherwise the flipped letters reappear as dots on dry ground)
    float sp = splash(p);
    if (sp > 0.001) {
      float3 Ls = glassy > 0.05 ? Lq : lightAt(p);
      c += sp * (float3(0.018, 0.022, 0.032) + tb * 0.5 + Ls * 0.25) * (0.4 + refl);
    }
  }
  // dither against banding in dark areas
  c = pow(max(c, float3(0.0)), float3(1.0 / 2.2)) + (hash21(p * 3.0 + fract(time)) - 0.5) / 255.0;
  return half4(half3(c), 1.0);
}`)!;
