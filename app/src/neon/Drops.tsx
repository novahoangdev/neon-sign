import React, { useMemo } from "react";
import { BlendColor, BlurStyle, Circle, FilterMode, Group, Image, MipmapMode, PaintStyle, Skia, type SkImage, type SkRect } from "react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { NEON } from "./palette";
import { hash } from "./flicker";
import type { Tube } from "./model";
import { HORIZON } from "../scene/layout";

/**
 * Rain on the tubes (POLISH 01/11): it's raining in the scene, so the tubes can't be dry — but SUBTLE (art director, 01/11 night:
 * "small white dots along every tube look like glitter, not glass"; glass comes from the continuous highlight along the top edge +
 * the hot white core, see GlassGlint in Tube.tsx). So:
 *  - Beads: only a few (≤ BEADS) on the underside at the tube's lowest spots, ≥ 40 pt apart, soft (blur), no
 *    white sparkle, low alpha; when lit they pick up the tube's own neon colour very faintly — one baked image per tube.
 *  - No splash flashes when raindrops hit the top of the tube (random flashes along the tube = glitter sparkle).
 *  - Drips: at the 1–2 lowest points of a curved stroke, a drop grows for ~1.2 s then falls under gravity (1 pt ≈ 4.25 mm →
 *    g ≈ 2300 pt/s²), period 3.5–7.5 s; drops pick up colour when the tube is lit. Index-based (no per-frame allocation).
 * Timing comes from the scene's `time` (respects TIMESCALE).
 */
const K = 3; // px/pt of the baked image
const LINEAR = { filter: FilterMode.Linear, mipmap: MipmapMode.None };
const G = 2300;
const GROW_DROP = 1.2;
const LAND = 0.14; // s: splash ring when a drop hits the ground
/** max water beads per tube */
const BEADS = 4;

type Bead = { x: number; y: number; r: number };
type Drip = { x: number; y: number; period: number; phase: number };

const mixW = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

const analyse = (tube: Tube) => {
  const it = Skia.ContourMeasureIter(tube.path, false, 1);
  const cm = it.next();
  const cand: (Bead & { s: number })[] = [];
  const low: { x: number; y: number; s: number }[] = [];
  if (!cm) return { beads: [] as Bead[], drips: [] as Drip[] };
  const len = cm.length();
  const w = tube.width;
  let s = 6 + hash(tube.id * 1.7) * 8;
  let i = 0;
  while (s < len - 6) {
    const [p, t] = cm.getPosTan(s);
    let nx = -t.y, ny = t.x;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    // underside facing down enough (horizontal/slanted segment) → water beads up
    if (ny > 0.45) {
      const r = 0.85 + hash(tube.id + i * 3.1) * 0.5;
      cand.push({ x: p.x + nx * w * 0.46, y: p.y + ny * w * 0.46, r, s });
      if (Math.abs(t.y) < 0.18) low.push({ x: p.x + nx * w * 0.5, y: p.y + ny * w * 0.5, s });
    }
    s += 7 + hash(tube.id * 0.37 + i * 1.91) * 16;
    i++;
  }
  // drip points: lowest, ≥ 40 pt apart along the tube
  low.sort((a, b) => b.y - a.y);
  const picked: typeof low = [];
  for (const l of low) if (picked.length < 2 && picked.every((q) => Math.abs(q.s - l.s) > 40)) picked.push(l);
  const drips = picked.map((l, j) => ({
    x: l.x,
    y: l.y,
    period: 3.5 + hash(tube.id * 2.3 + j) * 4,
    phase: hash(tube.id * 5.1 + j * 7) * 5,
  }));
  // beads: water gathers at low spots — take the lowest candidates, ≥ 40 pt apart along the tube (drip points included)
  cand.sort((a, b) => b.y - a.y);
  const beads: (Bead & { s: number })[] = [];
  for (const c of cand) if (beads.length < BEADS && beads.every((q) => Math.abs(q.s - c.s) > 40)) beads.push(c);
  return { beads: beads as Bead[], drips };
};

const bakeBeads = (beads: Bead[]): { image: SkImage; rect: SkRect } | null => {
  if (!beads.length) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const b of beads) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x);
    y1 = Math.max(y1, b.y);
  }
  const pad = 4;
  const rect = Skia.XYWHRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2);
  const surf = Skia.Surface.MakeRaster(Math.ceil(rect.width * K), Math.ceil(rect.height * K))!;
  const c = surf.getCanvas();
  c.clear(Skia.Color("transparent"));
  c.scale(K, K);
  c.translate(-rect.x, -rect.y);
  // soft bead, no white sparkle (a sharp sparkle = glitter): faint body + slightly brighter core offset downward
  const soft = Skia.Paint();
  soft.setAntiAlias(true);
  soft.setStyle(PaintStyle.Fill);
  soft.setColor(Skia.Color("rgba(255,255,255,0.5)"));
  soft.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 0.9, true));
  const lens = Skia.Paint();
  lens.setAntiAlias(true);
  lens.setColor(Skia.Color("rgba(255,255,255,0.35)"));
  lens.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 0.5, true));
  for (const b of beads) {
    c.drawCircle(b.x, b.y, b.r, soft);
    c.drawCircle(b.x, b.y + b.r * 0.3, b.r * 0.5, lens);
  }
  return { image: surf.makeImageSnapshot(), rect };
};

function DripDot({ d, time, lit, wet, color }: { d: Drip; time: SharedValue<number>; lit: SharedValue<number>; wet: SharedValue<number>; color: string }) {
  // u: seconds within the cycle; < GROW_DROP: the hanging drop grows; then it falls
  const u = useDerivedValue(() => {
    const v = (time.value + d.phase) / d.period;
    return (v - Math.floor(v)) * d.period;
  });
  const cy = useDerivedValue(() => {
    const f = u.value - GROW_DROP;
    if (f <= 0) return d.y + 0.4 + (u.value / GROW_DROP) * 0.9;
    const y = d.y + 1.3 + 0.5 * G * f * f;
    return y < HORIZON - 4 ? y : -1e4;
  });
  const r = useDerivedValue(() => {
    const f = u.value - GROW_DROP;
    return f <= 0 ? 0.35 + (u.value / GROW_DROP) * 1.05 : 1.2;
  });
  const op = useDerivedValue(() => wet.value * (0.3 + lit.value * 0.3));
  const litOp = useDerivedValue(() => wet.value * lit.value * 0.6);
  // ground hit (wall base): flattened splash ring (perspective) spreading 1 → 6 pt in 0.14 s
  const landY = HORIZON + 3;
  const tLand = GROW_DROP + Math.sqrt(Math.max(0, (2 * (HORIZON - 4 - d.y - 1.3)) / G));
  const ringR = useDerivedValue(() => 1 + Math.max(0, u.value - tLand) * 36);
  const ringOp = useDerivedValue(() => {
    const k = 1 - (u.value - tLand) / LAND;
    return u.value >= tLand && k > 0 ? k * wet.value * (0.45 + lit.value * 0.55) : 0;
  });
  const ringTf = useMemo(() => [{ translateX: d.x }, { translateY: landY }, { scaleY: 0.3 }], [d.x, landY]);
  return (
    <>
      <Circle cx={d.x} cy={cy} r={r} color="rgba(225,232,250,0.45)" opacity={op} />
      <Group blendMode="plus" opacity={litOp}>
        <Circle cx={d.x} cy={cy} r={r} color={color} />
      </Group>
      <Group transform={ringTf} blendMode="plus" opacity={ringOp}>
        <Circle cx={0} cy={0} r={ringR} color={color} style="stroke" strokeWidth={1.2} />
      </Group>
    </>
  );
}

/** Beads + drips of one tube. Drawn after the lit layer (UnitLit) and the clip bands. */
export function TubeDrops({ tube, time, bright }: { tube: Tube; time: SharedValue<number>; bright: SharedValue<number[]> }) {
  const { beads, drips } = useMemo(() => analyse(tube), [tube.path, tube.id, tube.width]); // eslint-disable-line react-hooks/exhaustive-deps
  const baked = useMemo(() => bakeBeads(beads), [beads]);
  const ks = useMemo(() => tube.units.map((u) => u.k), [tube.units]);
  const lit = useDerivedValue(() => {
    let s = 0;
    for (let i = 0; i < ks.length; i++) s += bright.value[ks[i]] ?? 0; // index loop: for…of allocates an iterator every frame
    return Math.min(1, s / ks.length);
  });
  // water beads up gradually after the tube "freezes"
  const wet = useDerivedValue(() => Math.min(1, Math.max(0, (time.value - tube.born - 0.4) / 1.5)));
  // low alpha: beads only read on close inspection, never as bright dots
  const offOp = useDerivedValue(() => wet.value * 0.4);
  const litOp = useDerivedValue(() => wet.value * lit.value * 0.45);
  const tint = mixW(NEON[tube.color].hex, 0.45);
  return (
    <Group>
      {baked && (
        <>
          <Image image={baked.image} x={baked.rect.x} y={baked.rect.y} width={baked.rect.width} height={baked.rect.height} fit="fill" sampling={LINEAR} opacity={offOp} />
          <Group key={tint} blendMode="plus" opacity={litOp}>
            <Image image={baked.image} x={baked.rect.x} y={baked.rect.y} width={baked.rect.width} height={baked.rect.height} fit="fill" sampling={LINEAR}>
              <BlendColor color={tint} mode="modulate" />
            </Image>
          </Group>
        </>
      )}
      {drips.map((d, i) => (
        <DripDot key={`${i}-${tint}`} d={d} time={time} lit={lit} wet={wet} color={tint} />
      ))}
    </Group>
  );
}
