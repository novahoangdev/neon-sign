import { Skia, type SkContourMeasure, type SkPath } from "react-native-skia";
import { catmullPath, relax, thin, type Pts } from "../draw/stroke";
import { TRANSFORMER } from "../scene/layout";

/** Number of independently flickering "slots" (each slot = one tube segment). Paired with the 4 tile × RGB light atlas. */
// v88: 15 (5 atlas tiles). With 12, hello 5 + heart + star 3 + underline 2 wrapped around: a star unit shared a slot
// with a pink unit → a pink star piece glowed in the puddle before the star was lit (critics v80, v86)
export const SLOTS = 15;

export type Unit = { k: number; a: number; b: number; path: SkPath };
/** Point on a tube: coordinates, tangent angle (rad, screen y down), position along the tube (pt). */
export type Mark = { x: number; y: number; ang: number; s: number };
export type Tube = {
  id: number;
  pts: Pts;
  path: SkPath;
  len: number;
  width: number;
  color: number; // current NEON index
  prev: number; // colour before the change (gas flowing along the tube)
  flowAt: number; // seconds (scene clock) when the colour change started, −1 = none
  /** time for the gas to flow through the whole tube for this colour change (s): FLOW_DUR on a tap colour change, shorter on beat-driven changes */
  flowDur: number;
  born: number; // seconds when the finger lifted (tube "freezes")
  units: Unit[];
  clips: Mark[]; // tube clips, ~every CLIP_GAP pt
  head: Mark; // tube start (electrode unless joined by a blockout from the previous tube)
  tail: Mark; // tube end
  startedAt: number; // seconds when the stroke started
  link: SkPath | null; // blockout segment (black-painted tube) joining the previous tube's end to this tube's start
  linkClips: Mark[];
};

/** Clip spacing along the tube (pt) and the blockout joining rule (PLAN section 3). */
export const CLIP_GAP = 90;
export const LINK_GAP_S = 1.2;

let nextId = 1;
let nextSlot = 0;
export const resetSlots = () => {
  nextSlot = 0;
};

/**
 * Stroke → neon tube: drop near-duplicate points, smooth, Catmull-Rom spline, split into independently flickering segments.
 * `splits`: length fractions to cut at (e.g. letter boundaries in the demo); default ~170 pt per segment.
 */
const clipsAlong = (cm: SkContourMeasure, len: number, gap = CLIP_GAP, margin = 16): Mark[] => {
  if (len < margin * 2) return [];
  const n = Math.max(1, Math.round((len - margin * 2) / gap) + 1);
  const out: Mark[] = [];
  for (let i = 0; i < n; i++) {
    const s = n === 1 ? len / 2 : margin + ((len - margin * 2) * i) / (n - 1);
    out.push(markAt(cm, s));
  }
  return out;
};
const markAt = (cm: SkContourMeasure, s: number): Mark => {
  const [p, t] = cm.getPosTan(s);
  return { x: p.x, y: p.y, ang: Math.atan2(t.y, t.x), s };
};

export const makeTube = (
  raw: Pts,
  color: number,
  width: number,
  born: number,
  splits?: number[],
  exact = false,
  startedAt = born,
): Tube | null => {
  const pts = exact ? raw : relax(thin(raw, 3.5), 2);
  if (pts.length < 4) return null;
  const path = catmullPath(pts);
  const it = Skia.ContourMeasureIter(path, false, 1);
  const cm = it.next();
  if (!cm) return null;
  const len = cm.length();
  if (len < 14) return null;
  let cuts = splits;
  if (!cuts) {
    const n = Math.max(1, Math.min(5, Math.round(len / 170)));
    cuts = Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
  }
  const edges = [0, ...cuts.map((c) => c * len), len];
  const units: Unit[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i], b = edges[i + 1];
    units.push({ k: nextSlot++ % SLOTS, a, b, path: cm.getSegment(a, b, true) });
  }
  return {
    id: nextId++,
    pts,
    path,
    len,
    width,
    color,
    prev: color,
    flowAt: -1,
    flowDur: FLOW_DUR,
    born,
    units,
    clips: clipsAlong(cm, len),
    head: markAt(cm, 0),
    tail: markAt(cm, len),
    startedAt,
    link: null,
    linkClips: [],
  };
};

/**
 * A new stroke starting < LINK_GAP_S seconds after lifting from the previous one, in the same colour → joined by a blockout: a softly
 * curved tube piece from the previous tube's end (along its tangent) to the new tube's start, painted black, as a real sign is one continuous tube.
 */
export const linkTubes = (prev: Tube | undefined, next: Tube): Tube => {
  // closed shapes (heart, star) have their own wall pass-through at the lowest point → no blockout in / out (the black segment
  // used to dive into the heart's top notch, cutting across the heart)
  if (!prev || closedTube(prev) || closedTube(next)) return next;
  if (prev.color !== next.color || next.startedAt - prev.born > LINK_GAP_S) return next;
  const a = prev.tail, b = next.head;
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 3) return next;
  const k = Math.min(70, Math.max(10, d * 0.38));
  const pb = Skia.PathBuilder.Make();
  pb.moveTo(a.x, a.y);
  pb.cubicTo(a.x + Math.cos(a.ang) * k, a.y + Math.sin(a.ang) * k, b.x - Math.cos(b.ang) * k, b.y - Math.sin(b.ang) * k, b.x, b.y);
  const link = pb.build();
  const cm = Skia.ContourMeasureIter(link, false, 1).next();
  const linkClips = cm && cm.length() > 70 ? clipsAlong(cm, cm.length(), CLIP_GAP * 1.2, 26) : [];
  return { ...next, link, linkClips };
};

/** Closed shape: the tube's start and end meet (heart, star drawn in one stroke). */
export const closedTube = (t: Tube) => Math.hypot(t.head.x - t.tail.x, t.head.y - t.tail.y) < Math.max(4, t.width * 1.5);

/** x (pt) the cable heads toward (middle of the transformer box): between two equally low points, pick the one nearer the box. */
const BOX_X = (TRANSFORMER[0] + TRANSFORMER[2]) / 2;

/**
 * Wall pass-through of a closed shape: the lowest point along the tube (the heart's bottom tip, the star's bottom tip nearest the box).
 * Computed on polyline `pts` (Catmull-Rom passes exactly through these), cumulative length normalised to `len` like the tube segments.
 */
const feedPoint = (t: Tube): Mark => {
  const p = t.pts;
  const n = p.length / 2;
  let best = 0, score = -1e9;
  for (let i = 0; i < n; i++) {
    const v = p[i * 2 + 1] - Math.abs(p[i * 2] - BOX_X) * 0.01;
    if (v > score) {
      score = v;
      best = i;
    }
  }
  let cum = 0, at = 0;
  for (let i = 1; i < n; i++) {
    cum += Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
    if (i === best) at = cum;
  }
  const a = Math.max(0, best - 1), b = Math.min(n - 1, best + 1);
  return { x: p[best * 2], y: p[best * 2 + 1], ang: Math.atan2(p[b * 2 + 1] - p[a * 2 + 1], p[b * 2] - p[a * 2]), s: cum > 0 ? (at / cum) * t.len : 0 };
};

/**
 * Electrodes of each tube run: at the start unless it receives a blockout, at the end unless the next tube joins it. For closed shapes
 * both ends move to the wall pass-through at the lowest point (`feed`): the tube loops past, the electrode hides behind the tube, the cable drops
 * straight down — no more black electrode caps in the middle of the shape (the heart's top notch, the star's bottom notch).
 */
export const electrodes = (tubes: Tube[]) =>
  tubes.flatMap((t, i) => {
    const out: { m: Mark; tube: number; end: boolean; feed: boolean }[] = [];
    const feed = closedTube(t) ? feedPoint(t) : null;
    if (!t.link) out.push({ m: feed ?? t.head, tube: i, end: false, feed: !!feed });
    if (!tubes[i + 1]?.link) out.push({ m: feed ?? t.tail, tube: i, end: true, feed: !!feed });
    return out;
  });

/** Compact data for the UI thread (worklets don't hold SkPath). */
export type SlotInfo = { k: number; tube: number; a: number; b: number; born: number }[];
export type FlowInfo = { from: number; to: number; at: number; len: number; dur: number }[];

export const slotInfo = (tubes: Tube[]): SlotInfo =>
  tubes.flatMap((t, ti) => t.units.map((u) => ({ k: u.k, tube: ti, a: u.a, b: u.b, born: t.born })));
export const flowInfo = (tubes: Tube[]): FlowInfo => tubes.map((t) => ({ from: t.prev, to: t.color, at: t.flowAt, len: t.len, dur: t.flowDur }));

/** Time for the neon gas to flow the full tube length on a colour change (s). */
export const FLOW_DUR = 0.6;
