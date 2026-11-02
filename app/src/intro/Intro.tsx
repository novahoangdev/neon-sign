import React, { useEffect, useMemo, useState } from "react";
import { PixelRatio } from "react-native";
import {
  Atlas,
  BackdropFilter,
  BlendColor,
  Blur,
  BlendMode,
  FilterMode,
  Fill,
  Group,
  Image,
  ImageShader,
  MipmapMode,
  Path,
  Rect,
  RuntimeShader,
  Shader,
  Skia,
  TileMode,
  useColorBuffer,
  useRSXformBuffer,
  type SkImage,
  type SkPath,
  type SkRect,
} from "react-native-skia";
import { useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { Tube } from "../neon/model";
import { NEON, NEON_LIN } from "../neon/palette";
import { HORIZON, PUDDLE, REFL_K, VIEW, type Fit } from "../scene/layout";
import { fireHaptic, type HapticKind } from "../fx/haptics";
import { sfx, type Sfx } from "../fx/audio";
import { buildIntro, type IntroGeo, type IntroUnit } from "./plan";
import { introArc, introLens, introLight, introRain } from "./shaders";
import {
  CX,
  CY,
  INTRO_LEN,
  INTRO_T0,
  N_SPARK,
  SPARK_F,
  STRIKE_AT,
  T_BOX,
  T_CONDUIT,
  cabProg,
  T_HIT,
  T_LAUNCH,
  T_SURGE,
  T_UNMOUNT,
  arcI,
  arcLight,
  boxFlash,
  clamp01,
  darkOp,
  headAt,
  headInt,
  hitFlash,
  introRainK,
  breathe,
  breatheSize,
  introCamera,
  pathAt,
  ringI,
  ringR,
  surgeFlash,
  tubeProg,
  type IntroPlan,
} from "./timeline";

export { INTRO_LEN, INTRO_T0, introBright, introRainK, introWallBright } from "./timeline";
export type { IntroPlan } from "./timeline";

/**
 * "LIVE WIRE" opener — see timeline.ts for each beat. Integration into NeonScene:
 *  - `useIntro(tubes, time)` → { plan, cam, geo } (built ONCE from the tubes present when the scene opens)
 *  - `cam`: camera transform, wraps every "world" layer (wall → rain) in Group transform={cam}
 *  - `<IntroWall …/>`: right after the wall Fill (inside Group wallT) — volumetric point light on the bricks
 *  - `<IntroFx …/>`: after <Sparks/> inside Group tubeT — dark overlay, gas igniting behind the wavefront, arc, plasma bead, sparks
 *  - `introBright(t, plan.value, k, v)`: in the frame worklet's slot loop, right before `b[s.k] = v`
 * Both layers remove themselves from the draw tree at T_UNMOUNT (local state, no NeonScene re-render).
 */

const LINEAR = { filter: FilterMode.Linear, mipmap: MipmapMode.None };
const IDENT = [{ scale: 1 }];
const BLUE = [0.62, 0.8, 1];
const AMBER = [1, 0.72, 0.36];
const lin = (c: number[]) => c.map((v) => Math.pow(v, 2.2));
const BLUE_L = lin(BLUE);
const AMBER_L = lin(AMBER);

// ── built once ──
export function useIntro(tubes: Tube[], time: SharedValue<number>) {
  // only tubes present when the scene opens get "written" — tubes drawn later don't affect the intro
  const [geo] = useState<IntroGeo>(() => buildIntro(INTRO_LEN > 0 ? tubes : []));
  const plan = useSharedValue<IntroPlan>(geo.plan);
  const scratch = useSharedValue<number[]>(new Array(8).fill(0));
  const cam = useDerivedValue(() => {
    const t = time.value;
    if (INTRO_LEN <= 0 || t >= -0.03 || t < INTRO_T0 - 0.5) return IDENT;
    const s = scratch.value;
    introCamera(t, plan.value, s);
    return [{ translateX: CX }, { translateY: CY }, { rotate: s[3] }, { scale: s[0] }, { translateX: -s[1] }, { translateY: -s[2] }];
  });
  return { plan, cam, geo };
}

/** Layer still in the draw tree? Removes itself (local state) once scene time passes T_UNMOUNT. */
const useLive = (time: SharedValue<number>) => {
  const [live, setLive] = useState(INTRO_LEN > 0);
  useAnimatedReaction(
    () => time.value > T_UNMOUNT,
    (done, prev) => {
      if (done && !prev) scheduleOnRN(setLive, false);
    },
  );
  return live;
};

// ── light on the wall ──
type WallProps = {
  time: SharedValue<number>;
  plan: SharedValue<IntroPlan>;
  geo: IntroGeo;
  ambient: SkImage;
  albedo: SkImage;
  normal: SkImage;
  data: SkImage;
};

export function IntroWall(props: WallProps) {
  const live = useLive(props.time);
  return live ? <IntroWallOn {...props} /> : null;
}

/**
 * Intro light sources at second t (shared by wall and rain): 0 arc + box flash, 1 pulse head, 2 electrode flash,
 * plus the sweeping ring. Linear colour × intensity.
 */
const lightsAt = (t: number, P: IntroPlan, colL: number[], s: number[]) => {
  "worklet";
  const lp = [0, 0, 9, 0, 0, 8, 0, 0, 10];
  const lc = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  // 0: arc (keeps smouldering between strikes) + box flash
  const ai = arcLight(t) * 4.6, bf = boxFlash(t) * 3.4; // the arc must clearly light the wet bricks around the box in the first frame
  lp[0] = (P.arc[0] + P.arc[2]) / 2;
  lp[1] = (P.arc[1] + P.arc[3]) / 2 + 2;
  for (let j = 0; j < 3; j++) lc[j] = BLUE_L[j] * ai + AMBER_L[j] * bf;
  // 1: pulse head (conduit: cold; cable / neon tube: gas colour mixed with white)
  headAt(t, P, s, 0);
  const hi = headInt(t);
  if (s[3] > 0 && hi > 0) {
    lp[3] = s[0];
    lp[4] = s[1];
    // v4: the plasma bead is the main light source of the opening frame (wall is dark while the neon is off)
    for (let j = 0; j < 3; j++) lc[3 + j] = s[3] === 1 ? BLUE_L[j] * 1.8 * hi : (colL[j] * 0.7 + 0.3) * 3.8 * hi;
  }
  // 2: electrode flash (hit → overload)
  if (P.on > 0) {
    const useTail = t >= T_SURGE;
    const f = useTail ? surgeFlash(t) * 4.5 : hitFlash(t) * 4;
    lp[6] = useTail ? P.tail[0] : P.head[0];
    lp[7] = useTail ? P.tail[1] : P.head[1];
    for (let j = 0; j < 3; j++) lc[6 + j] = (colL[j] * 0.75 + 0.25) * f;
  }
  // light ring sweeping the wall
  const k = ringI(t, P.ring[2]) * (P.on > 0 ? 1.5 : 1.3);
  const rc = P.on > 0 ? [colL[0] * 0.6 + 0.4, colL[1] * 0.6 + 0.4, colL[2] * 0.6 + 0.4] : BLUE_L;
  return {
    lp,
    lc,
    lr: [260, 240, 260],
    ring: [P.ring[0], P.ring[1], ringR(t, P.ring[2]), 42],
    ringC: [rc[0] * k, rc[1] * k, rc[2] * k],
  };
};

function IntroWallOn({ time, plan, geo, ambient, albedo, normal, data }: WallProps) {
  const imgK = ambient.width() / VIEW.w;
  const colL = NEON_LIN[geo.color];
  const scratch = useSharedValue<number[]>(new Array(8).fill(0));
  const U = useDerivedValue(() => {
    const t = time.value;
    const L = lightsAt(t, plan.value, colL, scratch.value);
    return { ...L, imgK, horizon: HORIZON, reflK: REFL_K, expo: 1 / Math.max(0.35, 1 - darkOp(t)) };
  });
  return (
    <Fill blendMode="plus">
      <Shader source={introLight} uniforms={U}>
        <ImageShader image={ambient} tx="clamp" ty="clamp" sampling={LINEAR} />
        <ImageShader image={albedo} tx="clamp" ty="clamp" sampling={LINEAR} />
        <ImageShader image={normal} tx="clamp" ty="clamp" sampling={LINEAR} />
        <ImageShader image={data} tx="clamp" ty="clamp" sampling={LINEAR} />
      </Shader>
    </Fill>
  );
}

// ── rain catching the intro light (placed right after the scene's rain Fill, same coordinate space, outside the parallax group) ──
type AirProps = { time: SharedValue<number>; plan: SharedValue<IntroPlan>; geo: IntroGeo };
export function IntroAir(props: AirProps) {
  const live = useLive(props.time);
  return live ? <IntroAirOn {...props} /> : null;
}
function IntroAirOn({ time, plan, geo }: AirProps) {
  const colL = NEON_LIN[geo.color];
  const scratch = useSharedValue<number[]>(new Array(16).fill(0));
  const U = useDerivedValue(() => {
    const t = time.value;
    const P = plan.value;
    const s = scratch.value;
    const L = lightsAt(t, P, colL, s);
    // rain streaks sized to the SCREEN (not scaled by camera zoom); lighting still uses world coordinates
    if (t < -0.03) introCamera(t, P, s, 8);
    else {
      s[8] = 1;
      s[9] = CX;
      s[10] = CY;
      s[11] = 0;
    }
    return { ...L, time: t, horizon: HORIZON, viewH: VIEW.h, cam: [s[8], s[9], s[10], s[11]], ctr: [CX, CY], rk: introRainK(t, P) };
  });
  return (
    <Fill blendMode="plus">
      <Shader source={introRain} uniforms={U} />
    </Fill>
  );
}

// ── sprites: spark streak, halo, core, horizontal (anamorphic) flare ──
const SW = 128, SH = 12;
const R_STREAK = Skia.XYWHRect(0, 0, SW, SH);
const R_FLARE = Skia.XYWHRect(0, 20, 128, 12);
export const R_GLOW = Skia.XYWHRect(132, 0, 64, 64);
const R_CORE = Skia.XYWHRect(200, 0, 32, 32);
/** long, very thin (anamorphic) lens streak: 256 × 6 px */
export const R_LONG = Skia.XYWHRect(0, 44, 256, 6);
export const makeSprites = (): SkImage => {
  const surf = Skia.Surface.MakeRaster(260, 64)!;
  const c = surf.getCanvas();
  c.clear(Skia.Color("transparent"));
  const p = Skia.Paint();
  p.setAntiAlias(true);
  const W = (a: number) => Skia.Color(`rgba(255,255,255,${a})`);
  // spark streak (as in Sparks.tsx): vertical halo + core bright at the head, fading at the tail
  p.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: 0, y: SH }, [W(0), W(0.55), W(0)], [0, 0.5, 1], TileMode.Clamp));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, SW, SH), SH / 2, SH / 2), p);
  const q = Skia.Paint();
  q.setAntiAlias(true);
  q.setBlendMode(BlendMode.Plus);
  q.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: SW, y: 0 }, [W(0), W(1)], [0, 1], TileMode.Clamp));
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(4, SH / 2 - 1.6, SW - 6, 3.2), 1.6, 1.6), q);
  // horizontal flare: bright centre, thin, fading at both ends
  const f = Skia.Paint();
  f.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: 128, y: 0 }, [W(0), W(0.18), W(1), W(0.18), W(0)], [0, 0.3, 0.5, 0.7, 1], TileMode.Clamp));
  c.drawRect(R_FLARE, f);
  const fm = Skia.Paint();
  fm.setBlendMode(BlendMode.DstIn);
  fm.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 20 }, { x: 0, y: 32 }, [W(0), W(1), W(0)], [0, 0.5, 1], TileMode.Clamp));
  c.drawRect(R_FLARE, fm);
  // soft (near-Gaussian) halo and hot core
  const g = Skia.Paint();
  g.setShader(Skia.Shader.MakeRadialGradient({ x: 164, y: 32 }, 32, [W(1), W(0.5), W(0.18), W(0.05), W(0)], [0, 0.16, 0.4, 0.7, 1], TileMode.Clamp));
  c.drawRect(R_GLOW, g);
  const k = Skia.Paint();
  k.setShader(Skia.Shader.MakeRadialGradient({ x: 216, y: 16 }, 16, [W(1), W(1), W(0.45), W(0)], [0, 0.3, 0.6, 1], TileMode.Clamp));
  c.drawRect(R_CORE, k);
  const l = Skia.Paint();
  l.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 0 }, { x: 256, y: 0 }, [W(0), W(0.12), W(0.45), W(1), W(0.45), W(0.12), W(0)], [0, 0.18, 0.4, 0.5, 0.6, 0.82, 1], TileMode.Clamp));
  c.drawRect(R_LONG, l);
  const lm = Skia.Paint();
  lm.setBlendMode(BlendMode.DstIn);
  lm.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: 44 }, { x: 0, y: 50 }, [W(0), W(1), W(0)], [0, 0.5, 1], TileMode.Clamp));
  c.drawRect(R_LONG, lm);
  return surf.makeImageSnapshot();
};

/** Number of special sprites (halo / core / flare / trail) after the N_SPARK sparks. */
const N_SPEC = 47;
const TRAIL = 20;
const N_ALL = N_SPARK + N_SPEC;
/** Cell size of special sprite j (worklet, numbers only — no SkRect on the UI thread): 0 core, 1 horizontal flare, 2 halo, 3 long streak. */
const specKind = (j: number) => {
  "worklet";
  if (j === 36 || j === 40 || j === 44) return 3;
  if (j === 2 || j === 25 || j === 28 || j === 31 || j === 34) return 0;
  if (j === 3 || j === 32 || j === 35) return 1;
  return 2;
};
const SPEC_W = [32, 128, 64, 256];
const SPEC_H = [32, 12, 64, 6];
const specRect = (j: number): SkRect => {
  if (j === 36 || j === 40 || j === 44) return R_LONG;
  if (j === 2 || j === 25 || j === 28 || j === 31 || j === 34) return R_CORE;
  if (j === 3 || j === 32 || j === 35) return R_FLARE;
  return R_GLOW;
};

const D_DRAG = 1.6; // matches Sparks.tsx
const G = 520;

/** Write colour + alpha into s[4..7]. */
const setC = (s: number[], r: number, g: number, b: number, a: number) => {
  "worklet";
  s[4] = r;
  s[5] = g;
  s[6] = b;
  s[7] = a;
};

/** Lens ghost colours (multi-reflection lens coating → each ghost a different colour), position factor along the axis through the frame centre, size. */
export const GHOST_C = [0.35, 0.95, 0.85, 1, 0.6, 0.3, 0.65, 0.45, 1];
export const GHOST_K = [0.6, 1.25, -0.4];
export const GHOST_D = [44, 96, 24];
export const GHOST_A = [0.2, 0.1, 0.28];

/**
 * Lens flare j = 36..46: long thin horizontal streak (always horizontal in the FRAME, compensating camera tilt) + round ghosts
 * on the line from the light source through the frame centre (positions follow the intro camera). Three events: electrode hit (36–39),
 * overload (40–43), box thump (44–46). s[12..19]: scratch for introCamera.
 */
const lensFlare = (j: number, t: number, P: IntroPlan, s: number[]) => {
  "worklet";
  const ev = j <= 39 ? 0 : j <= 43 ? 1 : 2;
  // electrode hit: no streak / ghosts (reads like a stock star sprite) — only the round halo j 27–29
  if (ev === 0) return;
  if (ev === 1 && P.on === 0) return;
  const f = ev === 1 ? surgeFlash(t) : boxFlash(t);
  if (f <= 0.003) return;
  const sx = ev === 1 ? P.tail[0] : (P.arc[0] + P.arc[2]) / 2;
  const sy = ev === 1 ? P.tail[1] : P.arc[1] - 6;
  introCamera(t, P, s, 12);
  const z = s[12], cx = s[13], cy = s[14], rot = s[15];
  const idx = j - (ev === 1 ? 40 : 44);
  if (idx === 0) {
    s[0] = sx;
    s[1] = sy;
    s[2] = (ev === 1 ? 640 : 560) / z;
    s[3] = -rot;
    setC(s, 0.55, 0.72, 1, (ev === 1 ? 0.3 : ev === 2 ? 0.4 : 0.6) * f);
    return;
  }
  // overload: thin streak only, no ghosts (the climax is the tubes' own bloom)
  if (ev === 1) return;
  const g = idx - 1;
  s[0] = cx + (cx - sx) * GHOST_K[g];
  s[1] = cy + (cy - sy) * GHOST_K[g];
  s[2] = GHOST_D[g] / z;
  setC(s, GHOST_C[g * 3], GHOST_C[g * 3 + 1], GHOST_C[g * 3 + 2], GHOST_A[g] * f);
};

/**
 * Special sprite j at second t → s[0..7] = x, y, diameter (pt), angle, r, g, b, alpha. Hidden: alpha 0.
 * s[8..11] used as scratch for headAt / pathAt.
 */
const special = (j: number, t: number, P: IntroPlan, s: number[]) => {
  "worklet";
  s[3] = 0;
  s[7] = 0;
  const col = P.col;
  if (j <= 3 + TRAIL) {
    const hi = headInt(t);
    if (hi <= 0) return;
    headAt(t, P, s, 8);
    const ph = s[11];
    if (ph === 0) return;
    const cold = ph === 1;
    const cr = cold ? BLUE[0] : col[0], cg = cold ? BLUE[1] : col[1], cb = cold ? BLUE[2] : col[2];
    s[0] = s[8];
    s[1] = s[9];
    if (j === 0) {
      s[2] = 64;
      setC(s, cr, cg, cb, 0.42 * hi);
    } else if (j === 1) {
      s[2] = 20;
      setC(s, cr * 0.5 + 0.5, cg * 0.5 + 0.5, cb * 0.5 + 0.5, 0.75 * hi);
    } else if (j === 2) {
      s[2] = 7.5;
      setC(s, 1, 1, 1, hi);
    } else if (j === 3) {
      // the plasma bead's horizontal flare was dropped (together with the electrode flare it formed a cross in the first frame)
      return;
    } else {
      // trail: freshly ignited gas behind the wavefront / cable still hot
      const i = j - 3;
      const sv = s[10] - i * 8;
      if (sv < 0) return;
      pathAt(P, ph, sv, s, 0);
      s[2] = 15 * (1 - i / 24);
      setC(s, cr, cg, cb, 0.36 * hi * (1 - i / (TRAIL + 1)));
    }
    return;
  }
  if (j === 24 || j === 25 || j === 35) {
    const f = boxFlash(t);
    if (f <= 0) return;
    s[0] = j === 24 ? 321 : (P.arc[0] + P.arc[2]) / 2;
    s[1] = j === 24 ? 606 : P.arc[1];
    if (j === 24) {
      s[2] = 110;
      setC(s, AMBER[0], AMBER[1], AMBER[2], 0.55 * f);
    } else if (j === 25) {
      s[2] = 26;
      setC(s, 1, 0.92, 0.8, 0.9 * f);
    } else {
      s[2] = 240;
      setC(s, 1, 0.85, 0.65, 0.3 * f);
    }
    return;
  }
  if (j === 26) {
    const a = arcI(t);
    if (a <= 0) return;
    s[0] = (P.arc[0] + P.arc[2]) / 2;
    s[1] = P.arc[1] + 2;
    s[2] = 90;
    setC(s, BLUE[0], BLUE[1], BLUE[2], Math.min(0.5, 0.32 * a));
    return;
  }
  if (j >= 36) {
    lensFlare(j, t, P, s);
    return;
  }
  if (P.on === 0) return;
  if (j <= 29) {
    // round halo at the electrode as the plasma hits: white-hot core → pink, radius ~18 pt ON SCREEN (divided by camera zoom),
    // breathing / slight flicker, no rays
    const f = hitFlash(t);
    if (f <= 0) return;
    introCamera(t, P, s, 12);
    const z = s[12];
    const b = breathe(t), k = breatheSize(t) / z;
    s[0] = P.head[0];
    s[1] = P.head[1];
    if (j === 27) {
      // outer pink halo
      s[2] = 120 * k;
      setC(s, col[0], col[1], col[2], Math.min(1, 0.38 * f * b));
    } else if (j === 29) {
      // halo body: pink mixed with white, edge ~18 pt
      s[2] = 58 * k;
      setC(s, col[0] * 0.45 + 0.55, col[1] * 0.45 + 0.55, col[2] * 0.45 + 0.55, Math.min(1, 0.85 * f * b));
    } else {
      // white-hot core
      s[2] = 18 * k;
      setC(s, 1, 0.97, 0.98, Math.min(1, f * b));
    }
    return;
  }
  const f = surgeFlash(t);
  if (f <= 0) return;
  const tail = j <= 32;
  s[0] = tail ? P.tail[0] : P.head[0];
  s[1] = tail ? P.tail[1] : P.head[1];
  if (j === 30) {
    s[2] = 150;
    setC(s, col[0], col[1], col[2], 0.6 * f);
  } else if (j === 31) {
    s[2] = 30;
    setC(s, 1, 1, 1, f);
  } else if (j === 32) {
    s[2] = 300;
    setC(s, 0.65, 0.78, 1, 0.38 * f);
  } else if (j === 33) {
    s[2] = 110;
    setC(s, col[0], col[1], col[2], 0.45 * f);
  } else {
    s[2] = 20;
    setC(s, 1, 1, 1, 0.8 * f);
  }
};

/** Spark i (prebuilt in plan.sp) at second t: analytic position (gravity + drag, matches Sparks.tsx) → s[0..5] = x, y, vx, vy, age/life, age. */
const sparkAt = (i: number, t: number, P: IntroPlan, s: number[]) => {
  "worklet";
  const o = i * SPARK_F;
  const sp = P.sp;
  const tau = t - sp[o];
  const life = sp[o + 5];
  if (tau < 0 || tau >= life) return false;
  const ed = Math.exp(-D_DRAG * tau);
  const e = (1 - ed) / D_DRAG;
  s[0] = sp[o + 1] + sp[o + 3] * e;
  s[1] = sp[o + 2] + sp[o + 4] * e + (G * (tau - e)) / D_DRAG;
  s[2] = sp[o + 3] * ed;
  s[3] = sp[o + 4] * ed + (G * (1 - ed)) / D_DRAG;
  s[4] = tau / life;
  s[5] = tau;
  return true;
};

const PUDDLE_CLIP = { x: PUDDLE[0], y: HORIZON + 4, width: PUDDLE[2] - PUDDLE[0], height: PUDDLE[3] - HORIZON + 30 };
const MIRROR = [{ translateY: HORIZON * (1 + 1 / REFL_K) }, { scaleY: -1 / REFL_K }];

/** The demo build mixes its own audio (mix_showcase.py) → no intro sound / haptics in the app. */
const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";
/** In-app sound / haptic cues (normal mode). [second, sound, volume, haptic] */
type Cue = [number, Sfx, number, HapticKind | ""];
const CUES: Cue[] = [
  ...STRIKE_AT.filter((s) => s > INTRO_T0 + 0.01).map((s): Cue => [s, "glitch", 0.5, "light"]),
  [T_HIT, "flick", 1, "medium"] as Cue,
  [T_HIT + 0.03, "flow", 0.8, ""] as Cue,
  [T_SURGE, "glitch", 0.9, "heavy"] as Cue,
].sort((a, b) => a[0] - b[0]);
const CUE_AT = CUES.map((c) => c[0]);
const playCue = (i: number) => {
  const c = CUES[i];
  sfx(c[1], c[2]);
  if (c[3]) fireHaptic(c[3]);
};

// ── effect layer over the tubes ──
type FxProps = { time: SharedValue<number>; plan: SharedValue<IntroPlan>; geo: IntroGeo };

export function IntroFx(props: FxProps) {
  const live = useLive(props.time);
  return live ? <IntroFxOn {...props} /> : null;
}

function IntroFxOn({ time, plan, geo }: FxProps) {
  const image = useMemo(() => makeSprites(), []);
  const sprites = useMemo(() => Array.from({ length: N_ALL }, (_, i) => (i < N_SPARK ? R_STREAK : specRect(i - N_SPARK))), []);
  const scratch = useSharedValue<number[]>(new Array(20).fill(0));
  const transforms = useRSXformBuffer(N_ALL, (val, i) => {
    "worklet";
    const t = time.value;
    const P = plan.value;
    const s = scratch.value;
    if (i < N_SPARK) {
      if (!sparkAt(i, t, P, s)) {
        val.set(0.001, 0, -1e4, -1e4);
        return;
      }
      const vx = s[2], vy = s[3];
      const sp = Math.hypot(vx, vy);
      const o = i * SPARK_F;
      const len = Math.min(42, 7 + sp * 0.08) * P.sp[o + 9] * (1 - 0.4 * s[4]);
      const grow = Math.min(1, s[5] / 0.06);
      const k = (len * (0.25 + 0.75 * grow)) / SW;
      const c = sp > 1e-3 ? vx / sp : 1, sn = sp > 1e-3 ? vy / sp : 0;
      const sc = k * c, ss = k * sn;
      // anchor the streak head (x = SW, y = SH/2) at the bead position
      val.set(sc, ss, s[0] - (sc * SW - ss * (SH / 2)), s[1] - (ss * SW + sc * (SH / 2)));
      return;
    }
    const j = i - N_SPARK;
    special(j, t, P, s);
    if (s[7] <= 0.002) {
      val.set(0.001, 0, -1e4, -1e4);
      return;
    }
    // specRect (SkRect, plain JS function) called in a worklet made the Release build abort on the first frame (v43) → use a number table
    const kd = specKind(j);
    const w = SPEC_W[kd], h = SPEC_H[kd];
    const k = s[2] / w;
    const sc = k * Math.cos(s[3]), ss = k * Math.sin(s[3]);
    val.set(sc, ss, s[0] - (sc * w) / 2 + (ss * h) / 2, s[1] - (ss * w) / 2 - (sc * h) / 2);
  });
  const colors = useColorBuffer(N_ALL, (val, i) => {
    "worklet";
    const t = time.value;
    const P = plan.value;
    const s = scratch.value;
    if (i < N_SPARK) {
      if (!sparkAt(i, t, P, s)) {
        val[0] = 0;
        val[1] = 0;
        val[2] = 0;
        val[3] = 0;
        return;
      }
      const o = i * SPARK_F;
      const a = (1 - s[4]) * (1 - s[4]) * (0.75 + 0.25 * Math.sin(s[5] * 90 + i));
      val[0] = P.sp[o + 6] * a;
      val[1] = P.sp[o + 7] * a;
      val[2] = P.sp[o + 8] * a;
      val[3] = a;
      return;
    }
    special(i - N_SPARK, t, P, s);
    const a = s[7];
    val[0] = s[4] * a;
    val[1] = s[5] * a;
    val[2] = s[6] * a;
    val[3] = a;
  });

  // arc
  const arcRect = useMemo(() => {
    const a = geo.plan.arc;
    const x0 = Math.min(a[0], a[2]) - 46, x1 = Math.max(a[0], a[2]) + 46;
    const y0 = Math.min(a[1], a[3]) - 34, y1 = Math.max(a[1], a[3]) + 48;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, [geo]);
  const arcU = useDerivedValue(() => {
    const t = time.value;
    const a = plan.value.arc;
    return { a: [a[0], a[1]], b: [a[2], a[3]], seed: Math.floor(t * 32) % 997, inten: arcI(t), amp: 4.5, col: BLUE };
  });

  // dark overlay: the scene opens in darkness, brightens as the sign gets written
  const dark = useDerivedValue(() => darkOp(time.value));

  // Warm up audio while the clock is still stopped on the hold frame: expo-audio's FIRST play() runs on the main thread
  // (also the UI thread for Reanimated/Skia) and can block ~0.1–0.3 s → play silently every intro / scene sound about to be used as soon as
  // the layer mounts (NeonScene's initAudio already ran earlier, when the scene mounted).
  useEffect(() => {
    const id = setTimeout(() => {
      const warm: Sfx[] = ["glitch", "flow", "flick", "flick", "flick", "flick", "switch_off", "switch_on", "freeze"];
      warm.forEach((n) => sfx(n, 0));
    }, 0);
    return () => clearTimeout(id);
  }, []);
  // sound + haptics (once per mark)
  const cueIdx = useSharedValue(DEMO ? CUE_AT.length : 0);
  useAnimatedReaction(
    () => time.value,
    (t) => {
      let i = cueIdx.value;
      // clock still stopped on the hold frame (waiting for the scene to be ready): don't play yet
      if (t <= INTRO_T0 + 0.001 || i >= CUE_AT.length) return;
      while (i < CUE_AT.length && t >= CUE_AT[i]) {
        if (t - CUE_AT[i] < 0.25) scheduleOnRN(playCue, i);
        i++;
      }
      if (i !== cueIdx.value) cueIdx.set(i);
    },
  );

  const fx = (
    <>
      <Rect {...arcRect} blendMode="plus">
        <Shader source={introArc} uniforms={arcU} />
      </Rect>
      <Group blendMode="plus">
        <Atlas image={image} sprites={sprites} transforms={transforms} colors={colors} colorBlendMode="modulate" />
      </Group>
    </>
  );
  return (
    <Group>
      <Fill color="black" opacity={dark} />
      <SurgeFlash time={time} geo={geo} />
      {geo.units.map((u) => (
        <UnitFront key={`${u.k}`} u={u} time={time} total={geo.plan.tubLen} lit={geo.plan.lit[u.k]} />
      ))}
      {geo.wire && <WireGlow path={geo.wire} time={time} total={geo.plan.cabLen} color={NEON[geo.color].hex} />}
      {fx}
      {/* reflection in the puddle: flipped around the wall base, squashed vertically like the wall shader */}
      <Group clip={PUDDLE_CLIP} opacity={0.6}>
        <Group transform={MIRROR}>{fx}</Group>
      </Group>
    </Group>
  );
}

/** Igniting gas front within one tube segment: sharp stroke (no BlurMask — dynamic trim), off once the real segment strikes. */
const mixWhite = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};
function UnitFront({ u, time, total, lit }: { u: IntroUnit; time: SharedValue<number>; total: number; lit: number }) {
  const end = useDerivedValue(() => {
    const t = time.value;
    if (t <= INTRO_T0 + 0.001) return 0.04; // hold frame: warm up the pipeline (1 % opacity)
    if (t < T_HIT) return 0;
    return clamp01((tubeProg(t) * total - u.a) / Math.max(1, u.b - u.a));
  });
  const op = useDerivedValue(() => {
    const t = time.value;
    if (t <= INTRO_T0 + 0.001) return 0.01;
    if (t < T_HIT || end.value <= 0) return 0;
    return 1 - clamp01((t - lit) / 0.06);
  });
  const hex = NEON[u.color].hex;
  const S = { style: "stroke", strokeCap: "round", strokeJoin: "round" } as const;
  return (
    <Group opacity={op}>
      {/* gas halo: Blur image filter (NOT BlurMask — a mask filter on a dynamically trimmed stroke gets drawn as blocks by Graphite) */}
      <Group blendMode="plus">
        <Path path={u.path} {...S} strokeWidth={u.w * 2.6} color={hex} opacity={0.55} end={end}>
          <Blur blur={6} />
        </Path>
      </Group>
      <Path path={u.path} {...S} strokeWidth={u.w * 0.92} color={mixWhite(hex, 0.12)} end={end} />
      <Path path={u.path} {...S} strokeWidth={u.w * 0.5} color={mixWhite(hex, 0.55)} end={end} />
      <Path path={u.path} {...S} strokeWidth={u.w * 0.2} color={mixWhite(hex, 0.9)} end={end} />
    </Group>
  );
}

/** Cable still hot behind the plasma bead: short segment behind the bead (box side), sharp stroke. Cable path: 0 = electrode, 1 = box. */
function WireGlow({ path, time, total, color }: { path: SkPath; time: SharedValue<number>; total: number; color: string }) {
  // bead position in path parameter (reversed relative to the plan.cab samples)
  const st = useDerivedValue(() => {
    const t = time.value;
    if (t <= INTRO_T0 + 0.001) return [0.5, 0.52, 0.01];
    if (t < T_LAUNCH || t > T_HIT + 0.18) return [0, 0, 0];
    const p = 1 - cabProg(t);
    const op = t <= T_HIT ? 1 : 1 - (t - T_HIT) / 0.18;
    return [p, Math.min(1, p + 90 / Math.max(1, total)), op];
  });
  const start = useDerivedValue(() => st.value[0]);
  const end = useDerivedValue(() => st.value[1]);
  const op = useDerivedValue(() => st.value[2]);
  return (
    <Group opacity={op} blendMode="plus">
      <Path path={path} style="stroke" strokeWidth={2.6} strokeCap="round" color={color} opacity={0.55} start={start} end={end} />
      <Path path={path} style="stroke" strokeWidth={1.1} strokeCap="round" color="white" opacity={0.9} start={start} end={end} />
    </Group>
  );
}

/** Overload: the whole sign flashes white-hot (baked halo tinted with the tube colour + sharp white core). */
function SurgeFlash({ time, geo }: { time: SharedValue<number>; geo: IntroGeo }) {
  const op = useDerivedValue(() => {
    const t = time.value;
    if (t <= INTRO_T0 + 0.001) return 0.01;
    return surgeFlash(t);
  });
  // exposure bloom: mostly the baked halo tinted with the tube colour, the white core only flickers past
  const glowOp = useDerivedValue(() => op.value * 0.8);
  const coreOp = useDerivedValue(() => op.value * 0.4);
  if (!geo.glow) return null;
  const g = geo.glow;
  return (
    <Group blendMode="plus">
      <Image image={g.image} x={g.rect.x} y={g.rect.y} width={g.rect.width} height={g.rect.height} fit="fill" sampling={LINEAR} opacity={glowOp}>
        <BlendColor color={NEON[geo.color].hex} mode="srcIn" />
      </Image>
      <Group opacity={coreOp}>
        {geo.tubes.map((t, i) => (
          <Path key={i} path={t.path} style="stroke" strokeWidth={t.w * 0.45} strokeCap="round" strokeJoin="round" color="white" />
        ))}
      </Group>
    </Group>
  );
}

// ── lens: its only remaining job is warming up the `introLens` pipeline for BeatLens (hold frame) ──
export const TINY = { x: 0, y: 0, width: 1, height: 1 };

type LensProps = { time: SharedValue<number>; plan: SharedValue<IntroPlan>; fit: Fit };

/**
 * Placed LAST in the Canvas (outside Group sceneT): reads back the drawn image (BackdropFilter + RuntimeShader image filter) and
 * warps it. Wrapped in scale(1/PixelRatio) → the filter's coordinate space = device px (Skia doesn't downscale the layer).
 * The clip region sets the cost: hold frame → full screen (warms up pipeline + texture), during the arc → a fixed square around
 * the arc, during a jolt → full screen, otherwise → 1 px.
 */
export function IntroLens(props: LensProps) {
  // mount ONLY during the hold frame (clock not running yet): BackdropFilter, even clipped to 1 px, still forces Graphite to split the render pass every frame
  // (store + reload the whole screen) — mounting it for the whole intro made the sim GPU fall behind, frames arriving later and later then jumping to catch up at t ≈ 0 (v68/v70).
  // The hold frame draws the full screen once → pipeline + texture ready for BeatLens. (The ≤ 2 px colour split at overload was dropped too.)
  const [holding, setHolding] = useState(INTRO_LEN > 0);
  useAnimatedReaction(
    () => props.time.value > INTRO_T0 + 0.001,
    (run, prev) => {
      if (run && !prev) scheduleOnRN(setHolding, false);
    },
  );
  return holding ? <IntroLensOn {...props} /> : null;
}

function IntroLensOn({ time, plan, fit }: LensProps) {
  const pr = PixelRatio.get();
  const W = (VIEW.w * fit.k + 2 * fit.ox) * pr;
  const H = (VIEW.h * fit.k + 2 * fit.oy) * pr;
  const scratch = useSharedValue<number[]>(new Array(8).fill(0));
  const st = useDerivedValue(() => {
    const t = time.value;
    const P = plan.value;
    const amt = 0;
    // v4: no arc any more → no heat haze (shader branch kept so the pipeline is identical to the one BeatLens reuses)
    const heatK = 0;
    let hx = 0, hy = 0, hr = 1;
    if (heatK > 0) {
      const s = scratch.value;
      introCamera(t, P, s, 0);
      const z = s[0], c = Math.cos(s[3]), sn = Math.sin(s[3]);
      const dx = (P.arc[0] + P.arc[2]) / 2 - s[1], dy = P.arc[1] - 6 - s[2];
      // design → frame (intro camera) → screen (fit) → px
      hx = (fit.ox + fit.k * (CX + z * (c * dx - sn * dy))) * pr;
      hy = (fit.oy + fit.k * (CY + z * (sn * dx + c * dy))) * pr;
      hr = 64 * z * fit.k * pr;
    }
    const hold = t <= INTRO_T0 + 0.001;
    let clip = TINY;
    if (hold || amt > 0.002) clip = { x: 0, y: 0, width: W, height: H };
    else if (heatK > 0) {
      const hs = 190 * fit.k * pr; // fixed square (same texture size every frame), big enough for the heat-haze ring at max zoom
      clip = { x: hx - hs, y: hy - hs, width: hs * 2, height: hs * 2 };
    }
    return {
      clip,
      u: {
        box: [Math.max(0, clip.x), Math.max(0, clip.y), Math.min(W, clip.x + clip.width), Math.min(H, clip.y + clip.height)],
        amt,
        seed: Math.floor(t * 60) % 241,
        px: fit.k * pr,
        ctr: [W / 2, H / 2],
        heat: [hx, hy, hr, heatK],
        time: t,
        bands: 0,
      },
    };
  });
  const clip = useDerivedValue(() => st.value.clip);
  const U = useDerivedValue(() => st.value.u);
  return (
    <Group transform={[{ scale: 1 / pr }]}>
      <BackdropFilter clip={clip} filter={<RuntimeShader source={introLens} uniforms={U} />} />
    </Group>
  );
}

/** Marks used for sound design (scene seconds). */
export const INTRO_CUES = { strikes: STRIKE_AT, conduit: T_CONDUIT, box: T_BOX, launch: T_LAUNCH, hit: T_HIT, surge: T_SURGE };
