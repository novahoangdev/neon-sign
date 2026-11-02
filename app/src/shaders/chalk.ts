import { Skia } from "react-native-skia";

/**
 * Chalk grain for the glowing trail while writing: colour `col` (premultiplied) times two-layer noise in pt coordinates (grain ~0.45 pt
 * + soft patches ~2.2 pt), fixed to the wall (doesn't jump per frame) → the trail looks like porous glowing chalk, not a vector stroke.
 */
export const chalk = Skia.RuntimeEffect.Make(`
uniform float4 col;
float h(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
// smoothly interpolated value noise: soft porous patches, no visible squares (plain floor at 2.5 pt = 7.5 px cells on a 3× screen — v47)
float vn(float2 p) {
  float2 i = floor(p), f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + float2(1, 0)), u.x), mix(h(i + float2(0, 1)), h(i + float2(1, 1)), u.x), u.y);
}
half4 main(float2 p) {
  float g = h(floor(p * 2.2));            // fine grain ~0.45 pt (≈ 1.4 px)
  float m = vn(p * 0.45 + 7.0);
  float a = col.a * (0.42 + 0.38 * g + 0.2 * m);
  return half4(half3(col.rgb * a), a);
}`)!;
