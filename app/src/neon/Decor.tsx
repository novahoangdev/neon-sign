import React, { useMemo } from "react";
import {
  Atlas,
  BlurMask,
  BlurStyle,
  Circle,
  FilterMode,
  Group,
  Image,
  MipmapMode,
  PaintStyle,
  Path,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkImage,
  type SkPath,
  type SkRSXform,
} from "react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import meta from "../../assets/sprites/sprites.json";
import { NEON } from "./palette";
import { electrodes, type Mark, type Tube } from "./model";
import { HORIZON, TRANSFORMER, VIEW } from "../scene/layout";

/**
 * Neon sign props (Blender sprites, blender/scripts/sprites.py): tube clips, electrodes at both ends of each tube run (wires go
 * through the wall), one black cable from the first letter to the frame edge, black-painted blockout segments joining same-colour strokes.
 */
const PX = meta.pxPerPt;
const CELL = meta.parts.cell * PX; // px
const N_ANG = meta.parts.angles.length;
const STEP = Math.PI / N_ANG;
const REF_W = meta.parts.tubeW;
/** Tube "freezes" over GROW seconds (matches Tube.tsx); props appear after it. */
const GROW = 0.35;
type Tf = SharedValue<({ translateX: number } | { translateY: number })[]>;

const rect = (col: number, row: number) => Skia.XYWHRect(col * CELL, row * CELL, CELL, CELL);
const SPR_BACK = Array.from({ length: N_ANG }, (_, i) => rect(i, meta.parts.rows.clipBack));
const SPR_FRONT = Array.from({ length: N_ANG }, (_, i) => rect(i, meta.parts.rows.clipFront));
const SPR_ELEC = rect(meta.parts.misc.electrode, meta.parts.rows.misc);

/** Tangent angle → nearest sprite cell (180° symmetric) + remaining angle to rotate by. */
const angleCell = (ang: number) => {
  "worklet";
  const a = ((ang % Math.PI) + Math.PI) % Math.PI;
  const i = Math.round(a / STEP);
  return { i: i % N_ANG, r: a - i * STEP };
};

/**
 * RSXform placing the sprite cell centre at (x, y), rotation r, scale s. Hidden sprites (s ≈ 0) are placed off-screen at scale 1e-3:
 * an all-zero RSXform makes Graphite log "non-invertible transform" to stderr per sprite per frame (stutter in Release builds).
 */
const xform = (x: number, y: number, r: number, s: number): SkRSXform => {
  "worklet";
  if (s < 1e-3) return Skia.RSXform(1e-3, 0, -1e4, -1e4);
  const sc = s * Math.cos(r), ss = s * Math.sin(r), h = CELL / 2;
  return Skia.RSXform(sc, ss, x - (sc * h - ss * h), y - (ss * h + sc * h));
};

const popIn = (u: number) => {
  "worklet";
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const c = 1.9; // easeOutBack
  const v = u - 1;
  return 1 + (c + 1) * v * v * v + c * v * v;
};

type Clip = Mark & { at: number };

const clipsOf = (tube: Tube): Clip[] => [
  ...tube.clips.map((c) => ({ ...c, at: tube.born + GROW * (c.s / tube.len) })),
  ...tube.linkClips.map((c, i) => ({ ...c, at: tube.born + 0.04 * i })),
];

type ClipProps = { tube: Tube; time: SharedValue<number>; image: SkImage };

/** Clip, back part (base + post + shadow): drawn before the glass body (the post shows through the tube). */
/**
 * RSXforms for all prop sprites, allocation-free outside the "pop": before the first sprite appears → prebuilt hidden array; after the
 * last one finishes → prebuilt array; RSXforms are created per frame only inside the pop window (≈0.2–0.5 s). Residual angles precomputed.
 */
type XfItem = { x: number; y: number; r: number; s: number; at: number; dur: number };
const usePopXf = (items: XfItem[], time: SharedValue<number>) => {
  const hidden = useMemo(() => items.map(() => xform(0, 0, 0, 0)), [items]);
  const done = useMemo(() => items.map((c) => xform(c.x, c.y, c.r, c.s)), [items]);
  const from = useMemo(() => items.reduce((m, c) => Math.min(m, c.at), 1e9), [items]);
  const until = useMemo(() => items.reduce((m, c) => Math.max(m, c.at + c.dur), -1e9), [items]);
  return useDerivedValue(() => {
    const t = time.value;
    if (t <= from) return hidden;
    if (t >= until) return done;
    return items.map((c) => xform(c.x, c.y, c.r, c.s * popIn((t - c.at) / c.dur)));
  });
};

const useClipXf = (clips: Clip[], s0: number, time: SharedValue<number>) => {
  const items = useMemo(() => clips.map((c) => ({ x: c.x, y: c.y, r: angleCell(c.ang).r, s: s0, at: c.at, dur: 0.22 })), [clips, s0]);
  return usePopXf(items, time);
};

export function ClipsBack({ tube, time, image }: ClipProps) {
  const clips = useMemo(() => clipsOf(tube), [tube]);
  const sprites = useMemo(() => clips.map((c) => SPR_BACK[angleCell(c.ang).i]), [clips]);
  const s0 = tube.width / REF_W / PX;
  const transforms = useClipXf(clips, s0, time);
  if (!clips.length) return null;
  return <Atlas image={image} sprites={sprites} transforms={transforms} />;
}

/** Clip, steel wire band in front of the tube: drawn after the lit layer; picks up the neon colour when the tube is lit. */
export function ClipsFront({ tube, time, image, lit }: ClipProps & { lit: SharedValue<number> }) {
  const clips = useMemo(() => clipsOf(tube), [tube]);
  const sprites = useMemo(() => clips.map((c) => SPR_FRONT[angleCell(c.ang).i]), [clips]);
  const s0 = tube.width / REF_W / PX;
  const transforms = useClipXf(clips, s0, time);
  const tint = useMemo(() => clips.map(() => Skia.Color(NEON[tube.color].hex)), [clips, tube.color]);
  const litOp = useDerivedValue(() => Math.min(1, lit.value) * 0.85);
  if (!clips.length) return null;
  return (
    <>
      <Atlas image={image} sprites={sprites} transforms={transforms} />
      <Group key={tube.color} opacity={litOp} blendMode="plus">
        <Atlas image={image} sprites={sprites} transforms={transforms} colors={tint} colorBlendMode="modulate" />
      </Group>
    </>
  );
}

/** Blockout segment: same glass tube but painted black (unlit), with a faint highlight and a shadow cast on the wall. */
export function TubeLink({ tube, time, shadow, hl }: { tube: Tube; time: SharedValue<number>; shadow: Tf; hl: Tf }) {
  const end = useDerivedValue(() => Math.max(0, Math.min(1, (time.value - tube.born) / (GROW * 0.8))));
  if (!tube.link) return null;
  const w = tube.width;
  return (
    <Group>
      <GrowShadow path={tube.link} width={w * 1.1} blur={2.6} color="rgba(0,0,0,0.55)" end={end} shadow={shadow} />
      <Path path={tube.link} style="stroke" strokeWidth={w} strokeCap="round" color="rgba(14,13,17,0.96)" end={end} />
      <Path path={tube.link} style="stroke" strokeWidth={w * 0.16} strokeCap="round" color="rgba(170,185,215,0.1)" end={end} transform={hl} />
    </Group>
  );
}

// ── baked drop shadows (PERF, notes/perf.md): BlurMask only runs while growing, then one raster image is drawn ──
const LINEAR = { filter: FilterMode.Linear, mipmap: MipmapMode.None };
const K_SHADOW = 2; // px/pt

const bakeShadow = (path: SkPath, width: number, blur: number, color: string) => {
  const pad = width + blur * 3;
  const b = path.computeTightBounds();
  const rect = Skia.XYWHRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
  const surf = Skia.Surface.MakeRaster(Math.ceil(rect.width * K_SHADOW), Math.ceil(rect.height * K_SHADOW))!;
  const c = surf.getCanvas();
  c.clear(Skia.Color("transparent"));
  c.scale(K_SHADOW, K_SHADOW);
  c.translate(-rect.x, -rect.y);
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeCap(StrokeCap.Round);
  p.setStrokeJoin(StrokeJoin.Round);
  p.setStrokeWidth(width);
  p.setColor(Skia.Color(color));
  p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, blur, true));
  c.drawPath(path, p);
  return { image: surf.makeImageSnapshot(), rect };
};

/** Drop shadow of a path growing by `end` (0..1): path + BlurMask while end < 1, baked image once done. */
function GrowShadow({ path, width, blur, color, end, shadow }: { path: SkPath; width: number; blur: number; color: string; end: SharedValue<number>; shadow: Tf }) {
  const baked = useMemo(() => bakeShadow(path, width, blur, color), [path, width, blur, color]);
  const liveEnd = useDerivedValue(() => (end.value < 1 ? end.value : 0));
  const bakedOp = useDerivedValue((): number => (end.value < 1 ? 0 : 1));
  return (
    <Group transform={shadow}>
      <Path path={path} style="stroke" strokeWidth={width} strokeCap="round" strokeJoin="round" color={color} end={liveEnd}>
        <BlurMask blur={blur} style="normal" />
      </Path>
      <Image image={baked.image} x={baked.rect.x} y={baked.rect.y} width={baked.rect.width} height={baked.rect.height} fit="fill" sampling={LINEAR} opacity={bakedOp} />
    </Group>
  );
}

// ── electrodes + cable ──
/**
 * POLISH 02/11 (art director v60: "right-angle parallel cables frame the star and heart like a circuit diagram / selection box;
 * with power off they still glow as coloured L shapes"): real signs run wires THROUGH THE WALL right at the electrode — so no more cable from
 * tube to transformer box (only electrode caps remain), no pulse along the cable, no neon-tinted cable jacket. All that's left:
 *  - ONE black cable from the head electrode of the first tube (the "h") dropping down, sagging slightly, then out to the frame edge — the intro
 *    (src/intro/plan.ts, `headWire`) runs the plasma particle along it into the "h";
 *  - a very faint glow at the electrode cap when the adjacent tube slot ignites (power on), fading within ~0.3 s.
 */
type Cable = { path: SkPath; at: number; sig: string };

/** The single cable: head electrode of tube 0 → drops down, sags slightly, exits the left / right frame edge near the wall base. */
const leadCable = (tubes: Tube[]): Cable | null => {
  const e = electrodes(tubes).find((o) => o.tube === 0 && !o.end);
  if (!e) return null;
  const { x: ex, y: ey } = e.m;
  const x1 = ex < VIEW.w / 2 ? -16 : VIEW.w + 16;
  const y1 = Math.min(HORIZON - 4, ey + 270);
  const pb = Skia.PathBuilder.Make();
  pb.moveTo(ex, ey);
  // leave the electrode straight down, lowest point just before the frame edge (sag), then flick slightly outward
  pb.cubicTo(ex, ey + (y1 - ey) * 0.62, ex + (x1 - ex) * 0.3, y1 + 10, x1, y1);
  return { path: pb.build(), at: tubes[0].born + 0.05, sig: `${ex.toFixed(1)},${ey.toFixed(1)}` };
};

/**
 * For the intro (src/intro/plan.ts): the cable path being drawn (param 0 = "h" electrode, 1 = outer end past the frame) + two points on the
 * transformer box's bottom face [x0, y0, x1, y1] (the intro's arc spot — tube cables no longer enter the box, so this is just a position anchor).
 */
export const headWire = (tubes: Tube[]): { path: SkPath; glands: number[] } | null => {
  const c = leadCable(tubes);
  if (!c) return null;
  const [bx0, , bx1, by1] = TRANSFORMER;
  return { path: c.path, glands: [bx0 + 9.6, by1 - 1, bx1 - 9.6, by1 - 1] };
};

/** Power source (optional): glow at the electrode cap when the lights turn on. */
export type WirePower = {
  power: SharedValue<number>;
  powerAt: SharedValue<number>;
  offAt?: SharedValue<number>;
  cascade: SharedValue<boolean>;
  step: number;
  bornDelay: number;
  chase?: { at: number; stagger: number; dur: number }[];
  finale?: number;
};

function CableLine({ cable, time, shadow }: { cable: Cable; time: SharedValue<number>; shadow: Tf }) {
  const end = useDerivedValue(() => Math.max(0, Math.min(1, (time.value - cable.at - 0.05) / 0.45)));
  return (
    <Group>
      <GrowShadow path={cable.path} width={2.6} blur={1.6} color="rgba(0,0,0,0.5)" end={end} shadow={shadow} />
      <Path path={cable.path} style="stroke" strokeWidth={2.3} strokeCap="round" color="rgb(9,9,11)" end={end} />
      <Path path={cable.path} style="stroke" strokeWidth={0.7} strokeCap="round" color="rgba(150,172,220,0.12)" end={end} transform={HL_OFF} />
    </Group>
  );
}
const HL_OFF = [{ translateX: -0.5 }, { translateY: -0.6 }];

type Cap = { x: number; y: number; slot: number; born: number; color: string };

/** Electrode cap glow: flares when the adjacent tube slot first ignites after power on (same cascade timing as the scene). */
function CapGlow({ cap, time, pw }: { cap: Cap; time: SharedValue<number>; pw: WirePower }) {
  const op = useDerivedValue(() => {
    const t = time.value;
    // warm up the pipeline while the clock is still at 0 (see notes/perf.md): draw at ~1 %
    if (t <= 0) return 0.01;
    if (pw.power.value < 0.5) return 0;
    const arr = Math.max(pw.powerAt.value + (pw.cascade.value ? cap.slot * pw.step : 0), cap.born + pw.bornDelay);
    const d = t - arr;
    if (d < 0 || d > 0.35) return 0;
    return 0.45 * (d < 0.03 ? d / 0.03 : Math.exp(-(d - 0.03) / 0.09));
  });
  return (
    <Group opacity={op} blendMode="plus">
      <Circle cx={cap.x} cy={cap.y} r={7} color={cap.color}>
        <BlurMask blur={5} style="normal" />
      </Circle>
    </Group>
  );
}

/**
 * Wall layer: the single cable ("h" electrode → frame edge) + electrode cap glow at power on (drawn after the wall, before the
 * tubes — the glow peeks out around caps hidden behind the tube). `image` / `bright` kept for old-signature compatibility, unused.
 */
export function Wires({
  tubes,
  time,
  shadow,
  pw,
}: {
  tubes: Tube[];
  time: SharedValue<number>;
  image: SkImage;
  shadow: Tf;
  bright?: SharedValue<number[]>;
  /** power source (optional): if present, electrode caps flare softly when the lights turn on */
  pw?: WirePower;
}) {
  const cable = useMemo(() => leadCable(tubes), [tubes]);
  const caps = useMemo(() => {
    // slot index (slotInfo order) of the tube segment next to the electrode
    const off: number[] = [];
    tubes.reduce((a, t, i) => ((off[i] = a), a + t.units.length), 0);
    const out: Cap[] = [];
    for (const e of electrodes(tubes)) {
      if (out.some((o) => Math.abs(o.x - e.m.x) < 0.5 && Math.abs(o.y - e.m.y) < 0.5)) continue;
      const t = tubes[e.tube];
      const k = t.units.findIndex((u) => e.m.s >= u.a && e.m.s <= u.b);
      const unit = e.feed ? Math.max(0, k) : e.end ? Math.max(0, t.units.length - 1) : 0;
      out.push({ x: e.m.x, y: e.m.y, slot: off[e.tube] + unit, born: t.born, color: NEON[t.color].hex });
    }
    return out;
  }, [tubes]);
  return (
    <>
      {cable && <CableLine key={cable.sig} cable={cable} time={time} shadow={shadow} />}
      {pw && caps.map((c) => <CapGlow key={`${c.x},${c.y}-${c.color}`} cap={c} time={time} pw={pw} />)}
    </>
  );
}

/**
 * Electrode cap (GTO rubber boot) HIDDEN BEHIND the tube: drawn before the glass body, small (0.72) — at an open tube end only a dark
 * ring shows around the round tube end (tube bent back into the wall); on closed shapes it's the wall pass-through under the lowest point. One cap per spot.
 */
const ELEC_S = 0.72;
export function Electrodes({ tubes, time, image }: { tubes: Tube[]; time: SharedValue<number>; image: SkImage }) {
  const list = useMemo(() => {
    const out: { x: number; y: number; at: number; w: number }[] = [];
    for (const e of electrodes(tubes)) {
      const t = tubes[e.tube];
      if (out.some((o) => Math.abs(o.x - e.m.x) < 0.5 && Math.abs(o.y - e.m.y) < 0.5)) continue;
      out.push({ x: e.m.x, y: e.m.y, at: t.born + (e.feed ? GROW * (e.m.s / t.len) : e.end ? GROW : 0), w: t.width });
    }
    return out;
  }, [tubes]);
  const sprites = useMemo(() => list.map(() => SPR_ELEC), [list]);
  const items = useMemo(() => list.map((e) => ({ x: e.x, y: e.y, r: 0, s: (ELEC_S * e.w) / REF_W / PX, at: e.at, dur: 0.22 })), [list]);
  const transforms = usePopXf(items, time);
  if (!list.length) return null;
  return <Atlas image={image} sprites={sprites} transforms={transforms} />;
}
