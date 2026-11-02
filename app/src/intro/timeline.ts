import { hash } from "../neon/flicker";
import { SLOTS } from "../neon/model";
import { VIEW } from "../scene/layout";

/**
 * "LIVE WIRE" opener v4 — a 1.4 s hook (negative scene time: t ∈ [−INTRO_LEN, 0], ending EXACTLY on the scene's t = 0 frame).
 *
 *   −1.40  first frame: macro close-up (2.8× zoom, tilted camera) on the grey tube of the "h" and its electrode; a white-pink plasma bead
 *          racing up the cable about to hit the electrode, blooming, lighting the wet bricks around it (run-up from −1.8 → first frame already moving)
 *   −1.20  electrode hit: flash + ray burst + lens streak; plasma enters the tube, pink gas ignites behind the wavefront, each letter
 *          h-e-l-l-o strikes as the wavefront passes (~0.96 s for the whole word), camera eases back to the wide shot
 *   −0.24  overload: exposure bloom from the tubes themselves (baked halo + wall light ×1.8), colour split ≤ 2 px for 3 frames,
 *          fades fast, blends back to the exact scene brightness at t = 0
 * Music at 125 BPM anchored at 27.6 s → −1.20 and −0.24 land on the beat.
 * Transformer box / conduit / arc (the 2.8 s version) now sit outside the clock (placeholder marks before INTRO_T0, never shown).
 *
 * All motion is a pure function of `time` (respects TIMESCALE, scrubbable frame by frame), stateless.
 * EXPO_PUBLIC_INTRO=0 disables it entirely (INTRO_LEN = 0 → every function returns its identity value).
 */
const OFF = process.env.EXPO_PUBLIC_INTRO === "0";
export const INTRO_LEN = OFF ? 0 : 1.4;
/**
 * Pre-roll before −INTRO_LEN (s): the scene clock starts at INTRO_T0 = −(INTRO_LEN + INTRO_PREROLL). The first few frames after the
 * clock starts may hitch (device just leaving the hold frame) → the hitch lands in the pre-roll (the recording cuts at −INTRO_LEN), by then
 * the plasma bead is already running along the cable. In the real app this just adds 0.4 s of plasma running along the cable.
 */
export const INTRO_PREROLL = OFF ? 0 : 0.4;
export const INTRO_T0 = -(INTRO_LEN + INTRO_PREROLL);

/**
 * Marks (scene seconds). Music at 125 BPM anchored at 27.6 s → beats at −1.20 (electrode hit) and −0.24 (overload).
 * T_CONDUIT / T_BOX: placeholders, before INTRO_T0 → the conduit + box "thump" no longer show. T_LAUNCH = when the clock starts.
 */
export const T_CONDUIT = -3.0;
export const T_BOX = -2.8;
export const T_LAUNCH = -1.8;
export const T_HIT = -1.2;
export const T_SURGE = -0.24;
/**
 * Plasma "pools" at the electrode for this many seconds after the hit before running into the tube: the clip's first frame (−1.15) catches the bead
 * right as it hits the electrode, halo at its peak — T_HIT still lands exactly on the −1.20 beat.
 */
export const HIT_POOL = 0.06;
/** plasma bead starts at this fraction of the cable (0 = box, 1 = electrode) — only runs the last stretch, up to the electrode */
export const CAB_FROM = 0.5;
/** remove the intro layer from the draw tree at this time (long finished, avoiding busy scene moments: 0.3 cascade, ~1.9 heart commit) */
export const T_UNMOUNT = 2.4;

/** Design frame centre. */
export const CX = VIEW.w / 2;
export const CY = VIEW.h / 2;
/** No sign (normal mode): the frame opens on the transformer box. */
export const BOX_FOCUS = [321, 636];
/** Frame-centre offset from the head electrode at open (pt): electrode at top-left, plasma bead enters the frame from below. */
/**
 * Macro framing is ANCHORED (does not chase the wavefront): between the head electrode and the top of the "h" loop (H_TOP pt along the
 * tube from the electrode), offset slightly (12, 8). At ~2.65× zoom the whole "h" fits in frame → no need to chase; chasing the wavefront (running
 * ~2000 pt/s up the "h" stroke) shifted the image by up to ~43 pt per frame — harsh, especially in the 30 fps version. Now peaks at ~18 pt/frame.
 */
const H_TOP = 190;
const Z0 = 2.8;

/** Data for the UI thread (numbers only, no SkPath). Sample arrays: x, y spaced STEP pt apart along the path. */
export type IntroPlan = {
  /** 1 = there is a sign to "write" (tubes already exist when the app opens) */
  on: number;
  /** sRGB 0..1 colour of the first tube */
  col: number[];
  /** conduit: drainpipe → box top */
  dct: number[];
  dctLen: number;
  /** cable: box → head electrode */
  cab: number[];
  cabLen: number;
  /** chain of tubes joined end to end in draw order */
  tub: number[];
  tubLen: number;
  /** scene second at which slot k (0..SLOTS−1) strikes; 99 = not part of the intro */
  lit: number[];
  /** head / tail electrode, cable clamp, arc [ax, ay, bx, by] */
  head: number[];
  tail: number[];
  arc: number[];
  /** light ring sweeping the wall: [cx, cy, start second] */
  ring: number[];
  /** prebuilt sparks: SPARK_F numbers per particle */
  sp: number[];
};
export const STEP = 2;
/** fields per particle: birth second, x, y, vx, vy, life, r, g, b, size */
export const SPARK_F = 10;
export const N_SPARK = 320;

export const EMPTY_PLAN: IntroPlan = {
  on: 0,
  col: [1, 0.25, 0.64],
  dct: [0, 0, 0, 0],
  dctLen: 0,
  cab: [0, 0, 0, 0],
  cabLen: 0,
  tub: [0, 0, 0, 0],
  tubLen: 0,
  lit: new Array(SLOTS).fill(99),
  head: [0, 0],
  tail: [0, 0],
  arc: [308.5, 620.4, 333.1, 620.4],
  ring: [BOX_FOCUS[0], BOX_FOCUS[1], T_LAUNCH],
  sp: new Array(N_SPARK * SPARK_F).fill(0),
};

// ── utilities ──
export const clamp01 = (v: number) => {
  "worklet";
  return v < 0 ? 0 : v > 1 ? 1 : v;
};
export const sstep = (a: number, b: number, x: number) => {
  "worklet";
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const smoother = (a: number, b: number, x: number) => {
  "worklet";
  const u = clamp01((x - a) / (b - a));
  return u * u * u * (u * (u * 6 - 15) + 10);
};

/** Point on a sample array (spaced STEP) at length s → out[o], out[o + 1]. */
export const sampleAt = (arr: number[], len: number, s: number, out: number[], o: number) => {
  "worklet";
  const n = arr.length / 2;
  const x = Math.max(0, Math.min(len, s)) / STEP;
  let i = Math.floor(x);
  if (i > n - 2) i = n - 2;
  if (i < 0) i = 0;
  const f = Math.min(1, x - i);
  out[o] = arr[i * 2] + (arr[i * 2 + 2] - arr[i * 2]) * f;
  out[o + 1] = arr[i * 2 + 1] + (arr[i * 2 + 3] - arr[i * 2 + 1]) * f;
};

// ── pulse head / plasma bead ──
/** progress (0..1) of the wavefront in the tube at second t: pools HIT_POOL at the electrode, then near-uniform, slightly slower on entry */
export const tubeProg = (t: number) => {
  "worklet";
  const u = clamp01((t - T_HIT - HIT_POOL) / (T_SURGE - T_HIT - HIT_POOL));
  return u + (u * u * (3 - 2 * u) - u) * 0.3;
};
/** plasma bead progress along the cable (0 = box, 1 = electrode): only the last stretch from CAB_FROM, accelerating */
export const cabProg = (t: number) => {
  "worklet";
  const u = clamp01((t - T_LAUNCH) / (T_HIT - T_LAUNCH));
  return CAB_FROM + (1 - CAB_FROM) * (0.45 * u + 0.55 * u * u);
};
const dctProg = (t: number) => {
  "worklet";
  const u = clamp01((t - T_CONDUIT) / (T_BOX - T_CONDUIT));
  return u * Math.sqrt(u);
};

/**
 * Pulse head at second t → out[o..o+3] = x, y, s (current length along the path), phase (0 hidden · 1 conduit · 2 cable · 3 neon tube).
 * No sign (P.on = 0): phase 1 only.
 */
export const headAt = (t: number, P: IntroPlan, out: number[], o: number) => {
  "worklet";
  let ph = 0;
  let s = 0;
  if (t >= T_CONDUIT && t < T_BOX && P.dctLen > 0) {
    ph = 1;
    s = dctProg(t) * P.dctLen;
    sampleAt(P.dct, P.dctLen, s, out, o);
  } else if (P.on > 0 && t >= T_LAUNCH && t < T_HIT) {
    ph = 2;
    s = cabProg(t) * P.cabLen;
    sampleAt(P.cab, P.cabLen, s, out, o);
  } else if (P.on > 0 && t >= T_HIT && t < T_SURGE) {
    ph = 3;
    s = tubeProg(t) * P.tubLen;
    sampleAt(P.tub, P.tubLen, s, out, o);
  } else {
    out[o] = -1e4;
    out[o + 1] = -1e4;
  }
  out[o + 2] = s;
  out[o + 3] = ph;
};

/** Point along the path of phase `ph` at length s (trail). */
export const pathAt = (P: IntroPlan, ph: number, s: number, out: number[], o: number) => {
  "worklet";
  if (ph === 1) sampleAt(P.dct, P.dctLen, s, out, o);
  else if (ph === 2) sampleAt(P.cab, P.cabLen, s, out, o);
  else sampleAt(P.tub, P.tubLen, s, out, o);
};

/** Pulse head intensity (0..1). */
export const headInt = (t: number) => {
  "worklet";
  if (t < T_CONDUIT || t >= T_SURGE + 0.04) return 0;
  if (t < T_BOX) return 0.55 + 0.45 * clamp01((t - T_CONDUIT) / 0.1);
  if (t < T_LAUNCH) return 0;
  if (t >= T_SURGE) return 1 - (t - T_SURGE) / 0.04;
  return 1;
};

// ── arc + flash ──
/** [start second, duration, peak] per strike; the first one starts before the first frame → the first frame is already striking */
const STRIKES = [
  // v4: no more arc at the transformer box — one placeholder mark (duration 0, before INTRO_T0) for the sound-design tool
  [-9, 0, 0],
];
export const STRIKE_AT = STRIKES.map((s) => s[0]);
/** Arc brightness at the transformer box (0..~1.2), flickering at ~90 Hz scene time. */
export const arcI = (t: number) => {
  "worklet";
  if (t < INTRO_T0 - 0.2 || t > T_LAUNCH + 0.12) return 0;
  let v = 0;
  for (let i = 0; i < STRIKES.length; i++) {
    const d = t - STRIKES[i][0];
    const dur = STRIKES[i][1];
    if (d < 0 || d >= dur) continue;
    const env = Math.min(1, d / 0.012) * (d > dur * 0.7 ? (dur - d) / (dur * 0.3) : 1);
    v = Math.max(v, STRIKES[i][2] * env * (0.6 + 0.4 * hash(Math.floor(t * 90) + i * 7.1)));
  }
  return v;
};
/** Arc light on the wall: like arcI, but between strikes the cable clamp keeps smouldering (bricks never go fully black). */
export const arcLight = (t: number) => {
  "worklet";
  const a = arcI(t);
  if (t >= T_BOX) return a;
  const ember = 0.09 + 0.04 * Math.sin(t * 53) * Math.sin(t * 17.3);
  return a > ember ? a : ember;
};
/** Transformer box flashes (amber) when the pulse from the conduit pours in. */
export const boxFlash = (t: number) => {
  "worklet";
  const d = t - T_BOX;
  if (d < 0 || d > 0.8) return 0;
  return d < 0.02 ? d / 0.02 : Math.exp(-(d - 0.02) / 0.14);
};
/** Flash at the head electrode when the plasma bead hits it. */
export const hitFlash = (t: number) => {
  "worklet";
  const d = t - T_HIT;
  if (d < 0 || d > 0.9) return 0;
  // burst within 20 ms, hold the peak while the plasma pools at the electrode, then decay
  if (d < 0.02) return d / 0.02;
  if (d < HIT_POOL + 0.02) return 1;
  return Math.exp(-(d - HIT_POOL - 0.02) / 0.16);
};
/** Electrode halo "breathes": slight flicker + swell over scene time (deterministic). → [brightness, size] multipliers. */
export const breathe = (t: number) => {
  "worklet";
  // slow waves only (period ≥ 130 ms): no per-frame noise
  return 1 + 0.1 * Math.sin(t * 31) + 0.06 * Math.sin(t * 47 + 1.7);
};
export const breatheSize = (t: number) => {
  "worklet";
  return 1 + 0.05 * Math.sin(t * 19 + 0.6);
};
/** Overload at the tail electrode when the wavefront reaches the end of the sign. */
export const surgeFlash = (t: number) => {
  "worklet";
  const d = t - T_SURGE;
  if (d < 0 || d > 1) return 0;
  return d < 0.025 ? d / 0.025 : Math.exp(-(d - 0.025) / 0.09);
};
/**
 * How much of the scene rain (scene/rain.ts) shows (0..1) given the intro camera zoom: rain streaks are drawn in world coords, so in the
 * macro close-up (~2.9× zoom) they turn into big smears — hide them, bring them back as the camera pulls out (the intro rain layer, drawn at screen scale, stands in).
 */
export const introRainK = (t: number, P: IntroPlan) => {
  "worklet";
  if (t >= 0) return 1;
  return P.on > 0 ? sstep(-0.75, -0.35, t) : sstep(T_HIT, -0.4, t);
};
/** Dark overlay on the scene (0..1, black layer opacity): opens up as the sign gets written. */
export const darkOp = (t: number) => {
  "worklet";
  if (t >= 0) return 0;
  return 0.3 * (1 - sstep(T_HIT - 0.1, T_SURGE - 0.2, t));
};
/** Light ring sweeping the wall: [radius pt, intensity]. */
export const ringR = (t: number, at: number) => {
  "worklet";
  const d = t - at;
  return d < 0 || d > 1.1 ? 0 : 30 + d * 820;
};
export const ringI = (t: number, at: number) => {
  "worklet";
  const d = t - at;
  if (d < 0 || d > 1.1) return 0;
  return Math.min(1, d / 0.04) * Math.exp(-d / 0.32);
};

// ── per-slot brightness (called in NeonScene's frame worklet) ──
/**
 * A letter strikes as the wavefront passes: flash — dip — flash — catches for good with overshoot. d = seconds since strike.
 * EACH beat ≥ 70 ms (≥ 4 frames at 60 fps): shorter beats toggle bright/dark every frame → the 30 fps / X-compressed version looks like an encoding glitch.
 */
export const letterOn = (d: number) => {
  "worklet";
  // v71: the deep dip (0.85 → 0.2) on the "h" in macro close-up shifted the whole frame by ±6–8 luma → now each step ≤ ~0.25
  // (≈ ±2–3 luma at macro zoom): ramp up over 70 ms, slight dip, catch again, warm up to full brightness
  if (d < 0) return 0;
  if (d < 0.07) return 0.6 * (d / 0.07);
  if (d < 0.14) return 0.6;
  if (d < 0.21) return 0.42;
  if (d < 0.28) return 0.66;
  if (d < 0.42) return 0.66 + ((d - 0.28) / 0.14) * 0.38;
  return 1 + 0.04 * Math.exp(-(d - 0.42) / 0.12);
};
const surgeK = (t: number) => {
  "worklet";
  return 1 + 0.8 * surgeFlash(t);
};
/**
 * Brightness of slot k at second t (replaces the scene-computed `v`). Outside the intro (t ≥ 0, or slot not in the intro) returns `v` as is;
 * the last 0.12 s blend back to `v` → the t = 0 frame matches the scene exactly. Floor of 0.006 so the tube glow-layer pipeline is compiled
 * from the first frame (Skia skips draw calls at opacity 0).
 */
export const introBright = (t: number, P: IntroPlan, k: number, v: number) => {
  "worklet";
  if (t >= 0 || P.on === 0) return v;
  const la = P.lit[k];
  if (la === undefined || la > 50) return v;
  // letter striking right at the overload: catch immediately, no dip (a dip while the bloom is fading = an annoying stray flash)
  const d = t - la;
  let x = la + 0.14 > T_SURGE - 1e-3 ? (d < 0 ? 0 : d < 0.07 ? 0.6 * (d / 0.07) : Math.min(1, 0.6 + ((d - 0.07) / 0.14) * 0.4)) : letterOn(d);
  if (t >= T_SURGE) x *= surgeK(t);
  if (x < 0.006) x = 0.006;
  const w = sstep(-0.12, 0, t);
  return x + (v - x) * w;
};

/**
 * Brightness of slot k for WALL LIGHT / steam / rain (not the tube itself) during the intro: drops letterOn's dips,
 * each letter catches smoothly over 0.3 s → the wall doesn't "pump" bright/dark with every strike beat (v70: mean luma 31→49→31→45);
 * tubes + near halo still flicker via `introBright`. `bk` = the slot's introBright value (blend target as t → 0).
 */
export const introWallBright = (t: number, P: IntroPlan, k: number, bk: number) => {
  "worklet";
  if (t >= 0 || P.on === 0) return bk;
  const la = P.lit[k];
  if (la === undefined || la > 50) return bk;
  let x = sstep(la - 0.02, la + 0.3, t);
  if (t >= T_SURGE) x *= surgeK(t);
  if (x < 0.006) x = 0.006;
  const w = sstep(-0.12, 0, t);
  return x + (bk - x) * w;
};

// ── camera ──
/** Camera at second t → s[o..o+3] = zoom, look-at x, y (design pt), tilt (rad). Uses s[o+4..o+7] as scratch. */
export const introCamera = (t: number, P: IntroPlan, s: number[], o = 0) => {
  "worklet";
  let ax = BOX_FOCUS[0], ay = BOX_FOCUS[1];
  let z = 1.6;
  let rot = 0;
  let e = 0;
  if (P.on > 0) {
    // macro: fixed framing that holds the whole "h" (electrode below, top of the loop above)
    sampleAt(P.tub, P.tubLen, H_TOP, s, o + 4);
    ax = (P.head[0] + s[o + 4]) / 2 + 12;
    ay = (P.head[1] + s[o + 5]) / 2 + 8;
    // pull back to the wide shot right after the electrode hit, done before the overload — smoothstep (peak velocity 1.5× mean, lower than
    // smootherstep's 1.875×): same distance, less change per frame
    e = sstep(T_HIT - 0.1, T_SURGE + 0.06, t);
    z = Z0 + 0.12 * sstep(INTRO_T0, T_HIT, t);
    rot = -0.055 + 0.03 * sstep(T_LAUNCH, T_HIT, t);
  } else {
    e = smoother(T_HIT - 0.1, -0.2, t);
  }
  z = z + (1 - z) * e;
  rot *= 1 - e;
  let px = ax + (CX - ax) * e;
  let py = ay + (CY - ay) * e;
  // electrode hit: slight push-in; overload: a tiny push pulse (no shake)
  const dh = t - T_HIT;
  if (P.on > 0 && dh >= 0 && dh < 0.5) z *= 1 + 0.03 * Math.exp(-dh / 0.08);
  const ds = t - T_SURGE;
  if (P.on > 0 && ds >= 0 && ds < 0.3) z *= 1 + 0.012 * Math.exp(-ds / 0.07);
  // settle exactly to identity before t = 0
  const w = sstep(-0.14, -0.02, t);
  z = z + (1 - z) * w;
  rot *= 1 - w;
  px = px + (CX - px) * w;
  py = py + (CY - py) * w;
  if (z < 1) z = 1;
  // never reveal the design frame's edges (tilt included)
  const c = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
  const hw = (CX * c + CY * sn) / z, hh = (CX * sn + CY * c) / z;
  px = hw >= CX ? CX : Math.max(hw, Math.min(VIEW.w - hw, px));
  py = hh >= CY ? CY : Math.max(hh, Math.min(VIEW.h - hh, py));
  s[o] = z;
  s[o + 1] = px;
  s[o + 2] = py;
  s[o + 3] = rot;
};
