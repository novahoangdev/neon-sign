import { Skia } from "react-native-skia";
import { AMB_GROUND, AMB_WALL, MOON } from "../shaders/wall";

/**
 * Intro point lights on the brick wall (plus blend, drawn right after the wall layer): arc / plasma bead / electrode flash and
 * a sweeping light ring. Uses the scene's own albedo + normal map + data → bricks get real relief, brick edges facing the light
 * catch it, damp spots (low data.r) glint like mirrors, mortar (low data.g) soaks up light. The wet ground reflects the lit part
 * of the wall (flipped around the wall base, squashed by reflK like the wall shader).
 *
 * Added correctly in gamma space: returns pow(base + light)^(1/2.2) − pow(base)^(1/2.2), where base = exactly the wall the
 * scene draws with the neon off (ambient × AMB_WALL/AMB_GROUND + MOON moonlight from shaders/wall.ts) → no washed-out look like adding
 * pow(light) directly, and the intro light adds on top of the true base level (intro → scene handoff without a brightness jump).
 * Pixels far from every light return 0 immediately (cheap).
 */
export const introLight = Skia.RuntimeEffect.Make(`
uniform shader ambient;
uniform shader albedo;
uniform shader normalMap;
uniform shader dataMap;
uniform float imgK;
uniform float horizon;
uniform float reflK;
uniform float3 lp[3];      // x, y (pt), light height above the wall (pt)
uniform float3 lc[3];      // colour × intensity (linear)
uniform float lr[3];       // influence radius (pt)
uniform float4 ring;       // centre x, y, radius, thickness
uniform float3 ringC;
uniform float expo;        // compensates the dark overlay drawn later (1 / (1 − opacity))
// wall base with the neon off — same constants as shaders/wall.ts (imported, numbers not copied)
const float AMB_WALL = ${AMB_WALL.toFixed(3)};
const float AMB_GROUND = ${AMB_GROUND.toFixed(3)};
const float MOON_TOP = ${MOON.top.toFixed(3)};
const float MOON_FOOT = ${MOON.foot.toFixed(3)};
const float MOON_GROUND = ${MOON.ground.toFixed(3)};
// moonlight colour + direction: wall.ts doesn't export these two values yet (they live in SkSL) → kept in sync by hand with moonAt() there
const float3 MOON_C = float3(0.80, 0.98, 1.30);
const float3 MOON_L = float3(-0.164, 0.82, 0.548);

float3 toLin(half3 c) { return pow(max(float3(c), float3(0.0)), float3(2.2)); }

bool lit(float2 p) {
  for (int i = 0; i < 3; i++) {
    if (lc[i].x + lc[i].y + lc[i].z > 0.0005) {
      float2 d = p - lp[i].xy;
      if (dot(d, d) < lr[i] * lr[i]) return true;
    }
  }
  if (ringC.x + ringC.y + ringC.z > 0.0005 && abs(length(p - ring.xy) - ring.z) < ring.w * 2.6) return true;
  return false;
}

// intro light at p for pre-read material (each point reads albedo / normal / data ONCE — see main)
float3 shade(float2 p, float3 alb, float3 n, half4 d) {
  float rough = float(d.r);
  float ao = mix(0.35, 1.0, float(d.g));
  float mortar = 1.0 - smoothstep(0.42, 0.82, float(d.g));
  float wet = clamp((1.0 - rough) * 1.25, 0.0, 1.0) * (1.0 - mortar * 0.85);
  float shin = mix(140.0, 10.0, rough);
  float3 base = alb * ao * mix(1.0, 0.25, mortar);
  float3 acc = float3(0.0);
  for (int i = 0; i < 3; i++) {
    if (lc[i].x + lc[i].y + lc[i].z <= 0.0005) continue;
    float2 dv = lp[i].xy - p;
    float r2 = dot(dv, dv);
    float R = lr[i];
    if (r2 >= R * R) continue;
    float h = lp[i].z;
    // light hugging the wall: rays almost grazing the surface → brick edges facing the source catch light, the other side is dark
    float3 L = normalize(float3(dv.x, -dv.y, h));
    // two tiers: close to the source (grazing rays, relief) + wide halo (light bouncing around the damp alley) → bricks near the source never go pitch black
    float W = R * 0.32;
    float att = (1.0 / (1.0 + r2 / (h * h * 6.8)) + 0.3 / (1.0 + r2 / (W * W))) * (1.0 - smoothstep(R * 0.45, R, sqrt(r2)));
    float nl = max(dot(n, L), 0.0);
    float3 H = normalize(L + float3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), shin) * wet * wet * 2.6;
    acc += lc[i] * att * (base * nl + spec);
  }
  if (ringC.x + ringC.y + ringC.z > 0.0005) {
    float2 dv = ring.xy - p;
    float rd = length(dv) + 0.001;
    float x = (rd - ring.z) / ring.w;
    float e = exp(-x * x);
    if (e > 0.002) {
      // light wavefront running out from the sign: brick faces turned towards the sign flare up as the wave passes
      float3 L = normalize(float3(dv.x / rd, -dv.y / rd, 0.45));
      float nl = max(dot(n, L), 0.0);
      float3 H = normalize(L + float3(0.0, 0.0, 1.0));
      float spec = pow(max(dot(n, H), 0.0), shin) * wet * wet * 2.0;
      acc += ringC * e * (base * nl + spec);
    }
  }
  return acc;
}

// moonlight irradiance by height (matches wall.ts's moonE)
float moonE(float2 p) {
  return p.y < horizon ? mix(MOON_TOP, MOON_FOOT, smoothstep(0.0, horizon, p.y)) : MOON_GROUND;
}

// scene wall colour at p with the neon off (linear): directional moonlight + remaining ambient — like wall.ts's surf()/main()
float3 baseAt(float2 p, float2 ip, float3 alb, float3 n, half4 d) {
  float wb = p.y < horizon ? smoothstep(horizon - 46.0, horizon - 1.0, p.y) : 0.0;
  alb *= 1.0 - 0.38 * wb;
  float rough = float(d.r) * (1.0 - 0.3 * wb);
  float ao = mix(0.35, 1.0, float(d.g));
  float mortar = 1.0 - smoothstep(0.42, 0.82, float(d.g));
  float nl = max(dot(n, MOON_L), 0.0) / MOON_L.z;
  float3 diff = alb * mix(1.0, nl, 0.85) * ao * mix(1.0, 0.3, mortar);
  float wet = clamp((1.0 - rough) * 1.25, 0.0, 1.0) * (1.0 - mortar * 0.85);
  float spec = pow(max(dot(n, normalize(MOON_L + float3(0.0, 0.0, 1.0))), 0.0), mix(28.0, 8.0, rough)) * wet * wet * 0.06;
  float3 moon = MOON_C * moonE(p) * (diff + spec);
  float3 amb = toLin(ambient.eval(ip).rgb) * mix(AMB_WALL, AMB_GROUND, smoothstep(horizon - 2.0, horizon + 6.0, p.y));
  return moon + amb * mix(0.72, 1.0, smoothstep(0.42, 0.82, float(d.g)));
}

// read material at ip (3 image samples)
void readMat(float2 ip, out float3 alb, out float3 n, out half4 d) {
  alb = toLin(albedo.eval(ip).rgb);
  n = normalize(float3(normalMap.eval(ip).rgb) * 2.0 - 1.0);
  d = dataMap.eval(ip);
}

half4 main(float2 p) {
  bool here = lit(p);
  float2 q = float2(p.x, horizon - (p.y - horizon) * reflK);
  bool mirror = p.y > horizon + 1.0 && lit(q);
  if (!here && !mirror) return half4(0.0);
  // when the camera is in macro close-up, the plasma bead's halo covers most of the screen → this pass runs full screen: read material at p
  // once, shared by the intro light and the wall base (before: 7 image samples / pixel, now 4)
  float2 ip = p * imgK;
  float3 alb;
  float3 n;
  half4 d;
  readMat(ip, alb, n, d);
  float3 add = float3(0.0);
  if (here) add += shade(p, alb, n, d) * (p.y > horizon ? 0.45 : 1.0);
  if (mirror) {
    float refl = float(d.b);
    if (refl > 0.04) {
      float3 albQ;
      float3 nQ;
      half4 dQ;
      readMat(q * imgK, albQ, nQ, dQ);
      add += shade(q, albQ, nQ, dQ) * refl * 0.85;
    }
  }
  if (add.x + add.y + add.z <= 0.0) return half4(0.0);
  float3 base = baseAt(p, ip, alb, n, d);
  float3 o = (pow(base + add, float3(1.0 / 2.2)) - pow(base, float3(1.0 / 2.2))) * expo;
  return half4(half3(o), 1.0);
}`)!;

/**
 * Electric arc between the two cable clamps (plus blend, drawn in a small Rect around the transformer box): main bolt is jagged
 * (linearly interpolated noise → sharp angles like a real electric bolt), two secondary branches occasionally reach down to the bricks, thin white core +
 * blue halo. The bolt shape changes whenever `seed` changes (~32 times/second scene time).
 */
export const introArc = Skia.RuntimeEffect.Make(`
uniform float2 a;
uniform float2 b;
uniform float seed;
uniform float inten;
uniform float amp;
uniform float3 col;

float hs(float x) { return fract(sin(x * 91.7 + seed * 47.3) * 43758.5453); }
float jag(float x) {
  float i = floor(x);
  return mix(hs(i), hs(i + 1.0), fract(x)) * 2.0 - 1.0;
}
float bolt(float u, float k) {
  return jag(u * 5.0 + k) * 0.6 + jag(u * 13.0 + k * 3.1) * 0.3 + jag(u * 31.0 + k * 7.7) * 0.15;
}
// distance to a jagged bolt starting at s0 along direction dir, length len
float ray(float2 p, float2 s0, float2 dir, float len, float am, float k) {
  float2 nr = float2(-dir.y, dir.x);
  float2 d = p - s0;
  float u = dot(d, dir) / len;
  float uc = clamp(u, 0.0, 1.0);
  float off = bolt(uc, k) * am * (0.3 + 0.7 * sin(3.14159 * uc));
  return abs(dot(d, nr) - off) + abs(u - uc) * len;
}

half4 main(float2 p) {
  if (inten <= 0.001) return half4(0.0);
  float2 ab = b - a;
  float L = length(ab);
  float2 dir = ab / L;
  float d0 = ray(p, a, dir, L, amp, 0.0);
  // branch 1: from the middle of the bolt reaching down to the bricks; branch 2: fanning out sideways from one end
  float2 o1 = mix(a, b, 0.25 + 0.5 * hs(3.3));
  float an1 = 1.5708 + (hs(5.1) - 0.5) * 2.2;
  float d1 = ray(p, o1, float2(cos(an1), sin(an1)), 9.0 + 24.0 * hs(7.9), amp * 0.9, 11.0) + (hs(1.7) < 0.35 ? 99.0 : 0.0);
  bool left = hs(8.2) < 0.5;
  float an2 = (left ? 3.14159 : 0.0) + (hs(9.4) - 0.5) * 1.6;
  float d2 = ray(p, left ? a : b, float2(cos(an2), sin(an2)), 7.0 + 18.0 * hs(12.1), amp * 0.7, 23.0) + (hs(2.9) < 0.5 ? 99.0 : 0.0);
  float core = max(exp(-d0 * d0 / 0.3), max(exp(-d1 * d1 / 0.18) * 0.8, exp(-d2 * d2 / 0.18) * 0.7));
  float dm = min(d0, min(d1, d2));
  float glow = exp(-dm / 2.6) * 0.5 + exp(-dm / 11.0) * 0.2;
  float3 c = (float3(core) + col * glow) * inten;
  return half4(half3(c), 1.0);
}`)!;

/**
 * Rain catching the arc / plasma bead / electrode flash light (plus blend, drawn right AFTER the scene's rain layer, same coordinate space): copies
 * exactly the three rain-streak tiers of scene/rain.ts (same hash, speed, density) → lit streaks line up exactly with the falling rain, only
 * lit additionally by the intro light sources. Pixels far from every source return 0 before computing rain streaks (cheap).
 */
export const introRain = Skia.RuntimeEffect.Make(`
uniform float time;
uniform float horizon;
uniform float viewH;
uniform float3 lp[3];
uniform float3 lc[3];
uniform float lr[3];
uniform float4 ring;
uniform float3 ringC;
uniform float4 cam;        // intro camera: zoom, look-at x, y (world pt), angle
uniform float2 ctr;        // frame centre
uniform float rk;          // how much of the scene rain is showing (0 in macro close-up → this layer also draws the cold rain streaks)

float h1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
float layer(float2 p, float cw, float len, float speed, float period, float w, float slant, float seed, float dens) {
  float2 q = float2(p.x + p.y * slant, p.y);
  float c = floor(q.x / cw);
  float r = h1(c + seed);
  if (r > dens) return 0.0;
  float r2 = h1(c * 1.7 + seed + 3.1);
  float fx = (fract(q.x / cw) - 0.2 - 0.6 * r2) * cw;
  float ax = abs(fx);
  if (ax > w + 0.6) return 0.0;
  float v = speed * (0.82 + 0.36 * r2);
  float d = fract((q.y - time * v) / period + r * 7.13) * period;
  d = period - d;
  if (d > len) return 0.0;
  float tail = 1.0 - d / len;
  float core = 1.0 - smoothstep(w * 0.35, w + 0.6, ax);
  return core * tail * tail;
}

half4 main(float2 p) {
  float3 L = float3(0.0);
  for (int i = 0; i < 3; i++) {
    if (lc[i].x + lc[i].y + lc[i].z <= 0.0005) continue;
    float2 d = p - lp[i].xy;
    float r2 = dot(d, d);
    float R = lr[i];
    if (r2 >= R * R) continue;
    // rain drops scatter evenly in all directions: depends on distance only, not on the normal
    L += lc[i] / (1.0 + r2 / (R * R * 0.06)) * (1.0 - smoothstep(R * 0.5, R, sqrt(r2)));
  }
  if (ringC.x + ringC.y + ringC.z > 0.0005) {
    float x = (length(p - ring.xy) - ring.z) / ring.w;
    L += ringC * exp(-x * x) * 0.6;
  }
  if (rk > 0.999 && L.x + L.y + L.z < 0.003) return half4(0.0);
  // rain streaks close to the lens: computed in SCREEN coordinates → constant size as the camera zooms (at zoom = 1 they line up exactly with the scene rain)
  float2 d = p - cam.yz;
  float cs = cos(cam.w), sn = sin(cam.w);
  float2 ps = ctr + cam.x * float2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
  float s = 0.0;
  s += layer(ps, 9.0, 16.0, 520.0, 520.0, 0.35, 0.10, 11.0, 0.55) * 0.45;
  s += layer(ps, 15.0, 30.0, 820.0, 760.0, 0.55, 0.12, 23.0, 0.45) * 0.75;
  s += layer(ps, 27.0, 54.0, 1250.0, 1100.0, 0.9, 0.14, 37.0, 0.32);
  s *= 1.0 - smoothstep(horizon + 40.0, viewH, p.y) * 0.8;
  if (s <= 0.001) return half4(0.0);
  // gamma-correct add relative to the scene rain already drawn (cold street light)
  float3 cold = float3(0.020, 0.026, 0.040);
  // scene rain hidden (rk < 1) → also draw the cold rain streaks; scene rain fully shown → only the added intro light
  float3 c = pow(s * (cold + L * 0.9), float3(1.0 / 2.2)) - pow(s * cold * rk, float3(1.0 / 2.2));
  return half4(half3(max(c, float3(0.0))), 1.0);
}`)!;

/**
 * Lens (image filter for BackdropFilter, coordinates = device px — the component wraps scale(1/PixelRatio)):
 *  - heat haze around the arc: rippling refraction rising within the `heat` circle (x, y, radius, strength);
 *  - "jolt" on box thump / electrode hit / overload (`amt`): horizontal bands randomly shifted sideways + R/B channel split radiating
 *    from the frame centre (chromatic aberration). Samples clamped to `box` (clip region) → no black pulled in from outside onto the edges.
 */
export const introLens = Skia.RuntimeEffect.Make(`
uniform shader image;
uniform float4 box;
uniform float amt;
uniform float seed;
uniform float px;
uniform float2 ctr;
uniform float4 heat;
uniform float time;
uniform float bands;     // 0..1: fraction of horizontal bands that jolt (0 = colour split only)

float hs(float x) { return fract(sin(x * 78.233 + seed * 12.9898) * 43758.5453); }

half4 main(float2 p) {
  float2 q = p;
  if (heat.w > 0.0) {
    float r = length(p - heat.xy) / heat.z;
    if (r < 1.0) {
      float f = (1.0 - r) * (1.0 - r) * heat.w;
      float2 u = p / px;
      // hot air rising: vertical ripples drifting upwards, more horizontal distortion than vertical
      q += float2(sin(u.y * 0.55 + time * 38.0 + sin(u.x * 0.3) * 2.0),
                  0.5 * cos(u.x * 0.45 + time * 31.0 + sin(u.y * 0.25) * 1.5)) * f * 1.7 * px;
    }
  }
  if (amt > 0.002) {
    float band = floor(p.y / (18.0 * px));
    if (hs(band) > 1.0 - 0.32 * amt * bands) q.x += (hs(band + 17.0) - 0.5) * 64.0 * px * amt;
  }
  float2 lo = box.xy + 0.5;
  float2 hi = box.zw - 0.5;
  q = clamp(q, lo, hi);
  half4 c = image.eval(q);
  if (amt > 0.002) {
    float2 off = (q - ctr) * 0.014 * amt + float2(4.0 * px * amt, 0.0);
    c.r = image.eval(clamp(q + off, lo, hi)).r;
    c.b = image.eval(clamp(q - off, lo, hi)).b;
  }
  return c;
}`)!;
