import { BlendMode, BlurStyle, ClipOp, PaintStyle, Skia, StrokeCap, StrokeJoin, type SkImage } from "react-native-skia";
import { VIEW } from "../scene/layout";
import { SLOTS, type Tube } from "./model";

/**
 * Light image of all tubes, split by flicker slot so the shader can multiply by each slot's brightness / colour every frame:
 * 4 tiles side by side, each tile has 3 channels R/G/B = 3 slots (slot k → tile ⌊k/3⌋, channel k mod 3). Redrawn only when strokes change.
 *  - A ("light"): 1/4 pt resolution, near blur σ≈10 pt + mid σ≈27 pt + far σ≈90 pt → lights the wall, light direction = gradient.
 *  - B ("tubes"): 1/2 pt resolution, sharp near tubes + small glow → reflection in the puddle.
 */
export const TILES = Math.ceil(SLOTS / 3);
export const A_K = 0.25;
export const B_K = 0.5;
export const A_TILE = [Math.ceil(VIEW.w * A_K), Math.ceil(VIEW.h * A_K)] as const;
export const B_TILE = [Math.ceil(VIEW.w * B_K), Math.ceil(VIEW.h * B_K)] as const;

type Layer = { width: number; sigma: number; value: number };

const CH = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const render = (tubes: Tube[], k: number, tile: readonly [number, number], layers: Layer[]): SkImage => {
  const s = Skia.Surface.MakeRaster(tile[0] * TILES, tile[1])!;
  const c = s.getCanvas();
  c.clear(Skia.Color("black"));
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setStyle(PaintStyle.Stroke);
  // butt caps: tube segments joined end to end add into the atlas — round caps overlap into double-bright dots at the joints
  // (a harsh bright spot on the wall, a dot in the puddle reflection at the heart's tip)
  p.setStrokeCap(StrokeCap.Butt);
  p.setStrokeJoin(StrokeJoin.Round);
  p.setBlendMode(BlendMode.Plus);
  for (const t of tubes) {
    for (const u of t.units) {
      const ti = Math.floor(u.k / 3), ch = CH[u.k % 3];
      c.save();
      // clip per tile: the far blur (σ90 pt ≈ 22 atlas px) must not bleed into the next tile (different slot → wrong colour / flicker timing)
      c.clipRect(Skia.XYWHRect(ti * tile[0], 0, tile[0], tile[1]), ClipOp.Intersect, false);
      c.translate(ti * tile[0], 0);
      c.scale(k, k);
      for (const L of layers) {
        p.setColor(Skia.Color(`rgba(${ch[0] * 255 * L.value}, ${ch[1] * 255 * L.value}, ${ch[2] * 255 * L.value}, 1)`));
        p.setStrokeWidth(L.width * (t.width / 7));
        p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, L.sigma, true));
        c.drawPath(u.path, p);
      }
      c.restore();
    }
  }
  return s.makeImageSnapshot();
};

export type Atlas = { a: SkImage; b: SkImage };

/**
 * A: sum of three gaussians approximating the light of a line source ~2 cm off the wall (E ∝ 1/distance): very bright next to the
 *    tube (σ10), falling fast (σ27), long tail spreading across the wall (σ90). Radii ×1.5 vs the previous version (01/11): the street
 *    light was cut ~65 % → neon is now the wall's main light source; brightness next to the tube stays about the same, the far tail is ~1.6–3× brighter
 *    (≈ 0.70 · 0.21 · 0.08 · 0.03 at 0 / 30 / 60 / 120 pt — close to 1/d^1.5).
 * B: sharp tube + very small glow — only used for reflections (puddle), no fake big glow.
 */
export const renderAtlas = (tubes: Tube[]): Atlas => ({
  a: render(tubes, A_K, A_TILE, [
    { width: 12, sigma: 10.5, value: 0.85 },
    { width: 26, sigma: 27, value: 0.72 },
    { width: 46, sigma: 90, value: 0.34 },
  ]),
  b: render(tubes, B_K, B_TILE, [
    { width: 8, sigma: 1.4, value: 1.0 },
    { width: 14, sigma: 5, value: 0.16 },
  ]),
});
