import { Skia } from "react-native-skia";
import { ATLAS_SKSL, atlasFn } from "../shaders/wall";

/**
 * Light rain falling in front of the wall (additive, blend plus): 3 streak layers far → near (thin, slow, faint → thick, fast, crisp), slightly
 * slanted by wind. Streaks are only "visible" where light hits them: a very faint cold street light + neon light at that exact spot
 * (atlas A, same light source as the wall) → around the sign the rain glows pink / cyan, far from it nearly invisible, like real night rain.
 * Cheap: most pixels aren't on any streak and return 0 before reading the atlas. No per-frame allocation
 * (the uniforms are a shared object NeonScene mutates in place).
 * Lightning (`flash` 0..1): every streak catches the cold white flash for 2–3 frames → rain "frozen" mid-air.
 */
export const rain = Skia.RuntimeEffect.Make(`
uniform shader lightA;
${ATLAS_SKSL}
${atlasFn("lightAt", "lightA", "aTile", "aK")}
uniform float time;
uniform float horizon;
uniform float amount;      // 0..1 density
uniform float flash;       // 0..1 lightning flash

float h1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }

// one layer: returns streak brightness at p (0 if none)
float layer(float2 p, float cw, float len, float speed, float period, float w, float slant, float seed, float dens) {
  float2 q = float2(p.x + p.y * slant, p.y);
  float c = floor(q.x / cw);
  float r = h1(c + seed);
  if (r > dens) return 0.0;
  float r2 = h1(c * 1.7 + seed + 3.1);
  float fx = (fract(q.x / cw) - 0.2 - 0.6 * r2) * cw;          // horizontal distance to the streak centre (pt)
  float ax = abs(fx);
  if (ax > w + 0.6) return 0.0;
  float v = speed * (0.82 + 0.36 * r2);
  float d = fract((q.y - time * v) / period + r * 7.13) * period;   // distance from the drop head, measured upward
  d = period - d;
  if (d > len) return 0.0;
  float tail = 1.0 - d / len;                                    // bright head, fading tail
  float core = 1.0 - smoothstep(w * 0.35, w + 0.6, ax);
  return core * tail * tail;
}

half4 main(float2 p) {
  float s = 0.0;
  // round 8: clip shrunk inside a phone frame (~600 px wide ≈ 1.4 px/pt) → 0.35 pt streaks vanish; thicker + brighter streaks
  s += layer(p, 9.0, 16.0, 520.0, 520.0, 0.6, 0.10, 11.0, 0.55 * amount) * 0.6;     // xa
  s += layer(p, 15.0, 30.0, 820.0, 760.0, 0.85, 0.12, 23.0, 0.45 * amount) * 0.9;   // middle
  s += layer(p, 27.0, 54.0, 1250.0, 1100.0, 1.25, 0.14, 37.0, 0.32 * amount) * 1.15; // near
  // drops very close to the lens: sparse, large, fast, soft edges (out-of-focus blur)
  s += layer(p, 64.0, 96.0, 1900.0, 1800.0, 2.0, 0.16, 53.0, 0.16 * amount) * 0.8;
  // rain fades out as it reaches the ground (the puddle handles the ripple rings)
  s *= 1.0 - smoothstep(horizon + 40.0, view.y, p.y) * 0.8;
  if (s <= 0.001) return half4(0.0);
  float3 L = lightAt(p);
  // cold moonlight (round 6): streaks clearly visible even during an outage — dark alley but "alive"; near the sign they take the neon colour;
  // lightning lights up the whole screen white
  float3 cold = float3(0.030, 0.038, 0.055);
  float3 c = s * (cold + L * 0.9 + flash * float3(0.30, 0.34, 0.42));
  c = pow(max(c, float3(0.0)), float3(1.0 / 2.2));
  return half4(half3(c), 1.0);
}`)!;
