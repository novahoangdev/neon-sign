import { Skia, type SkPath } from "react-native-skia";

/** Flat point list [x0, y0, x1, y1, …] (design pt). */
export type Pts = number[];

/** Drop points that are too close together (< minD pt) — keeps the last point. */
export const thin = (p: Pts, minD = 4): Pts => {
  "worklet";
  if (p.length < 4) return p.slice();
  const out = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const lx = out[out.length - 2], ly = out[out.length - 1];
    if (Math.hypot(p[i] - lx, p[i + 1] - ly) >= minD) out.push(p[i], p[i + 1]);
  }
  const n = p.length;
  if (out[out.length - 2] !== p[n - 2] || out[out.length - 1] !== p[n - 1]) out.push(p[n - 2], p[n - 1]);
  return out;
};

/** Light smoothing (3-point moving average, endpoints kept), repeated `iters` times: reduces hand jitter. */
export const relax = (p: Pts, iters = 2): Pts => {
  "worklet";
  let a = p.slice();
  const n = a.length / 2;
  for (let it = 0; it < iters; it++) {
    const b = a.slice();
    for (let i = 1; i < n - 1; i++) {
      b[i * 2] = (a[i * 2 - 2] + 2 * a[i * 2] + a[i * 2 + 2]) / 4;
      b[i * 2 + 1] = (a[i * 2 - 1] + 2 * a[i * 2 + 1] + a[i * 2 + 3]) / 4;
    }
    a = b;
  }
  return a;
};

/** Catmull-Rom spline through the points → cubic Bezier. */
export const catmullPath = (p: Pts): SkPath => {
  "worklet";
  const b = Skia.PathBuilder.Make();
  const n = p.length / 2;
  if (n < 1) return b.build();
  b.moveTo(p[0], p[1]);
  if (n === 1) {
    b.lineTo(p[0] + 0.01, p[1]);
    return b.build();
  }
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1), i3 = Math.min(n - 1, i + 2);
    const x0 = p[i0 * 2], y0 = p[i0 * 2 + 1];
    const x1 = p[i * 2], y1 = p[i * 2 + 1];
    const x2 = p[i * 2 + 2], y2 = p[i * 2 + 3];
    const x3 = p[i3 * 2], y3 = p[i3 * 2 + 1];
    b.cubicTo(x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6, x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6, x2, y2);
  }
  return b.build();
};

export const polyLength = (p: Pts) => {
  "worklet";
  let l = 0;
  for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return l;
};

/** Minimum distance from (x, y) to the polyline. */
export const distToPoly = (p: Pts, x: number, y: number) => {
  "worklet";
  let best = 1e9;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + dx * u - x, ay + dy * u - y));
  }
  return best;
};
