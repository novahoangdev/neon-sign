import React, { useMemo } from "react";
import {
  BlendColor,
  BlurMask,
  BlurStyle,
  BlendMode,
  FilterMode,
  Group,
  Image,
  MipmapMode,
  PaintStyle,
  Path,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkCanvas,
  type SkImage,
  type SkPath,
  type SkRect,
} from "react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { NEON, coreColor } from "../../neon/palette";
import { FLOW_DUR, type Tube, type Unit } from "../../neon/model";

/**
 * Drop-in replacement for src/neon/Tube.tsx (same exports + props) — PERF proposal, see notes/perf.md.
 * Every BlurMask that used to run on every frame is baked ONCE into a raster image when the tube is committed:
 *  - UnitLit: glow σ18 + σ6 baked white at 1.5 px/pt, drawn each frame as one image tinted by a colour filter
 *    (old→new colour mixed by how far the new gas has flowed through this unit). Sharp colour layer + core stay
 *    paths with trim (no mask filter), so the gas front is still exact.        GPU 52.5 ms → ~0.5 ms / frame
 *  - TubeShadow / TubeGlass: live paths only while the tube "freezes" (GROW s), then a baked image
 *    (shadow σ2.6 at 2 px/pt, body + inner-blur rim at 3 px/pt). The gyro highlight stays a live path (no blur).
 *  - TubeFreeze: zero-length once grown (was a 12 % blurred segment drawn forever at opacity 0).
 */

type Transforms = ({ translateX: number } | { translateY: number })[];
const GROW = 0.35;
const LINEAR = { filter: FilterMode.Linear, mipmap: MipmapMode.None };
const clamp01 = (v: number) => {
  "worklet";
  return Math.max(0, Math.min(1, v));
};

type Common = { tube: Tube; time: SharedValue<number> };
const useGrow = (tube: Tube, time: SharedValue<number>) => useDerivedValue(() => clamp01((time.value - tube.born) / GROW));

// ── baking ──
type Baked = { image: SkImage; rect: SkRect };
const stroke = (color: string, width: number, alpha = 1) => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeCap(StrokeCap.Round);
  p.setStrokeJoin(StrokeJoin.Round);
  p.setColor(Skia.Color(color));
  p.setAlphaf(alpha);
  p.setStrokeWidth(width);
  return p;
};
/** Raster image of `draw` over the path bounds + pad (pt), at k px/pt. */
const bake = (path: SkPath, pad: number, k: number, draw: (c: SkCanvas) => void): Baked => {
  const b = path.computeTightBounds();
  const rect = Skia.XYWHRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
  const s = Skia.Surface.MakeRaster(Math.ceil(rect.width * k), Math.ceil(rect.height * k))!;
  const c = s.getCanvas();
  c.clear(Skia.Color("transparent"));
  c.scale(k, k);
  c.translate(-rect.x, -rect.y);
  draw(c);
  return { image: s.makeImageSnapshot(), rect };
};
const BakedImage = ({ b, opacity, children }: { b: Baked; opacity?: SharedValue<number>; children?: React.ReactNode }) => (
  <Image image={b.image} x={b.rect.x} y={b.rect.y} width={b.rect.width} height={b.rect.height} fit="fill" sampling={LINEAR} opacity={opacity}>
    {children}
  </Image>
);

/** Tube shadow cast on the wall, offset by device tilt. */
export function TubeShadow({ tube, time, shadow }: Common & { shadow: SharedValue<Transforms> }) {
  const end = useGrow(tube, time);
  const liveEnd = useDerivedValue(() => (end.value < 1 ? end.value : 0));
  const bakedOp = useDerivedValue((): number => (end.value < 1 ? 0 : 1));
  const baked = useMemo(
    () =>
      bake(tube.path, 12, 2, (c) => {
        const p = stroke("rgba(0,0,0,0.55)", tube.width * 1.1);
        p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 2.6, true));
        c.drawPath(tube.path, p);
      }),
    [tube.path, tube.width],
  );
  return (
    <Group transform={shadow}>
      <Path path={tube.path} style="stroke" strokeWidth={tube.width * 1.1} strokeCap="round" strokeJoin="round" color="rgba(0,0,0,0.55)" end={liveEnd}>
        <BlurMask blur={2.6} style="normal" />
      </Path>
      <BakedImage b={baked} opacity={bakedOp} />
    </Group>
  );
}

/** Glass body when off: clear smoky grey, dark edges, thin highlight streak sliding with the gyro. */
export function TubeGlass({ tube, time, hl }: Common & { hl: SharedValue<Transforms> }) {
  const end = useGrow(tube, time);
  const liveEnd = useDerivedValue(() => (end.value < 1 ? end.value : 0));
  const bakedOp = useDerivedValue((): number => (end.value < 1 ? 0 : 1));
  const w = tube.width;
  const baked = useMemo(
    () =>
      bake(tube.path, w, 3, (c) => {
        c.drawPath(tube.path, stroke("rgba(150,148,165,0.34)", w));
        const rim = stroke("rgba(5,5,10,0.75)", w);
        rim.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Inner, w * 0.22, true));
        c.drawPath(tube.path, rim);
      }),
    [tube.path, w],
  );
  return (
    <Group>
      <Path path={tube.path} style="stroke" strokeWidth={w} strokeCap="round" strokeJoin="round" color="rgba(150,148,165,0.34)" end={liveEnd} />
      <Path path={tube.path} style="stroke" strokeWidth={w} strokeCap="round" strokeJoin="round" color="rgba(5,5,10,0.75)" end={liveEnd}>
        <BlurMask blur={w * 0.22} style="inner" />
      </Path>
      <BakedImage b={baked} opacity={bakedOp} />
      <Path path={tube.path} style="stroke" strokeWidth={w * 0.2} strokeCap="round" strokeJoin="round" color="rgba(214,228,255,0.62)" end={end} transform={hl} />
    </Group>
  );
}

/** White light streak running along the tube as it "freezes" — fully empty when done (no hidden blur every frame). */
export function TubeFreeze({ tube, time }: Common) {
  const end = useGrow(tube, time);
  const start = useDerivedValue(() => (end.value >= 1 ? 1 : Math.max(0, end.value - 0.12)));
  const op = useDerivedValue(() => (end.value >= 1 ? 0 : 1));
  return (
    <Group opacity={op} blendMode="plus">
      <Path path={tube.path} style="stroke" strokeWidth={tube.width * 1.6} strokeCap="round" color="rgba(220,235,255,0.55)" start={start} end={end}>
        <BlurMask blur={5} style="normal" />
      </Path>
    </Group>
  );
}

type LitProps = Common & { unit: Unit; bright: SharedValue<number[]> };

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** One lit tube segment: glow (pre-baked image, tinted), colour layer, near-white core — additive (plus). */
export function UnitLit({ tube, unit, time, bright }: LitProps) {
  const w = tube.width;
  const op = useDerivedValue(() => Math.min(1, bright.value[unit.k] ?? 0));
  const split = useDerivedValue(() => {
    if (tube.flowAt < 0) return 1;
    const p = clamp01((time.value - tube.flowAt) / FLOW_DUR);
    return clamp01((p * tube.len - unit.a) / Math.max(1, unit.b - unit.a));
  });
  const flowing = useDerivedValue(() => split.value > 0 && split.value < 1);
  const edgeA = useDerivedValue(() => (flowing.value ? Math.max(0, split.value - 0.04) : 0));
  const edgeB = useDerivedValue(() => (flowing.value ? split.value : 0));
  const cNew = NEON[tube.color].hex;
  const cOld = NEON[tube.prev].hex;
  const a = rgb(cOld), b = rgb(cNew);
  // glow colour: old → new as the gas front crosses this unit
  const tint = useDerivedValue(() => {
    const s = split.value;
    return new Float32Array([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, 1]);
  });
  const glow = useMemo(
    () =>
      bake(unit.path, 18 * 3 + w * 1.2, 1.5, (c) => {
        for (const [width, alpha, sigma] of [
          [w * 2.4, 0.55, 18],
          [w * 1.5, 0.6, 6],
        ]) {
          const p = stroke("white", width, alpha);
          p.setBlendMode(BlendMode.Plus);
          p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, true));
          c.drawPath(unit.path, p);
        }
      }),
    [unit.path, w],
  );
  const flows = tube.flowAt >= 0;
  return (
    <Group opacity={op} blendMode="plus">
      <BakedImage b={glow}>
        <BlendColor color={tint} mode="srcIn" />
      </BakedImage>
      <Path path={unit.path} style="stroke" strokeWidth={w * 0.95} strokeCap="round" strokeJoin="round" color={cNew} opacity={0.7} end={split} />
      {flows && <Path path={unit.path} style="stroke" strokeWidth={w * 0.95} strokeCap="round" strokeJoin="round" color={cOld} opacity={0.7} start={split} />}
      <Path path={unit.path} style="stroke" strokeWidth={w * 0.3} strokeCap="round" strokeJoin="round" color={coreColor(cNew)} end={split} />
      {flows && <Path path={unit.path} style="stroke" strokeWidth={w * 0.3} strokeCap="round" strokeJoin="round" color={coreColor(cOld)} start={split} />}
      <Path path={unit.path} style="stroke" strokeWidth={w * 1.3} strokeCap="round" color="white" opacity={0.9} start={edgeA} end={edgeB}>
        <BlurMask blur={4} style="normal" />
      </Path>
    </Group>
  );
}
