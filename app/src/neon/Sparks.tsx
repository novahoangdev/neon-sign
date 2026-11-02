import React, { useMemo } from "react";
import { Atlas, BlendMode, Group, Skia, TileMode, useColorBuffer, useRSXformBuffer, type SkImage } from "react-native-skia";
import type { SharedValue } from "react-native-reanimated";

/**
 * Electric sparks (particles): a sparkler at the pen tip while drawing, a burst from the transformer box at power on, from an electrode
 * when a broken tube re-strikes. A fixed pool of N particles (flat number array in a shared value, mutated in place each frame — no
 * allocation), drawn in one Atlas call: each particle is a light streak rotated to its heading, stretched by speed, colour scaled by age, additive.
 * Coordinates: design-frame pt; time: scene-clock seconds (already multiplied by TIMESCALE).
 */
export const SPARK_N = 320;
/** slots per particle: x, y, vx, vy, age, life, r, g, b, size */
const F = 10;
const G = 520; // gravity pt/s²
const DRAG = 1.6; // air drag 1/s

export type SparkState = { p: number[]; next: number; tick: number };
export const makeSparks = (): SparkState => ({ p: new Array(SPARK_N * F).fill(0), next: 0, tick: 0 });

/** Emit n particles from (x, y): direction `dir` (rad, screen y down), fanning `spread` rad, speed v0..v1 pt/s, life l0..l1 s. */
export const emitSparks = (
  s: SparkState,
  x: number,
  y: number,
  n: number,
  dir: number,
  spread: number,
  v0: number,
  v1: number,
  l0: number,
  l1: number,
  r: number,
  g: number,
  b: number,
  size = 1,
  jitter = 1,
) => {
  "worklet";
  const p = s.p;
  for (let k = 0; k < n; k++) {
    const i = s.next * F;
    s.next = (s.next + 1) % SPARK_N;
    const a = dir + (Math.random() - 0.5) * spread;
    const v = v0 + (v1 - v0) * Math.random();
    p[i] = x + (Math.random() - 0.5) * 2 * jitter;
    p[i + 1] = y + (Math.random() - 0.5) * 2 * jitter;
    p[i + 2] = Math.cos(a) * v;
    p[i + 3] = Math.sin(a) * v;
    p[i + 4] = 0;
    p[i + 5] = l0 + (l1 - l0) * Math.random();
    // random hot white mix: electric sparks have a white core, coloured tail
    const w = 0.35 + Math.random() * 0.45;
    p[i + 6] = r + (1 - r) * w;
    p[i + 7] = g + (1 - g) * w;
    p[i + 8] = b + (1 - b) * w;
    p[i + 9] = size * (0.6 + Math.random() * 0.8);
  }
};

/** Simulate one dt step (s). */
export const stepSparks = (s: SparkState, dt: number) => {
  "worklet";
  const p = s.p;
  const d = Math.exp(-DRAG * dt);
  for (let i = 0; i < SPARK_N * F; i += F) {
    if (p[i + 4] >= p[i + 5]) continue;
    p[i + 4] += dt;
    p[i + 2] *= d;
    p[i + 3] = p[i + 3] * d + G * dt;
    p[i] += p[i + 2] * dt;
    p[i + 1] += p[i + 3] * dt;
  }
  s.tick++;
};

/** Streak image 128×12 px (10.7:1 ratio → thin streak, no blob when many sparks overlap): white core, faint glow. */
const SW = 128, SH = 12;
const makeStreak = (): SkImage => {
  const W = SW, H = SH;
  const surf = Skia.Surface.MakeRaster(W, H)!;
  const c = surf.getCanvas();
  c.clear(Skia.Color("transparent"));
  const p = Skia.Paint();
  p.setAntiAlias(true);
  // glow: vertical gradient
  p.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: 0, y: H },
      [Skia.Color("rgba(255,255,255,0)"), Skia.Color("rgba(255,255,255,0.55)"), Skia.Color("rgba(255,255,255,0)")],
      [0, 0.5, 1],
      TileMode.Clamp,
    ),
  );
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, W, H), H / 2, H / 2), p);
  // core: bright head (right side = heading), fading tail
  const q = Skia.Paint();
  q.setAntiAlias(true);
  q.setBlendMode(BlendMode.Plus);
  q.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: W, y: 0 },
      [Skia.Color("rgba(255,255,255,0)"), Skia.Color("rgba(255,255,255,1)")],
      [0, 1],
      TileMode.Clamp,
    ),
  );
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(4, H / 2 - 1.6, W - 6, 3.2), 1.6, 1.6), q);
  return surf.makeImageSnapshot();
};

const SPR = Skia.XYWHRect(0, 0, SW, SH);

/** Draw all particles. `sparks` must be `stepSparks`-ed every frame (tick changes → buffer updates). */
export function Sparks({ sparks }: { sparks: SharedValue<SparkState> }) {
  const image = useMemo(() => makeStreak(), []);
  const sprites = useMemo(() => new Array(SPARK_N).fill(SPR), []);
  const transforms = useRSXformBuffer(SPARK_N, (val, i) => {
    "worklet";
    const s = sparks.value;
    const p = s.p, o = i * F;
    if (s.tick < 0 || p[o + 4] >= p[o + 5]) {
      val.set(0.001, 0, -999, -999);
      return;
    }
    const vx = p[o + 2], vy = p[o + 3];
    const sp = Math.hypot(vx, vy);
    const life = p[o + 4] / p[o + 5];
    // length follows speed (motion streak), shrinks as it dies; image is 64 px wide → scale to pt
    const len = Math.min(42, 7 + sp * 0.08) * p[o + 9] * (1 - 0.4 * life);
    // just spawned: short streak that then lengthens (avoids every spark piling on the emitter for the first 0.1 s)
    const grow = Math.min(1, p[o + 4] / 0.06);
    const k = (len * (0.25 + 0.75 * grow)) / SW;
    const c = sp > 1e-3 ? vx / sp : 1, sn = sp > 1e-3 ? vy / sp : 0;
    // anchor the streak head (x=64, y=12 in the image) to the particle position
    const sc = k * c, ss = k * sn;
    val.set(sc, ss, p[o] - (sc * SW - ss * (SH / 2)), p[o + 1] - (ss * SW + sc * (SH / 2)));
  });
  const colors = useColorBuffer(SPARK_N, (val, i) => {
    "worklet";
    const s = sparks.value;
    const p = s.p, o = i * F;
    const alive = s.tick >= 0 && p[o + 4] < p[o + 5];
    const life = alive ? p[o + 4] / p[o + 5] : 1;
    // slight twinkle + fade out
    const a = alive ? (1 - life) * (1 - life) * (0.75 + 0.25 * Math.sin(p[o + 4] * 90 + i)) : 0;
    val[0] = p[o + 6] * a;
    val[1] = p[o + 7] * a;
    val[2] = p[o + 8] * a;
    val[3] = a;
  });
  return (
    <Group blendMode="plus">
      <Atlas image={image} sprites={sprites} transforms={transforms} colors={colors} colorBlendMode="modulate" />
    </Group>
  );
}
