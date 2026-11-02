import React, { useEffect, useMemo, useState } from "react";
import {
  BlendColor,
  BlendMode,
  BlurMask,
  BlurStyle,
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
import { ms } from "../scene/clock";
import { GAS, NEON } from "./palette";
import { type Tube, type Unit } from "./model";

/**
 * PERF (notes/perf.md): every BlurMask that used to run on every frame is baked ONCE into a raster image when the tube is committed:
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
/**
 * `cap`: each tube segment's glow uses BUTT caps — segments join and add (plus); round caps overlap half-discs on each
 * other into a double-bright dot at every joint (heart tip, where a closed tube's start and end meet); the two blur halves
 * of butt caps add up exactly. Glass body / shadow keep round caps (real tube ends are round).
 */
const stroke = (color: string, width: number, alpha = 1, cap: StrokeCap = StrokeCap.Round) => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeCap(cap);
  p.setStrokeJoin(StrokeJoin.Round);
  const c = Skia.Color(color);
  p.setColor(c);
  // MULTIPLY alpha, don't overwrite: setAlphaf(1) used to wipe the alpha of "rgba(…, 0.55)" → solid black shadow, unlit glass became a black tube
  p.setAlphaf(c[3] * alpha);
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

/**
 * Tube shadow cast on the wall (by the street lamp), shifted by device tilt. The tube sits ~2 cm off the wall, so the shadow has volume:
 *  - dark, narrow umbra close to the tube; wide, faint penumbra offset further;
 *  - caustic: the round glass tube focuses light like a lens → a thin bright band down the middle of the shadow (cuts into it).
 */
const shadowPaint = (w: number, alpha: number, blur: number) => {
  const p = stroke(`rgba(0,0,0,${alpha})`, w);
  p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, blur, true));
  return p;
};
export function TubeShadow({
  tube,
  time,
  shadow,
  bright,
}: Common & { shadow: SharedValue<Transforms>; /** optional: a lit tube fills its shadow with its own light */ bright?: SharedValue<number[]> }) {
  const end = useGrow(tube, time);
  const liveEnd = useDerivedValue(() => (end.value < 1 ? end.value : 0));
  const ks = useMemo(() => tube.units.map((u) => u.k), [tube.units]);
  const bakedOp = useDerivedValue((): number => {
    if (end.value < 1) return 0;
    if (!bright) return 1;
    let s = 0;
    for (let i = 0; i < ks.length; i++) s += bright.value[ks[i]] ?? 0;
    return 1 - 0.7 * Math.min(1, s / ks.length);
  });
  const w = tube.width;
  const baked = useMemo(
    () =>
      bake(tube.path, 16, 2, (c) => {
        c.save();
        c.translate(w * 0.22, w * 0.3); // penumbra offset further than the umbra
        c.drawPath(tube.path, shadowPaint(w * 1.55, 0.36, 4.2));
        c.restore();
        c.drawPath(tube.path, shadowPaint(w * 0.95, 0.62, 1.5));
        const caustic = stroke("rgba(0,0,0,0.55)", w * 0.22);
        caustic.setBlendMode(BlendMode.DstOut);
        caustic.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 0.7, true));
        c.drawPath(tube.path, caustic);
      }),
    [tube.path, w],
  );
  return (
    <Group transform={shadow}>
      <Path path={tube.path} style="stroke" strokeWidth={w * 1.1} strokeCap="round" strokeJoin="round" color="rgba(0,0,0,0.55)" end={liveEnd}>
        <BlurMask blur={2.6} style="normal" />
      </Path>
      <BakedImage b={baked} opacity={bakedOp} />
    </Group>
  );
}

/**
 * Glass tube (always drawn; the lit layer goes on top when powered). When off, real tubes look different by gas type:
 *  - argon/mercury (every colour except red): inside coated with phosphor powder → milky translucent white, catching a bit of cold street light;
 *  - neon (red): clear glass → the wall almost shows through, only the tube walls are visible.
 * Common: two thin dark tube walls (refraction), a bright highlight on one side sliding with the gyro + a faint secondary one on the other.
 */
const glassLook = (gas: number) =>
  gas === 1
    ? { fill: "rgba(140,148,168,0.5)", fillW: 0.88, rim: "rgba(6,7,12,0.55)" }
    : { fill: "rgba(170,180,200,0.07)", fillW: 0.86, rim: "rgba(6,7,12,0.62)" };

export function TubeGlass({ tube, time, hl }: Common & { hl: SharedValue<Transforms> }) {
  const end = useGrow(tube, time);
  const liveEnd = useDerivedValue(() => (end.value < 1 ? end.value : 0));
  const bakedOp = useDerivedValue((): number => (end.value < 1 ? 0 : 1));
  const w = tube.width;
  const look = glassLook(GAS[tube.color]);
  const baked = useMemo(
    () =>
      bake(tube.path, w, 3, (c) => {
        c.drawPath(tube.path, stroke(look.fill, w * look.fillW));
        // dark tube walls ONLY at the edges (refraction): a dark stroke w wide, then hollow out the middle with a blurred dstOut, in its own layer.
        // (An inner BlurMask on a narrow stroke darkened the whole inside → milky glass turned into a black tube.)
        c.saveLayer();
        c.drawPath(tube.path, stroke(look.rim, w));
        const hollow = stroke("black", w * 0.58);
        hollow.setBlendMode(BlendMode.DstOut);
        hollow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, w * 0.12, true));
        c.drawPath(tube.path, hollow);
        c.restore();
      }),
    [tube.path, w, look.fill, look.fillW, look.rim],
  );
  const S = { style: "stroke", strokeCap: "round", strokeJoin: "round" } as const;
  // keyed by glass type: changing gas = remount (RN Skia sometimes drops static prop updates, see UnitLit)
  // the wall is now near-black with power off (street light at 10 %) → unlit glass is just a faint line, revealed by lightning / neon
  return (
    <Group key={look.fill} opacity={0.55}>
      <Path path={tube.path} {...S} strokeWidth={w * look.fillW} color={look.fill} end={liveEnd} />
      <Path path={tube.path} {...S} strokeWidth={w} color={look.rim} end={liveEnd}>
        <BlurMask blur={w * 0.13} style="inner" />
      </Path>
      <BakedImage b={baked} opacity={bakedOp} />
      <Path path={tube.path} {...S} strokeWidth={w * 0.16} color="rgba(224,234,255,0.6)" end={end} transform={hl} />
      <Path
        path={tube.path}
        {...S}
        strokeWidth={w * 0.1}
        color="rgba(200,214,240,0.16)"
        end={end}
        transform={[{ translateX: w * 0.28 }, { translateY: w * 0.28 }]}
      />
    </Group>
  );
}

/** White streak running along the tube while it "freezes" — fully empty once done (no hidden blur every frame). */
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

type LitProps = Common & { unit: Unit; bright: SharedValue<number[]>; /** [born, readyAt] per slot k: set once this unit's lit layer is mounted */ ready?: SharedValue<number[]>; /** optional: glass highlight sliding with device tilt */ hl?: SharedValue<Transforms> };

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const css = (c: number[], a = 1) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
const mixW = (c: number[], k: number) => c.map((v) => v + (1 - v) * k);
/** Far-glow colour: more saturated (light scattered far from the tube loses its white, only the gas colour remains). */
const deep = (c: number[]) => {
  const p = c.map((v) => Math.pow(v, 1.7));
  const m = Math.max(...p, 1e-3);
  return p.map((v) => v / m);
};

/** Gas cross-section in the tube: [width × w, white mix, alpha] — 5 small steps for a smooth ramp from saturated edge to hot core. */
const GAS_LAYERS: [number, number, number][] = [
  [0.9, 0, 0.92],
  [0.7, 0.1, 0.5],
  [0.5, 0.28, 0.5],
  [0.32, 0.52, 0.55],
  [0.15, 0.85, 0.9],
];

/** Colour set for one neon colour: far glow · near glow · body · hot core. */
const tones = (hex: string) => {
  const c = rgb(hex);
  // each band's colour is pre-composited (inner layer over outer with its alpha) → every layer draws OPAQUE: Graphite tessellates
  // opaque strokes directly; translucent strokes must be rasterized into a limited path atlas — when it fills, the largest path (the "o" loop) is dropped.
  let acc = c.map((v) => v * 0.15); // dark backdrop behind the glass
  const gas = GAS_LAYERS.map(([, k, a]) => {
    const g = mixW(c, k);
    acc = acc.map((v, j) => v * (1 - a) + g[j] * a);
    return css(acc);
  });
  return { far: css(deep(c)), near: css(c), gas };
};
const TONES = NEON.map((n) => tones(n.hex));

/** Glow baked white, tinted by a static-colour BlendColor (no per-frame allocation). */
const Glow = ({ b, color, opacity }: { b: Baked; color: string; opacity?: SharedValue<number> }) => (
  <BakedImage b={b} opacity={opacity}>
    <BlendColor color={color} mode="srcIn" />
  </BakedImage>
);

/**
 * One tube segment when lit (additive colour, plus blend), outside in — mimicking real neon photos:
 *  - far glow σ≈20 pt in saturated colour (the gas emits colour, scattered in humid air), near glow σ≈5 pt in true colour: two baked images;
 *  - gas body filling the tube, saturated; 5 steps mixing toward white up to a thin near-white core — the brightest part "burns out" like film.
 *    Gas layers are composited (srcOver), not added: adding burns already-saturated channels white across the whole tube (cyan → white);
 *  - thin glass reflection streak offset toward the top left.
 *
 * IMPORTANT (01/11): RN Skia 3.8 sometimes DROPS prop updates on mounted nodes (static colour on React re-render, or
 * animated trim): recording v5 kept "hello" pink after switching to cyan; the "o" lost its gas body. Nodes that only mount (never
 * update) are always correct. So: steady → `Steady` (static colour, no trim, only animated opacity like flicker); during the 0.6 s of gas
 * flow → mount `Flow` (trim + crossfade); done → remount `Steady` in the new colour. Baked images live in the outer shell.
 */
export function UnitLit({ tube, unit, time, bright, hl, ready }: LitProps) {
  const w = tube.width;
  // tell the UI thread this unit can now be drawn lit: the three blur bakes below run on the JS thread and a fresh
  // tube mounted a few frames after its slot started igniting → its reflection / wall spill lit up before the tube
  // itself (critic v86, star at 4.85 s)
  useEffect(() => {
    if (!ready) return;
    const k = unit.k, born = tube.born;
    ready.modify((a) => {
      "worklet";
      if (a[k * 2] !== born) {
        a[k * 2] = born;
        a[k * 2 + 1] = time.value;
      }
      return a;
    });
  }, [ready, unit.k, tube.born, time]);
  const near = useMemo(
    () =>
      bake(unit.path, 5 * 3 + w, 1.5, (c) => {
        const p = stroke("white", w * 1.4, 0.72, StrokeCap.Butt);
        p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 5, true));
        c.drawPath(unit.path, p);
      }),
    [unit.path, w],
  );
  const far = useMemo(
    () =>
      bake(unit.path, 20 * 3 + w * 1.2, 0.6, (c) => {
        const p = stroke("white", w * 2.4, 0.6, StrokeCap.Butt);
        p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 20, true));
        c.drawPath(unit.path, p);
      }),
    [unit.path, w],
  );
  // hot white halo hugging the tube (sensor "burn" around bright gas): white, untinted, thin
  const hot = useMemo(
    () =>
      bake(unit.path, 2 * 3 + w, 2, (c) => {
        const p = stroke("white", w * 0.95, 0.14, StrokeCap.Butt);
        p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 2, true));
        c.drawPath(unit.path, p);
      }),
    [unit.path, w],
  );
  const [settled, setSettled] = useState(-1); // flowAt that has finished flowing
  useEffect(() => {
    if (tube.flowAt < 0) return;
    // remount Flow → Steady staggered (each unit delayed another 50 ms of scene time): remounting the whole tube in one frame stalled 3 frames (v52);
    // by now Flow already shows the new colour, so the extra delay is invisible
    const id = setTimeout(() => setSettled(tube.flowAt), ms(tube.flowDur * 1000 + 80 + (unit.k % 12) * 50));
    return () => clearTimeout(id);
  }, [tube.flowAt, tube.flowDur, unit.k]);
  const op = useDerivedValue(() => Math.min(1, bright.value[unit.k] ?? 0));
  const flowing = tube.flowAt >= 0 && tube.prev !== tube.color && settled !== tube.flowAt;
  const common = { unit, w, near, far, hot, op, hl };
  return flowing ? (
    <UnitLitFlow key={`f${tube.flowAt}`} {...common} from={tube.prev} to={tube.color} at={tube.flowAt} len={tube.len} dur={tube.flowDur} time={time} />
  ) : (
    <UnitLitSteady key={`s${tube.color}`} {...common} color={tube.color} />
  );
}

type Common2 = { unit: Unit; w: number; near: Baked; far: Baked; hot: Baked; op: SharedValue<number>; hl?: SharedValue<Transforms> };
const S = { style: "stroke", strokeCap: "round", strokeJoin: "round" } as const;

/**
 * Glass highlight on a lit tube: street light reflected off the cylinder — ONE thin continuous streak along the top edge (art director
 * 01/11 night: glass reads through a continuous highlight + hot white core, not sparkle dots), sliding with device tilt
 * if `hl` is given. BUTT caps: tube segments join end to end, and round caps overlap (additively) into bright dots at every joint.
 */
const GLINT_OFF = (w: number) => [{ translateX: -w * 0.08 }, { translateY: -w * 0.3 }];
const GlassGlint = ({ unit, w, hl }: { unit: Unit; w: number; hl?: SharedValue<Transforms> }) => {
  const off = useMemo(() => GLINT_OFF(w), [w]);
  return (
    <Group blendMode="plus" transform={hl}>
      <Path path={unit.path} style="stroke" strokeCap="butt" strokeJoin="round" strokeWidth={w * 0.11} color="rgba(240,247,255,0.34)" transform={off} />
    </Group>
  );
};

function UnitLitSteady({ unit, w, near, far, hot, op, hl, color }: Common2 & { color: number }) {
  const t = TONES[color];
  return (
    <Group opacity={op}>
      <Group blendMode="plus">
        <Glow b={far} color={t.far} />
        <Glow b={near} color={t.near} />
      </Group>
      {GAS_LAYERS.map(([k], i) => (
        <Path key={i} path={unit.path} {...S} strokeWidth={w * k} color={t.gas[i]} />
      ))}
      <Group blendMode="plus">
        <BakedImage b={hot} />
      </Group>
      <GlassGlint unit={unit} w={w} hl={hl} />
    </Group>
  );
}

function UnitLitFlow({ unit, w, near, far, hot, op, hl, from, to, at, len, dur, time }: Common2 & { from: number; to: number; at: number; len: number; dur: number; time: SharedValue<number> }) {
  const split = useDerivedValue(() => {
    const p = clamp01((time.value - at) / dur);
    return clamp01((p * len - unit.a) / Math.max(1, unit.b - unit.a));
  });
  const oldOp = useDerivedValue(() => 1 - split.value);
  const edgeA = useDerivedValue(() => (split.value > 0 && split.value < 1 ? Math.max(0, split.value - 0.04) : 0));
  const edgeB = useDerivedValue(() => (split.value > 0 && split.value < 1 ? split.value : 0));
  const tN = TONES[to];
  const tO = TONES[from];
  return (
    <Group opacity={op}>
      <Group blendMode="plus">
        <Glow b={far} color={tN.far} opacity={split} />
        <Glow b={far} color={tO.far} opacity={oldOp} />
        <Glow b={near} color={tN.near} opacity={split} />
        <Glow b={near} color={tO.near} opacity={oldOp} />
      </Group>
      {GAS_LAYERS.map(([k], i) => (
        <Path key={`n${i}`} path={unit.path} {...S} strokeWidth={w * k} color={tN.gas[i]} end={split} />
      ))}
      {GAS_LAYERS.map(([k], i) => (
        <Path key={`o${i}`} path={unit.path} {...S} strokeWidth={w * k} color={tO.gas[i]} start={split} />
      ))}
      <GlassGlint unit={unit} w={w} hl={hl} />
      <Group blendMode="plus">
        <BakedImage b={hot} />
        {/* gas surface: new-colour glow + thin SHARP white core (white stroke + animated-trim BlurMask rendered as a flat white blob) */}
        <Path path={unit.path} style="stroke" strokeWidth={w * 2} strokeCap="round" color={tN.near} opacity={0.7} start={edgeA} end={edgeB}>
          <BlurMask blur={5} style="normal" />
        </Path>
        <Path path={unit.path} style="stroke" strokeWidth={w * 0.5} strokeCap="round" color="white" opacity={0.85} start={edgeA} end={edgeB} />
      </Group>
    </Group>
  );
}
