import type { Pts } from "../draw/stroke";
import { VIEW } from "../scene/layout";

/** Coordinates below are built for a 402 pt wide frame → scaled to the current frame (iPhone 17 Pro Max: 440 pt). */
const Z = VIEW.w / 402;

/**
 * Demo script (EXPO_PUBLIC_DEMO=1), marks = scene clock seconds (starts once the scene images have loaded).
 * Handwritten monoline "hello" and the heart are prebuilt points, played back at human writing speed.
 */

// monoline "hello": origin (0, 0) at the letters' baseline, units ≈ pt before scaling
const HELLO_RAW = [
  [0, 0], [16, -20], [32, -55], [42, -90], [40, -108], [32, -112], [26, -100], [25, -70], [25, -35], [25, 0],
  [28, -26], [38, -39], [50, -38], [56, -25], [57, -8], [62, 0], [70, -3], [80, -12],
  [89, -23], [91, -34], [86, -41], [78, -37], [75, -24], [80, -7], [90, 0], [101, -4],
  [113, -30], [124, -70], [127, -100], [121, -112], [113, -105], [111, -80], [112, -40], [115, -8], [123, 0], [134, -6],
  [147, -30], [158, -70], [161, -100], [155, -112], [147, -105], [145, -80], [146, -40], [149, -8], [157, 0], [168, -7],
  [178, -28], [189, -40], [179, -42], [170, -33], [167, -17], [174, -3], [188, 0], [199, -12], [198, -31], [190, -41],
  [185, -35], [193, -33], [208, -36], [224, -31],
];
/** index of the end point of each letter h | e | l | l | o → flicker segment boundaries */
const LETTER_ENDS = [17, 25, 35, 45];
const HK = 1.45 * Z, HX = 40 * Z, HY = 420 * Z;

const catmull = (p: number[][], seg: number): Pts => {
  const out: Pts = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    for (let k = 0; k < seg; k++) {
      const t = k / seg, t2 = t * t, t3 = t2 * t;
      for (let j = 0; j < 2; j++)
        out.push(0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3));
    }
  }
  const l = p[p.length - 1];
  out.push(l[0], l[1]);
  return out;
};

const plen = (p: number[][], n = p.length) => {
  let l = 0;
  for (let i = 1; i < n; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
};

const helloPts = HELLO_RAW.map(([x, y]) => [HX + x * HK, HY + y * HK]);
const HELLO = catmull(helloPts, 8);
const HELLO_SPLITS = LETTER_ENDS.map((i) => plen(helloPts, i + 1) / plen(helloPts));

const heart = (cx: number, cy: number, s: number): number[][] => {
  const p: number[][] = [];
  for (let i = 0; i <= 72; i++) {
    const t = (Math.PI * 2 * i) / 72;
    p.push([cx + 16 * Math.sin(t) ** 3 * s, cy - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * s]);
  }
  return p;
};
// v80: heart and star +15 % (critic v78: the drawn shapes were small marks at mockup size)
/** v82: slight hand wobble (≤ ~2 pt, low frequency) — perfectly symmetric shapes read as stamped templates (critic v81) */
const wobble = (p: Pts, seed: number): Pts => {
  const out = p.slice();
  const n = out.length / 2;
  for (let i = 0; i < n; i++) {
    const e = Math.sin((Math.PI * i) / (n - 1)); // 0 at both ends: closed shapes still meet at the electrode
    out[i * 2] += (1.3 * Math.sin(i * 0.11 + seed) + 0.7 * Math.sin(i * 0.31 + seed * 2.3)) * Z * e;
    out[i * 2 + 1] += (1.3 * Math.cos(i * 0.09 + seed * 1.7) + 0.7 * Math.sin(i * 0.27 + seed)) * Z * e;
  }
  return out;
};
const HEART = wobble(catmull(heart(222 * Z, 550 * Z, 3.45 * Z), 3), 1.1);
/** swash underline beneath "hello" (signature), the end flicks up — drawn after the cascade switch-on */
const UNDERLINE = catmull(
  [
    // v11: one clean swash (critic v85: the old ±5 pt wiggle read as a cheap squiggle)
    [62, 495], [120, 492], [190, 490], [260, 489], [318, 487], [356, 481], [376, 468],
  ].map(([x, y]) => [x * Z * 0.88 + 22, y - 5]),
  10,
);

/** Monoline five-point star, corners rounded with radius `fr` (bent glass tube, no sharp corners): starts and ends at the bottom notch. */
const star = (cx: number, cy: number, R: number, r: number, fr: number): Pts => {
  const v: number[][] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 === 0 ? R : r;
    v.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  // start at the bottom notch (inner vertex k = 5): electrode sits at the bottom of the star, cable drops straight down
  v.push(...v.splice(0, 5));
  const out: Pts = [];
  const n = v.length;
  // each corner: entry / exit points `fr` from the vertex along both edges, joined by a quadratic Bezier through the vertex; straight edges sampled every ~4 pt
  const corner = (i: number) => {
    const p = v[i], a = v[(i - 1 + n) % n], c = v[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lc = Math.hypot(c[0] - p[0], c[1] - p[1]);
    const ka = Math.min(fr, la * 0.45) / la, kc = Math.min(fr, lc * 0.45) / lc;
    return { i0: [p[0] + (a[0] - p[0]) * ka, p[1] + (a[1] - p[1]) * ka], p, i1: [p[0] + (c[0] - p[0]) * kc, p[1] + (c[1] - p[1]) * kc] };
  };
  const cs = v.map((_, i) => corner(i));
  const push = (x: number, y: number) => out.push(x, y);
  // start at the middle of the top corner (vertex 0), go clockwise, end back there
  const q = (c: { i0: number[]; p: number[]; i1: number[] }, from: number, to: number) => {
    for (let s = from; s <= to; s++) {
      const t = s / 8, u = 1 - t;
      push(u * u * c.i0[0] + 2 * u * t * c.p[0] + t * t * c.i1[0], u * u * c.i0[1] + 2 * u * t * c.p[1] + t * t * c.i1[1]);
    }
  };
  q(cs[0], 4, 8);
  for (let i = 1; i <= n; i++) {
    const a = cs[i - 1].i1, c = cs[i % n];
    const L = Math.hypot(c.i0[0] - a[0], c.i0[1] - a[1]);
    const m = Math.max(1, Math.round(L / 4));
    for (let k = 1; k < m; k++) push(a[0] + ((c.i0[0] - a[0]) * k) / m, a[1] + ((c.i0[1] - a[1]) * k) / m);
    q(c, 0, i === n ? 4 : 8);
  }
  return out;
};
const STAR = wobble(star(120, 560, 46, 19, 5.5), 2.7);

export type DemoStroke = {
  at: number;
  pts: Pts;
  speed: number;
  color: number;
  width: number;
  splits?: number[];
  /** tubes present when the app opens: already frozen, steadily lit (the clip's first frame is the sign already glowing) */
  pre?: boolean;
  /** override the draw start second (blockout linking rule of model.linkTubes) */
  startedAt?: number;
};

/** Flip the switch. `cascade`: on switch-on, tube segments ignite one by one in draw order (h → e → l → l → o → heart → star). */
export type DemoSwitch = { at: number; cascade?: boolean; silent?: boolean };
/** colour change: tap tube `tube`, palette pops up, tap `color`; `quick` = change directly (no finger / palette) */
export type DemoRecolor = { at: number; tube: number; color: number; quick?: boolean };
/** [beat second, word colour, heart colour, star colour, underline colour] → quick change; heart + star half a beat late, underline one beat late */
const disco = (rows: number[][]): DemoRecolor[] =>
  rows.flatMap(([at, h, hr, st, ul]) => [
    { at, tube: 0, color: h, quick: true },
    { at: at + 0.24, tube: 1, color: hr, quick: true },
    { at: at + 0.24, tube: 2, color: st, quick: true },
    { at: at + 0.48, tube: 3, color: ul, quick: true },
  ]);
export type DemoBroken = { at: number; tube: number; unit?: number; kind?: "blink" | "restrike" };
/** Fake device tilt: left → right → back to centre over `len` seconds, amplitude `amp` (0..1). */
export type DemoTilt = { at: number; len: number; amp: number };

/**
 * Showcase script v4 (01/11, ~42 s). First 12.4 s unchanged from v3 (promo beat sheet v12 still matches):
 *   0     first frame: pink "hello" sign lit, rain, reflecting puddle
 *   0.45  finger draws the heart, blockout-linked from the "o" → heart freezes into a tube, ignites by itself
 *   3.3   heart → red · 4.55 word → cyan (gas flowing along the tube)  ·  5.3 device tilt  ·  6.9 the "o" flickers broken
 *   8.6   switch off → 9.75 switch on: shared flash, flicker, burst of light
 * v10: dark opening, at 0.15 s "hello" switches on letter by letter (hook); thunderstorm around the lightning strike.
 * Extension:
 *   13.0  draw the amber star bottom left → star ignites by itself
 *   16.4  word → violet  ·  17.8 heart → pink
 *   19.6  second device tilt (specular streak sliding over every tube)
 *   26.25 lightning flash: the wall appears out of the dark
 *   23.2  the whole star cuts out, sparks flash, re-ignites flickering · 24.35 heart flickers one beat
 *   25.4  switch off: dark alley, afterglow fades · 27.6 cascade switch-on: letters ignite one by one
 *   11.72 light pulse running along the tubes right after DROP 1 (fills the lull)
 *   29.35 draw the swash underline beneath "hello" (lime green) → ignites by itself
 *   31.2  star → cyan (final palette: violet / pink / cyan)
 *   33.6  third slow device tilt → 37.2 light pulse running along each tube → 38.16 "disco": colours change on the beat, colour
 *         wave spreads across word → heart → star (4 passes, settling on violet / pink / cyan) → 40.08 light pulsing on the beat → 42.0 last pulse
 *   42.48 finale: every tube flashes white + sparks + punch → hold the hero frame until 44.0
 */
/**
 * v12 (02/11 night, user: "rushed, the ending is cut short"): +2 beats after the relight (underline 7.6), finale 10.0,
 * 3 s hold on the finished sign (end 13.0) while the music plays an outro.
 * v11 (02/11 night): finale one bar earlier (9.04, end 10.34, card cut 9.52); violet underline as one clean swash;
 * palette held longer.
 * v10 (02/11 evening): underline drawn pink, palette shown once; no finale comets (clean cut frame); heart/star +15 %
 * with a slight hand wobble; beat pulse has a 60 ms attack.
 *
 * Showcase script v8 (02/11 night, 11.3 s + LIVE WIRE intro). Fresh critic on v73 (7.4): the 3.6–6.7 s middle sagged
 * → star drawn in ~0.5 s, drop 0.96 s earlier; underline drawn straight in cyan (pink → cyan read as a glitch).
 * Beat grid 0.48 s anchored at the relight 5.2 (DROP).
 *   0      (after intro) pink "hello" lit
 *   0.25   finger draws the heart (~0.9 s) → it freezes into a tube and ignites
 *   2.35   tap the word → palette → cyan
 *   3.15   draw the amber star (~0.65 s), lit and steady ≥ 0.35 s before the switch-off
 *   4.72   switch off · 4.9 lightning shows the dead tubes · 5.2 switch on as a fast cascade = DROP
 *   6.64   draw the underline (cyan, fast)
 *   8.08   one colour sweep to a NEW set (pink hello, cyan heart, amber star, cyan underline) + beat pulse
 *   9.04   last chase (v10; was 9.52) · 10.0 finale: light swell + core flash (v10: no comets) → cut at 11.3
 */
export const DEMO = {
  strokes: [
    { at: -4, pts: HELLO, speed: 370 * Z, color: 0, width: 7, splits: HELLO_SPLITS, pre: true },
    { at: 0.25, pts: HEART, speed: 680 * Z, color: 0, width: 7, startedAt: -3.6 },
    { at: 3.15, pts: STAR, speed: 640 * Z, color: 2, width: 7, splits: [1 / 3, 2 / 3] },
    { at: 7.6, pts: UNDERLINE, speed: 560 * Z, color: 4, width: 6, splits: [0.5] }, // v11: violet — a 4th colour, not the heart's pink
  ] as DemoStroke[],
  /** first frame after the intro is the lit sign (the intro already ignited it) — no more "restart" 0.12 / 0.3 */
  openDark: false,
  switches: [{ at: 4.72 }, { at: 5.2, cascade: true }] as DemoSwitch[],
  /** thunderstorm around the dark stretch with lightning */
  storm: { from: 4.45, to: 5.85, amount: 2.0 },
  /** alias (switch off/on times) for the old tooling */
  switchOff: 4.72,
  switchOn: 5.2,
  /** colour change: tap a tube (tube) then tap a swatch on the palette that pops up after 0.45 s */
  recolor: [
    { at: 2.35, tube: 0, color: 1 },
    // v82: the underline is drawn pink straight away — the palette appears once (critics v80/v81: twice was repetitive;
    // v77: an automatic sweep had no visible cause). Final set: cyan hello · pink heart · amber star · pink underline
  ] as DemoRecolor[],
  broken: [] as DemoBroken[],
  /** lightning strikes while the alley is dark: wall + dead tubes appear under the flash */
  lightning: [{ at: 4.9 }] as { at: number }[],
  /** light pulse running along each tube (each next tube delayed `stagger` s), `dur` = time to run the full length of one tube */
  chase: [
    { at: 9.04, dur: 0.7, stagger: 0.08 }, // v12: +2 beats of breathing room after the relight (user: the clip felt rushed)
    // v82: no finale comets — the cut frame (10.48) showed white smears on every tube at once (critic v81)
  ] as { at: number; dur: number; stagger: number }[],
  /** light pulsing on the beat before the finale */
  pulse: { from: 9.04, to: 10.0, period: 0.48, amp: 0.3, low: 0.72 },
  tilts: [] as DemoTilt[],
  finale: { at: 10.0 },
  // v12: hold the finished sign 3 s (slow push-in) while the music resolves — the 1.3 s hold ended "abruptly" (user)
  end: 13.0,
};

const ee = (x: number) => {
  "worklet";
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1));
};
const TILTS = DEMO.tilts.map((w) => [w.at, w.len, w.amp]);
/**
 * Fake tilt (the simulator has no gyro): gentle sway, then within each `tilts` window tilt left → right → back to centre.
 * Written into `out` (no per-frame allocation).
 */
export const demoTilt = (t: number, out: number[]) => {
  "worklet";
  const ix = Math.sin(t * 0.9) * 0.16, iy = Math.sin(t * 0.6 + 1) * 0.08;
  out[0] = ix;
  out[1] = iy;
  for (let i = 0; i < TILTS.length; i++) {
    const L = TILTS[i][1];
    const u = (t - TILTS[i][0]) * (2.6 / L); // base phase 2.6 s, stretched by `len`
    if (u < 0 || u > 2.6) continue;
    const x = u < 0.8 ? -ee(u / 0.8) : u < 1.9 ? -1 + 2 * ee((u - 0.8) / 1.1) : 1 - ee((u - 1.9) / 0.7);
    const w = Math.min(1, u / 0.3, (2.6 - u) / 0.3);
    out[0] = ix * (1 - w) + x * TILTS[i][2] * w;
    out[1] = iy * (1 - w) + Math.sin(u * 2.2) * 0.3 * w;
  }
};
