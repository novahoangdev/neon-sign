import raw from "../../assets/scene/layout.json";

/**
 * Scene layout exported by Blender (render_passes.py), in pt on the 440×956 design frame (iPhone 17 Pro Max).
 * All layers draw inside a Group already scaled "cover" to this frame, so shader coordinates are design pt too.
 */
export const VIEW = { w: raw.view[0], h: raw.view[1] };
/** y (pt) of the wall foot: the flip axis for puddle reflections. */
export const HORIZON = raw.horizon;
/** Reflection squashed vertically so a small puddle still shows the sign: y_wall = H − (y − H)·REFL_K. */
export const REFL_K = raw.reflK;
export const M_PER_PT = raw.mPerPt;
/** Drawable wall area: x0, y0, x1, y1. */
export const DRAW = { x0: raw.draw[0], y0: raw.draw[1], x1: raw.draw[2], y1: raw.draw[3] };
export const TRANSFORMER = raw.transformer;
/** puddle bounding box (pt): x0, y0, x1, y1 */
export const PUDDLE = raw.puddle as number[];

export type Fit = { k: number; ox: number; oy: number };

const PUD_BOTTOM = (raw.puddle as number[])[3];
/**
 * Scale the design frame to "cover" the canvas, zoomed in further (camera push-in) to cut dead space: art director v60 — above
 * y ≈ 230 pt is just dark brick + posters, below the puddle is black asphalt, ~35 % of the screen does nothing. Zoom 1.13 (headroom for
 * parallax), puddle bottom edge anchored at 92.4 % of screen height (the top gets cropped), design-frame edges never exposed.
 */
export const fitView = (w: number, h: number, margin = 1.0): Fit => { // v81: 1.02 → 1.0, "hello" tail almost touched the right edge (critics v77, v80)
  "worklet";
  const k = Math.max(w / VIEW.w, h / VIEW.h) * margin || 1;
  const oy = Math.min(0, Math.max(h - VIEW.h * k, h * 0.924 - PUD_BOTTOM * k));
  return { k, ox: (w - VIEW.w * k) / 2, oy };
};
