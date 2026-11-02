import React, { useMemo } from "react";
import { Atlas, Group, Path, Skia, TileMode, useColorBuffer, useRSXformBuffer, type SkImage } from "react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { NEON_RGB } from "./palette";
import type { Tube } from "./model";

/**
 * "Chase": a hot white light pulse running along the tube from start to end (like a chaser sign).
 * `at` = scene seconds when the pulse starts on this tube, `dur` = time to run the whole tube. Pulse ~14 % of the tube long, bright head, faint tail.
 *
 * Drawn as a "comet" of sprites (Atlas) placed along the tube from ContourMeasure samples, NOT an animated trimmed stroke: on Graphite,
 * an animated trimmed stroke + small-radius BlurMask renders as a flat blob covering the whole tube (v20 → v41). Each segment: a tube-coloured
 * glow dot (round, soft) + a short white core piece rotated to the tangent; the further from the head, the fainter and more tube-coloured.
 */
// v64 critic: the 13–16.8 s chase was invisible at phone size → comet twice as long and brighter
const SEG = 0.26;
/** number of comet segments */
const K = 44;
/** sampling step along the tube (pt) */
const STEP = 2;

// ── sprite images (baked once) ──
const GD = 64; // 64×64 glow dot
const CW = 12, CH = 10; // 12×10 core piece (short segments so it follows the tight curve of the "o")
const makeImages = (): { glow: SkImage; core: SkImage } => {
  const g = Skia.Surface.MakeRaster(GD, GD)!;
  const gc = g.getCanvas();
  gc.clear(Skia.Color("transparent"));
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setShader(
    Skia.Shader.MakeRadialGradient(
      { x: GD / 2, y: GD / 2 },
      GD / 2,
      [Skia.Color("rgba(255,255,255,1)"), Skia.Color("rgba(255,255,255,0.45)"), Skia.Color("rgba(255,255,255,0.12)"), Skia.Color("rgba(255,255,255,0)")],
      [0, 0.25, 0.6, 1],
      TileMode.Clamp,
    ),
  );
  gc.drawCircle(GD / 2, GD / 2, GD / 2, p);
  const c = Skia.Surface.MakeRaster(CW, CH)!;
  const cc = c.getCanvas();
  cc.clear(Skia.Color("transparent"));
  const q = Skia.Paint();
  q.setAntiAlias(true);
  // soft edge around the core (vertical gradient), then the solid core
  q.setShader(
    Skia.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: 0, y: CH },
      [Skia.Color("rgba(255,255,255,0)"), Skia.Color("rgba(255,255,255,0.5)"), Skia.Color("rgba(255,255,255,0)")],
      [0, 0.5, 1],
      TileMode.Clamp,
    ),
  );
  cc.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, CW, CH), CH / 2, CH / 2), q);
  const r = Skia.Paint();
  r.setAntiAlias(true);
  r.setColor(Skia.Color("white"));
  cc.drawRRect(Skia.RRectXY(Skia.XYWHRect(2, CH / 2 - 2, CW - 4, 4), 2, 2), r);
  return { glow: g.makeImageSnapshot(), core: c.makeImageSnapshot() };
};
let IMAGES: { glow: SkImage; core: SkImage } | null = null;
const images = () => (IMAGES ??= makeImages());

/** Tube samples: x, y, tx, ty every STEP pt (flat array, passed to the worklet once). */
const sampleTube = (tube: Tube) => {
  const cm = Skia.ContourMeasureIter(tube.path, false, 1).next();
  if (!cm) return { s: [0, 0, 1, 0], len: 0 };
  const len = cm.length();
  const n = Math.max(2, Math.ceil(len / STEP) + 1);
  const s: number[] = new Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [p, t] = cm.getPosTan(Math.min(len, i * STEP));
    s[i * 4] = p.x;
    s[i * 4 + 1] = p.y;
    s[i * 4 + 2] = t.x;
    s[i * 4 + 3] = t.y;
  }
  return { s, len };
};

const GLOW_SPR = Skia.XYWHRect(0, 0, GD, GD);
const CORE_SPR = Skia.XYWHRect(0, 0, CW, CH);

export function TubeChase({ tube, time, at, dur, flashAt = -1 }: { tube: Tube; time: SharedValue<number>; at: number[]; dur: number[]; flashAt?: number }) {
  // finale: tube core hot white for ~3 frames (0.05 s), then a fast fade (τ 0.08 s). Core only (thinner than the tube body, white
  // mix ≤ 60 %) → the colour shell + letter shapes survive; NO wide glow (v60: additive glows stacked up → "hello" became a white block).
  // The stroke is NOT trimmed, so this is safe.
  const flash = useDerivedValue(() => {
    if (flashAt < 0) return 0;
    const d = time.value - flashAt;
    if (d < 0 || d > 0.6) return 0;
    return d < 0.06 ? 0.55 * (d / 0.06) : 0.55 * Math.exp(-(d - 0.06) / 0.18); // ramp in; v84: saturated (see `hot`) so it can be stronger
  });
  const smp = useMemo(() => sampleTube(tube), [tube]);
  const img = images();
  const glowSprites = useMemo(() => new Array(K).fill(GLOW_SPR), []);
  const coreSprites = useMemo(() => new Array(K).fill(CORE_SPR), []);
  const rgb = NEON_RGB[tube.color] ?? [1, 1, 1];
  const w = tube.width;
  const S = smp.s, L = smp.len, N = S.length / 4;
  // pulse head (pt along the tube), −1 = not running
  const head = useDerivedValue(() => {
    // newest pulse wins (the finale comet starts while the previous chase is still finishing on later tubes)
    for (let i = at.length - 1; i >= 0; i--) {
      const u = (time.value - at[i]) / dur[i];
      if (u >= 0 && u <= 1 + SEG) return u * L;
    }
    return -1;
  });
  const spacing = (L * SEG) / K;
  const glowK = (w * 5.6) / GD;
  const coreK = (w * 0.9) / 4; // 4 px core in the image → w·0.62 pt
  const glowXf = useRSXformBuffer(K, (val, j) => {
    "worklet";
    const h = head.value;
    const s = h - j * spacing;
    if (h < 0 || s < 0 || s > L) {
      val.set(0.001, 0, -999, -999);
      return;
    }
    const f = Math.min(N - 1.001, s / STEP);
    const i0 = Math.floor(f), a = f - i0;
    const x = S[i0 * 4] + (S[i0 * 4 + 4] - S[i0 * 4]) * a;
    const y = S[i0 * 4 + 1] + (S[i0 * 4 + 5] - S[i0 * 4 + 1]) * a;
    // glow grows toward the head
    const k = glowK * (0.75 + 0.25 * (1 - j / K));
    val.set(k, 0, x - (k * GD) / 2, y - (k * GD) / 2);
  });
  const coreXf = useRSXformBuffer(K, (val, j) => {
    "worklet";
    const h = head.value;
    const s = h - j * spacing;
    if (h < 0 || s < 0 || s > L) {
      val.set(0.001, 0, -999, -999);
      return;
    }
    const f = Math.min(N - 1.001, s / STEP);
    const i0 = Math.floor(f), a = f - i0;
    const o = i0 * 4;
    const x = S[o] + (S[o + 4] - S[o]) * a;
    const y = S[o + 1] + (S[o + 5] - S[o + 1]) * a;
    const tx = S[o + 2], ty = S[o + 3];
    const sc = coreK * tx, ss = coreK * ty;
    // anchor the image centre (CW/2, CH/2) to the point on the tube
    val.set(sc, ss, x - (sc * CW) / 2 + (ss * CH) / 2, y - (ss * CW) / 2 - (sc * CH) / 2);
  });
  const glowCol = useColorBuffer(K, (val, j) => {
    "worklet";
    const e = Math.pow(1 - j / K, 1.4);
    const a = head.value < 0 ? 0 : e * 0.38; // v87: 0.5 → 0.38 (white blobs on heart / star, critic v86)
    val[0] = rgb[0] * a;
    val[1] = rgb[1] * a;
    val[2] = rgb[2] * a;
    val[3] = a;
  });
  const coreCol = useColorBuffer(K, (val, j) => {
    "worklet";
    const u = j / K;
    const e = Math.pow(1 - u, 1.2);
    const a = head.value < 0 ? 0 : e * 0.75;
    // hot white head, tail shifting to the tube colour. Head is warm white (#fff2e0): pure white vanished on the cyan letters (v66)
    const m = Math.min(1, u * 1.3);
    val[0] = (1 + (rgb[0] - 1) * m) * a;
    val[1] = (0.949 + (rgb[1] - 0.949) * m) * a;
    val[2] = (0.878 + (rgb[2] - 0.878) * m) * a;
    val[3] = a;
  });
  // core flash: 40 % tube colour + 60 % white, added at 0.6
  const m = (v: number) => Math.round(255 * (0.75 * v + 0.25)); // v84: mostly the tube colour (60 % white smeared, critic v81)
  const hot = `rgba(${m(rgb[0])}, ${m(rgb[1])}, ${m(rgb[2])}, 0.6)`;
  return (
    <>
      <Group opacity={flash} blendMode="plus">
        <Path path={tube.path} style="stroke" strokeWidth={w * 0.5} strokeCap="round" strokeJoin="round" color={hot} />
      </Group>
      <Group blendMode="plus">
        <Atlas image={img.glow} sprites={glowSprites} transforms={glowXf} colors={glowCol} colorBlendMode="modulate" />
        <Atlas image={img.core} sprites={coreSprites} transforms={coreXf} colors={coreCol} colorBlendMode="modulate" />
      </Group>
    </>
  );
}
