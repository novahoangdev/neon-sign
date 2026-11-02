import { Skia } from "react-native-skia";
import { ATLAS_SKSL, atlasFn } from "./wall";

/**
 * Additive layer (blend plus) over the whole scene: slow-drifting mist near the ground tinted by the neon (fbm),
 * airborne glow around the tubes (wide bloom) and a soft flash when the lights come on.
 */
export const steam = Skia.RuntimeEffect.Make(`
uniform shader lightA;
${ATLAS_SKSL}
${atlasFn("lightAt", "lightA", "aTile", "aK")}
uniform float horizon;
uniform float time;
uniform float haze;        // airborne glow
uniform float density;     // mist density

float n2(float2 p) {
  float2 i = floor(p), f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + float2(1, 0)), u.x), mix(hash21(i + float2(0, 1)), hash21(i + float2(1, 1)), u.x), u.y);
}
float fbm3(float2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * n2(p); p = p * 2.03 + float2(17.1, 3.7); a *= 0.5; }
  return s + 0.0625;
}
// black floor: adding (blend plus) onto a gamma-encoded image, even a few thousandths linear lifts black by ~10 luma
// (milky fog over the whole alley). Push the faintest part to 0, keep bright glow / mist nearly intact: y² / (y + k)
float3 toe(float3 y) { return y * y / (y + 0.05); }
float fbm(float2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + float2(17.1, 3.7); a *= 0.5; }
  return s;
}

half4 main(float2 p) {
  float3 L = lightAt(p);
  // mist rising off the wet ground: thick at the wall foot, thinning out up to ~200 pt; outside that band only airborne glow remains
  float band = smoothstep(horizon - 60.0, horizon - 10.0, p.y) * (1.0 - smoothstep(horizon + 10.0, view.y - 40.0, p.y) * 0.75);
  // airborne glow: added onto a gamma-encoded image so it's only right on a dark background — right on the tube (very strong near light)
  // it must drop to 0, otherwise pow(L·haze, 1/2.2) washes out the neon tube itself (the "o" next to the red heart, 01/11)
  float onTube = 1.0 - smoothstep(0.12, 0.5, lum(L));
  float3 hz = toe(pow(max(L * haze, float3(0.0)), float3(1.0 / 2.2))) * 0.9 * onTube;
  if (band * density < 0.002) return half4(half3(hz), 1.0);
  // two layers (near: large, fast — fbm 5; far: small, slow — fbm 3) sharing one domain warp → depth, cheap;
  // take a narrow band of the noise → thin curling wisps, not uniform smoke patches; stretched vertically since mist rises
  float2 sp = p * float2(0.008, 0.012);
  float t = time;
  float2 w = float2(fbm3(sp + float2(0.0, t * 0.05)), fbm3(sp + float2(5.2, 1.3) - float2(t * 0.03, 0.0)));
  float fn = fbm(sp + w * 2.1 + float2(-t * 0.045, t * 0.08));
  float ff = fbm3(sp * 2.1 + w * 1.4 + float2(9.3 - t * 0.03, t * 0.05));
  // keep only thin wisps (narrow noise band): v61 mist covered too much → gaps between patches read as black smoke under the heart
  float near = smoothstep(0.6, 0.74, fn) * (1.0 - smoothstep(0.74, 0.86, fn));
  float far = smoothstep(0.52, 0.66, ff) * (1.0 - smoothstep(0.66, 0.78, ff));
  float d = (near * 0.75 + far * 0.4) * band * density;
  // scattering: mist is invisible in the dark, shows only where neon shines — no more cold street light (v60: grey patches
  // under the heart / star read as smudges). Neon colour gets extra saturation (pink + amber + cyan add up to grey) and is capped
  // at ≤ 0.08 (display value): thin neon-coloured wisps (nearest tube — atlas A) drifting slowly upward, never a patch
  float3 Lc = max(L + (L - float3(lum(L))) * 0.6, float3(0.0));
  float3 c = d * Lc * 2.2;
  c = min(toe(pow(c, float3(1.0 / 2.2))) * 0.9 * mix(1.0, onTube, 0.7), float3(0.03)) + hz;
  return half4(half3(c), 1.0);
}`)!;

/**
 * Multiply layer (blend multiply): vignette + film grain. Elliptical vignette (corners ≈ −40 %) + dark band at the top (top 30 % is
 * empty brick, pulls the eye to the sign): −28 % at the top edge, fading out by 30 % of the height.
 */
export const grade = Skia.RuntimeEffect.Make(`
uniform float2 view;
uniform float time;
float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
half4 main(float2 p) {
  float2 u = (p / view - 0.5) * float2(1.0, 0.7);
  float v = 1.0 - smoothstep(0.22, 0.64, length(u)) * 0.42;
  v *= mix(0.72, 1.0, smoothstep(0.0, 0.3, p.y / view.y));
  float g = 1.0 + (hash21(floor(p * 1.5) + floor(time * 24.0) * 1.37) - 0.5) * 0.09;
  return half4(half3(v * g), 1.0);
}`)!;
