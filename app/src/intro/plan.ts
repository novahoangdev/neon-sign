import { BlurStyle, PaintStyle, Skia, StrokeCap, StrokeJoin, type SkImage, type SkPath, type SkRect } from "react-native-skia";
import { SLOTS, type Tube } from "../neon/model";
import { headWire } from "../neon/Decor";
import { NEON_RGB } from "../neon/palette";
import { TRANSFORMER } from "../scene/layout";
import {
  BOX_FOCUS,
  EMPTY_PLAN,
  N_SPARK,
  SPARK_F,
  STEP,
  T_HIT,
  HIT_POOL,
  T_LAUNCH,
  T_SURGE,
  headAt,
  tubeProg,
  type IntroPlan,
} from "./timeline";

/**
 * Builds the intro data (JS thread, ONCE when the scene opens): samples the pulse path (conduit → cable → neon tube),
 * the strike second of each slot, prebuilt sparks (pure function of scene time, no per-frame simulation), a baked halo image for
 * the overload flash. SkPath / image parts stay on the JS thread (IntroGeo), numeric parts go to the UI thread (IntroPlan).
 */

/** Conduit in the background image (albedo px / 3): from the drainpipe edge, left horizontally, rounded corner, straight down to the box top. */
const DUCT = (() => {
  const pb = Skia.PathBuilder.Make();
  pb.moveTo(408, 513.6);
  pb.lineTo(330, 513.6);
  pb.quadTo(319.5, 513.6, 319.5, 524);
  pb.lineTo(319.5, 589.5);
  return pb.build();
})();

const sample = (path: SkPath, reverse = false): { pts: number[]; len: number } => {
  const cm = Skia.ContourMeasureIter(path, false, 1).next();
  if (!cm) return { pts: [0, 0, 0, 0], len: 0 };
  const len = cm.length();
  const n = Math.max(2, Math.floor(len / STEP) + 2);
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.min(len, i * STEP);
    const [p] = cm.getPosTan(reverse ? len - s : s);
    pts.push(p.x, p.y);
  }
  return { pts, len };
};

// ── cable: uses exactly the Decor.tsx function (new cable bundle) so the plasma bead follows the drawn cable ──

/** time grid (s) for each letter's strike beats — matches the length of one letterOn beat */
const LIT_GRID = 0.07;

// ── prebuilt sparks ──
const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Emit = {
  n: number;
  /** birth-second range */
  t0: number;
  t1: number;
  at: (tb: number, r: () => number) => [number, number];
  dir: number;
  spread: number;
  v: [number, number];
  life: [number, number];
  rgb: number[];
  size: number;
};

const buildSparks = (emits: Emit[]): number[] => {
  const sp = new Array(N_SPARK * SPARK_F).fill(0);
  const r = rng(7331);
  let i = 0;
  for (const e of emits) {
    for (let k = 0; k < e.n && i < N_SPARK; k++, i++) {
      const tb = e.t0 + (e.t1 - e.t0) * (e.n > 1 ? k / (e.n - 1) : 0) + (r() - 0.5) * 0.01;
      const [x, y] = e.at(tb, r);
      const a = e.dir + (r() - 0.5) * e.spread;
      const v = e.v[0] + (e.v[1] - e.v[0]) * r();
      // random white-hot core, coloured tail (as in Sparks.tsx)
      const w = 0.3 + r() * 0.45;
      const o = i * SPARK_F;
      sp[o] = tb;
      sp[o + 1] = x;
      sp[o + 2] = y;
      sp[o + 3] = Math.cos(a) * v;
      sp[o + 4] = Math.sin(a) * v;
      sp[o + 5] = e.life[0] + (e.life[1] - e.life[0]) * r();
      sp[o + 6] = e.rgb[0] + (1 - e.rgb[0]) * w;
      sp[o + 7] = e.rgb[1] + (1 - e.rgb[1]) * w;
      sp[o + 8] = e.rgb[2] + (1 - e.rgb[2]) * w;
      sp[o + 9] = e.size * (0.6 + r() * 0.8);
    }
  }
  // leftover slots: life 0 (hidden)
  for (; i < N_SPARK; i++) sp[i * SPARK_F] = 99;
  return sp;
};

// ── baked halo for the overload flash ──
export type Baked = { image: SkImage; rect: SkRect };
const bakeGlow = (tubes: Tube[]): Baked | null => {
  if (!tubes.length) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const t of tubes) {
    const b = t.path.computeTightBounds();
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  const pad = 48, k = 0.5;
  const rect = Skia.XYWHRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2);
  const s = Skia.Surface.MakeRaster(Math.ceil(rect.width * k), Math.ceil(rect.height * k))!;
  const c = s.getCanvas();
  c.clear(Skia.Color("transparent"));
  c.scale(k, k);
  c.translate(-rect.x, -rect.y);
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeCap(StrokeCap.Round);
  p.setStrokeJoin(StrokeJoin.Round);
  p.setColor(Skia.Color("white"));
  for (const t of tubes) {
    p.setStrokeWidth(t.width * 3);
    p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 14, true));
    p.setAlphaf(0.55);
    c.drawPath(t.path, p);
    p.setStrokeWidth(t.width * 1.4);
    p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 5, true));
    p.setAlphaf(0.8);
    c.drawPath(t.path, p);
  }
  return { image: s.makeImageSnapshot(), rect };
};

/** One tube segment (lit slot) for the "gas igniting behind the wavefront" layer. a, b: position along the tube chain (pt). */
export type IntroUnit = { path: SkPath; k: number; a: number; b: number; w: number; color: number };
export type IntroGeo = {
  plan: IntroPlan;
  units: IntroUnit[];
  tubes: { path: SkPath; w: number; color: number }[];
  wire: SkPath | null;
  glow: Baked | null;
  color: number;
};

export const buildIntro = (tubes: Tube[]): IntroGeo => {
  const duct = sample(DUCT);
  const plan: IntroPlan = { ...EMPTY_PLAN, dct: duct.pts, dctLen: duct.len, lit: new Array(SLOTS).fill(99) };
  const wire = tubes.length ? headWire(tubes) : null;
  const color = tubes[0]?.color ?? 0;
  const rgb = NEON_RGB[color];
  const units: IntroUnit[] = [];
  if (wire && tubes.length) {
    const cab = sample(wire.path, true);
    plan.cab = cab.pts;
    plan.cabLen = cab.len;
    // tube chain: join each tube's samples in draw order
    const tub: number[] = [];
    let off = 0;
    for (const t of tubes) {
      const m = sample(t.path);
      for (let i = tub.length ? 2 : 0; i < m.pts.length; i += 2) tub.push(m.pts[i], m.pts[i + 1]);
      for (const u of t.units) units.push({ path: u.path, k: u.k, a: off + u.a, b: off + u.b, w: t.width, color: t.color });
      off += m.len;
    }
    // joined samples may be off by STEP at tube joints — normalise length by sample count
    plan.tub = tub;
    plan.tubLen = (tub.length / 2 - 1) * STEP;
    const kL = plan.tubLen / Math.max(1, off);
    for (const u of units) {
      u.a *= kL;
      u.b *= kL;
    }
    plan.on = 1;
    plan.col = rgb;
    const t0 = tubes[0], tl = tubes[tubes.length - 1];
    plan.head = [t0.head.x, t0.head.y];
    plan.tail = [tl.tail.x, tl.tail.y];
    const g = wire.glands;
    plan.arc = g.length >= 4 ? [g[0], g[1], g[2], g[3]] : [g[0] - 12, g[1], g[0] + 12, g[1]];
    // strike second: when the wavefront passes 80 % of the slot (inverts tubeProg by bisection)
    for (const u of units) {
      const target = (u.a + (u.b - u.a) * 0.8) / plan.tubLen;
      let lo = 0, hi = 1;
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2;
        if (tubeProg(T_HIT + mid * (T_SURGE - T_HIT)) < target) lo = mid;
        else hi = mid;
      }
      // snap every flicker beat onto ONE shared 70 ms grid anchored at T_SURGE (rounded earlier): beats of different letters
      // don't interleave 1–2 frames apart → whole-frame brightness never reverses faster than 70 ms (the 30 fps version doesn't look like a compression glitch)
      const raw = T_HIT + hi * (T_SURGE - T_HIT);
      plan.lit[u.k] = T_SURGE - Math.ceil((T_SURGE - raw) / LIT_GRID - 1e-6) * LIT_GRID;
    }
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (const t of tubes)
      for (let i = 0; i < t.pts.length; i += 2) {
        bx0 = Math.min(bx0, t.pts[i]);
        bx1 = Math.max(bx1, t.pts[i]);
        by0 = Math.min(by0, t.pts[i + 1]);
        by1 = Math.max(by1, t.pts[i + 1]);
      }
    // v4: no light ring sweeping the wall when there is a sign (the climax = bloom from the tubes themselves)
    plan.ring = [(bx0 + bx1) / 2, (by0 + by1) / 2, 99];
  } else {
    const [bx0, , bx1, by1] = TRANSFORMER;
    plan.arc = [bx0 + (bx1 - bx0) * 0.22, by1 - 1, bx0 + (bx1 - bx0) * 0.78, by1 - 1];
    plan.ring = [BOX_FOCUS[0], BOX_FOCUS[1] + 10, T_HIT];
  }

  // sparks: spawn position follows the pulse head at that moment
  const arc = plan.arc;
  const tmp = [0, 0, 0, 0];
  const atHead = (tb: number): [number, number] => {
    headAt(tb, plan, tmp, 0);
    return [tmp[0], tmp[1]];
  };
  const fixed = (x: number, y: number) => (): [number, number] => [x, y];
  const AMBER = [1, 0.74, 0.38];
  // smaller sparks while the camera is still close (zoom ~2.8×: a 1.0 spark looks like a thick grey stick)
  const emits: Emit[] = [];
  if (plan.on > 0) {
    emits.push(
      // plasma bead on the cable: drops sparks along the way (spawned from when the clock starts → the first frame already has sparks in flight)
      { n: 44, t0: T_LAUNCH + 0.01, t1: T_HIT - 0.08, at: atHead, dir: -Math.PI / 2, spread: 4.5, v: [40, 170], life: [0.2, 0.45], rgb, size: 0.45 },
      // electrode hit: NO radial spark burst (turns the first frame into a star) — only a few small sparks flying up as the plasma leaves
      // the electrode; the round halo at the electrode is the main thing
      { n: 10, t0: T_HIT + HIT_POOL + 0.03, t1: T_HIT + HIT_POOL + 0.08, at: fixed(plan.head[0], plan.head[1]), dir: -Math.PI / 2, spread: 2.4, v: [60, 220], life: [0.25, 0.55], rgb, size: 0.4 },
      // wavefront in the tube
      { n: 80, t0: T_HIT + HIT_POOL + 0.03, t1: T_SURGE - 0.02, at: atHead, dir: -Math.PI / 2, spread: 5, v: [30, 150], life: [0.16, 0.36], rgb, size: 0.6 },
      // overload: both ends of the sign (moderate — the climax is the bloom, not fireworks)
      { n: 18, t0: T_SURGE, t1: T_SURGE + 0.04, at: fixed(plan.tail[0], plan.tail[1]), dir: -Math.PI / 2, spread: 3.4, v: [120, 360], life: [0.3, 0.7], rgb, size: 0.85 },
      { n: 10, t0: T_SURGE + 0.01, t1: T_SURGE + 0.05, at: fixed(plan.head[0], plan.head[1]), dir: -Math.PI / 2, spread: 3.4, v: [100, 300], life: [0.3, 0.6], rgb, size: 0.8 },
    );
  } else {
    // no sign: the transformer box releases an amber burst right as the light ring sweeps out
    emits.push({ n: 20, t0: T_HIT, t1: T_HIT + 0.05, at: (_, r) => [arc[0] + (arc[2] - arc[0]) * r(), arc[1]], dir: Math.PI / 2, spread: 3.4, v: [140, 420], life: [0.4, 0.9], rgb: AMBER, size: 0.7 });
  }
  plan.sp = buildSparks(emits);
  return {
    plan,
    units,
    tubes: tubes.map((t) => ({ path: t.path, w: t.width, color: t.color })),
    wire: wire ? wire.path : null,
    glow: bakeGlow(tubes),
    color,
  };
};

/** Strike second of each slot (for sound design): [k, second]. */
export const litTimes = (g: IntroGeo) => g.units.map((u) => [u.k, g.plan.lit[u.k]] as const);
