import React, { useMemo, useState } from "react";
import { PixelRatio } from "react-native";
import { Atlas, BackdropFilter, Group, RuntimeShader, useColorBuffer, useRSXformBuffer } from "react-native-skia";
import { useAnimatedReaction, useDerivedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { DEMO as SCRIPT } from "../demo/script";
import type { Tube } from "../neon/model";
import { TRANSFORMER, VIEW, type Fit } from "../scene/layout";
import { GHOST_A, GHOST_C, GHOST_D, GHOST_K, R_GLOW, R_LONG, TINY, makeSprites } from "./Intro";
import { introLens } from "./shaders";

/**
 * "Lens" for the main clip's big beats (same visual language as the opener): R/B colour split + jolting horizontal bands (the exact
 * `introLens` shader of the intro → reuses the pipeline compiled during the hold frame, nothing compiles mid-clip) and a lens flare
 * (long thin streak + source halo + ghosts through the frame centre).
 *
 * Zero cost outside the window: BackdropFilter (reads back the drawn image → Graphite must split the render pass) is ONLY mounted from ~0.5 s
 * before until right after each beat (local state → only this component re-renders); the lens flare is 6 Atlas sprites (nearly free).
 * Demo: marks come from the script. Normal mode: the real light switch-on (`power` / `powerAt`); BackdropFilter is pre-mounted while the lights are off
 * (dark alley, cheap scene) to be ready for the next switch-on, removed 0.6 s after it.
 *
 * The main clip stays very restrained (feedback 01/11: full-frame colour split + jolting bands looked like a TikTok preset): NO band jolt,
 * only a ≤ 2 px colour split on the tubes for ≤ 3 frames, on exactly two beats — DROP (lights on) and the finale. Lightning: vertical flare only, no colour
 * split. Finale: no lens flare (the flash is the light bursting from the tubes onto the wall, in NeonScene).
 * introLens channel offset (device px) = amt · (0.014·|q − centre| + 4·px) with px ≈ 3.1 → on the sign (|q − centre| ≲ 600 px)
 * ≈ 21·amt → amt ≤ 0.095. Frame corners shift more (~34·amt) but the wall is fully dark there.
 *
 * Placed LAST in the Canvas (next to IntroLens), device px coordinates.
 */
const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";

/** Flare kind: 0 none, 1 horizontal, 2 vertical. Source: 0 fixed point (fx, fy), 1 sign centre. */
type Beat = {
  at: number;
  /** colour split / jolt strength */
  amp: number;
  /** fraction of horizontal bands that jolt (0 = colour split only) */
  bands: number;
  /** decay (s) */
  tau: number;
  /** window (s) */
  win: number;
  /** re-jolt: [seconds after `at`, added strength, duration] */
  rep: [number, number, number];
  flare: number;
  src: number;
  fx: number;
  fy: number;
  /** flare streak width (pt), flare decay (s) */
  fw: number;
  ftau: number;
  /** strength of flare streak + source halo, ghosts */
  fa: number;
  gh: number;
  /** source halo colour */
  col: [number, number, number];
};

const BOX_TOP: [number, number] = [(TRANSFORMER[0] + TRANSFORMER[2]) / 2, TRANSFORMER[1] + 2];
const NO_REP: [number, number, number] = [0, 0, 0];
const AMBER: [number, number, number] = [1, 0.72, 0.4];

/** restrained colour split: 3 frames (d = 0, 1/60, 2/60), fast decay */
const SPLIT = { bands: 0, tau: 0.03, win: 0.045, rep: NO_REP };
/** Two beats closer than this many seconds → keep one (the stronger beat; flare taken from whichever has one). */
const DEDUPE = 0.3;

const demoBeats = (): Beat[] => {
  const b: Beat[] = [];
  const base = { ...SPLIT, flare: 0, src: 0, fx: 0, fy: 0, fw: 600, ftau: 0.15, fa: 0, gh: 0, col: AMBER };
  // DROP: the switch flip (switchOn / cascade flip) — very light colour split + horizontal flare at the transformer box (spark burst), no ghosts
  const drop = { ...base, amp: 0.07, flare: 1, fx: BOX_TOP[0], fy: BOX_TOP[1], fa: 0.55 };
  if (SCRIPT.switchOn) b.push({ ...drop, at: SCRIPT.switchOn + 0.05 });
  for (const s of SCRIPT.switches) if (s.cascade && s.at > 1) b.push({ ...drop, at: s.at + 0.02 });
  // lightning: no colour split (the flash is light on the wall); only a short vertical flare from the sky side (top left) on the flash beat
  for (const l of SCRIPT.lightning ?? [])
    b.push({ ...base, at: l.at, amp: 0, flare: 2, fx: 70, fy: 170, fw: 700, ftau: 0.04, fa: 0.6, col: [0.85, 0.9, 1] });
  // finale: ≤ 2 px colour split for 3 frames, no lens flare / ghosts
  if (SCRIPT.finale) b.push({ ...base, at: SCRIPT.finale.at, amp: 0.09, src: 1 });
  b.sort((a, c) => a.at - c.at);
  const out: Beat[] = [];
  for (const x of b) {
    const p = out[out.length - 1];
    if (!p || x.at - p.at >= DEDUPE) {
      out.push(x);
      continue;
    }
    const keep = x.amp > p.amp ? { ...x } : p;
    const other = keep === p ? x : p;
    if (keep.flare === 0 && other.flare !== 0) Object.assign(keep, { flare: other.flare, src: other.src, fx: other.fx, fy: other.fy, fw: other.fw, ftau: other.ftau, fa: other.fa, gh: other.gh, col: other.col });
    out[out.length - 1] = keep;
  }
  return out;
};
const BEATS: Beat[] = DEMO ? demoBeats() : [];
/** Beats in normal mode (real lights on), `at` replaced by powerAt + 0.05 at runtime. */
const LIVE_BEAT: Beat = { at: 0, amp: 0.07, ...SPLIT, flare: 1, src: 0, fx: BOX_TOP[0], fy: BOX_TOP[1], fw: 600, ftau: 0.15, fa: 0.55, gh: 0, col: AMBER };
/** Mount BackdropFilter this many seconds before the beat (covers JS thread latency), remove after the window ends. */
const PRE = 0.5;
const POST = 0.1;
const FLARE_WIN = 1.0;

const amtOf = (b: Beat, d: number) => {
  "worklet";
  if (d < 0 || d >= b.win) return 0;
  let v = Math.exp(-d / b.tau);
  if (b.rep[1] > 0 && d >= b.rep[0] && d < b.rep[0] + b.rep[2]) v += b.rep[1];
  return Math.min(1, b.amp * v);
};
const flareOf = (b: Beat, d: number) => {
  "worklet";
  if (b.flare === 0 || d < 0 || d >= FLARE_WIN) return 0;
  return d < 0.015 ? d / 0.015 : Math.exp(-(d - 0.015) / b.ftau);
};

/** sprites: 0 long streak, 1 source halo, 2..4 ghosts, 5 texture warm-up (alpha ~0) — cell size (image px) */
const N = 6;
const SPR_W = [256, 64, 64, 64, 64, 64];
const SPR_H = [6, 64, 64, 64, 64, 64];
/** No flare: warm-up sprite only (top left, alpha ~0 → texture uploads to the GPU as soon as it mounts, without waiting for the first beat). */
const SPR_IDLE = (() => {
  const o = new Array(N * 8).fill(0);
  o[5 * 8] = 8;
  o[5 * 8 + 1] = 8;
  o[5 * 8 + 2] = 4;
  o[5 * 8 + 7] = 0.004;
  return o;
})();

type Props = {
  time: SharedValue<number>;
  /** normal mode: power state + latest switch-on time (NeonScene) */
  power: SharedValue<number>;
  powerAt: SharedValue<number>;
  fit: Fit;
  tubes: Tube[];
};

export function BeatLens({ time, power, powerAt, fit, tubes }: Props) {
  const pr = PixelRatio.get();
  const W = (VIEW.w * fit.k + 2 * fit.ox) * pr;
  const H = (VIEW.h * fit.k + 2 * fit.oy) * pr;
  // sign centre (design pt) for the finale flare
  const sign = useMemo(() => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const t of tubes)
      for (let i = 0; i < t.pts.length; i += 2) {
        x0 = Math.min(x0, t.pts[i]);
        x1 = Math.max(x1, t.pts[i]);
        y0 = Math.min(y0, t.pts[i + 1]);
        y1 = Math.max(y1, t.pts[i + 1]);
      }
    return tubes.length ? [(x0 + x1) / 2, (y0 + y1) / 2] : [VIEW.w / 2, VIEW.h / 2];
  }, [tubes]);

  // beat in progress (or about to be): [beat index (−1 = real lights on, −2 = none), seconds since the beat]
  const cur = useDerivedValue(() => {
    const t = time.value;
    let best = -2, bd = 0;
    for (let i = 0; i < BEATS.length; i++) {
      const d = t - BEATS[i].at;
      if (d >= -PRE && d < FLARE_WIN) {
        best = i;
        bd = d;
      }
    }
    if (!DEMO && power.value > 0.5) {
      const d = t - powerAt.value - 0.05;
      if (d >= -PRE && d < FLARE_WIN) {
        best = -1;
        bd = d;
      }
    }
    return [best, bd];
  });

  // mount / remove BackdropFilter (once per state change)
  const [mounted, setMounted] = useState(false);
  useAnimatedReaction(
    () => {
      const i = cur.value[0], d = cur.value[1];
      if (!DEMO && power.value < 0.5) return true; // lights off: stand by for the next switch-on
      if (i === -2) return false;
      const b = i === -1 ? LIVE_BEAT : BEATS[i];
      // beat without colour split (lightning): don't mount BackdropFilter (avoids a pointless render-pass split)
      return b.amp > 0 && d < b.win + POST;
    },
    (want, prev) => {
      if (want !== prev) scheduleOnRN(setMounted, want);
    },
  );

  // outside the window: return a prebuilt constant (no per-frame allocation)
  const idle = useMemo(
    () => ({ clip: TINY, u: { box: [0, 0, W, H], amt: 0, seed: 0, px: fit.k * pr, ctr: [W / 2, H / 2], heat: [0, 0, 1, 0], time: 0, bands: 0 } }),
    [W, H, fit.k, pr],
  );
  const lens = useDerivedValue(() => {
    const i = cur.value[0], d = cur.value[1];
    const b = i === -2 ? null : i === -1 ? LIVE_BEAT : BEATS[i];
    const amt = b ? amtOf(b, d) : 0;
    if (amt <= 0.002) return idle;
    const full = { x: 0, y: 0, width: W, height: H };
    return {
      clip: full,
      u: {
        box: [0, 0, W, H],
        amt,
        seed: Math.floor(time.value * 60) % 241,
        px: fit.k * pr,
        ctr: [W / 2, H / 2],
        heat: [0, 0, 1, 0],
        time: time.value,
        bands: b ? b.bands : 0,
      },
    };
  });
  const clip = useDerivedValue(() => lens.value.clip);
  const U = useDerivedValue(() => lens.value.u);

  // lens flare (device px; the intro camera is back to identity — ignore the scene's small punch)
  const image = useMemo(() => makeSprites(), []);
  const sprites = useMemo(() => [R_LONG, R_GLOW, R_GLOW, R_GLOW, R_GLOW, R_GLOW], []);
  // [x, y (px), diameter (px), angle, r, g, b, a] for sprite j
  const spr = useDerivedValue(() => {
    const i = cur.value[0], d = cur.value[1];
    const b = i === -2 ? null : i === -1 ? LIVE_BEAT : BEATS[i];
    const f = b ? flareOf(b, d) : 0;
    if (!b || f <= 0.003) return SPR_IDLE;
    const out = SPR_IDLE.slice();
    const sxp = b.src === 1 ? sign[0] : b.fx, syp = b.src === 1 ? sign[1] : b.fy;
    const sx = (fit.ox + fit.k * sxp) * pr, sy = (fit.oy + fit.k * syp) * pr;
    const u = fit.k * pr;
    const vert = b.flare === 2;
    // long streak
    out[0] = sx;
    out[1] = sy;
    out[2] = b.fw * u;
    out[3] = vert ? Math.PI / 2 : 0;
    out[4] = 0.55;
    out[5] = 0.72;
    out[6] = 1;
    out[7] = b.fa * f;
    // source halo
    out[8] = sx;
    out[9] = sy;
    out[10] = (vert ? 220 : 150) * u;
    out[12] = b.col[0];
    out[13] = b.col[1];
    out[14] = b.col[2];
    out[15] = 0.6 * b.fa * f;
    // ghosts on the line from the source through the frame centre (lightning's vertical streak: no ghosts)
    if (!vert && b.gh > 0)
      for (let g = 0; g < 3; g++) {
        const o = (2 + g) * 8;
        out[o] = W / 2 + (W / 2 - sx) * GHOST_K[g];
        out[o + 1] = H / 2 + (H / 2 - sy) * GHOST_K[g];
        out[o + 2] = GHOST_D[g] * u;
        out[o + 4] = GHOST_C[g * 3];
        out[o + 5] = GHOST_C[g * 3 + 1];
        out[o + 6] = GHOST_C[g * 3 + 2];
        out[o + 7] = GHOST_A[g] * b.gh * f;
      }
    return out;
  });
  const transforms = useRSXformBuffer(N, (val, j) => {
    "worklet";
    const s = spr.value, o = j * 8;
    if (s[o + 7] <= 0) {
      val.set(0.001, 0, -1e4, -1e4);
      return;
    }
    const w = SPR_W[j], h = SPR_H[j];
    const k = s[o + 2] / w;
    const sc = k * Math.cos(s[o + 3]), ss = k * Math.sin(s[o + 3]);
    val.set(sc, ss, s[o] - (sc * w) / 2 + (ss * h) / 2, s[o + 1] - (ss * w) / 2 - (sc * h) / 2);
  });
  const colors = useColorBuffer(N, (val, j) => {
    "worklet";
    const s = spr.value, o = j * 8, a = s[o + 7];
    val[0] = s[o + 4] * a;
    val[1] = s[o + 5] * a;
    val[2] = s[o + 6] * a;
    val[3] = a;
  });

  return (
    <Group transform={[{ scale: 1 / pr }]}>
      {mounted && <BackdropFilter clip={clip} filter={<RuntimeShader source={introLens} uniforms={U} />} />}
      <Group blendMode="plus">
        <Atlas image={image} sprites={sprites} transforms={transforms} colors={colors} colorBlendMode="modulate" />
      </Group>
    </Group>
  );
}

/** Beat list (for sound design / checks): [second, strength, band fraction, flare kind]. */
export const BEAT_LIST = BEATS.map((b) => [b.at, b.amp, b.bands, b.flare] as const);
