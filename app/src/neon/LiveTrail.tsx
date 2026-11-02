import React from "react";
import { BlurMask, Circle, Group, Path, Shader, type SkPath } from "react-native-skia";
import { useDerivedValue, type DerivedValue } from "react-native-reanimated";

import { chalk } from "../shaders/chalk";

/**
 * Soft chalky glow trail following the finger while writing (POLISH 01/11, replaces the old 3 flat strokes in NeonScene).
 *  - Soft: 7 overlapping strokes, widening with decreasing alpha → near-gaussian cross-section (no BlurMask on the whole stroke: ≈10 ms GPU).
 *  - Grainy: each stroke is filled with the chalk-grain shader (src/shaders/chalk.ts), grain fixed to the wall.
 *  - Brighter trail head (last ~6 % of the stroke), soft pen-tip dot (BlurMask on a small circle, cheap).
 * All values are existing scene shared values; no per-frame allocation beyond what `path` already does.
 */
type Props = {
  path: DerivedValue<SkPath>;
  /** 0..1 fraction of the stroke drawn (trim) */
  end: DerivedValue<number>;
  /** pen width (pt) */
  width: DerivedValue<number>;
  tipX: DerivedValue<number>;
  tipY: DerivedValue<number>;
  /** 0/1: drawing */
  opacity: DerivedValue<number> | DerivedValue<0 | 1>;
  /** selected neon colour [r, g, b] 0..1 (defaults to pastel pink) */
  tint?: [number, number, number];
};

const LAYERS: [number, number][] = [
  // [width × pen, alpha]
  // v75: brighter + a wider hot core — the drawing stroke was ~2 px and low-contrast at mockup size (critic 8)
  [4.4, 0.03],
  [3.5, 0.042],
  [2.7, 0.056],
  [2.0, 0.077],
  [1.5, 0.105],
  [1.05, 0.16],
  [0.65, 0.36],
];

const mixW = (c: number[], k: number) => c.map((v) => v + (1 - v) * k);

export function LiveTrail({ path, end, width, tipX, tipY, opacity, tint = [1, 0.25, 0.64] }: Props) {
  const soft = mixW(tint, 0.55);
  const hot = mixW(tint, 0.85);
  const w0 = useDerivedValue(() => width.value * LAYERS[0][0]);
  const w1 = useDerivedValue(() => width.value * LAYERS[1][0]);
  const w2 = useDerivedValue(() => width.value * LAYERS[2][0]);
  const w3 = useDerivedValue(() => width.value * LAYERS[3][0]);
  const w4 = useDerivedValue(() => width.value * LAYERS[4][0]);
  const w5 = useDerivedValue(() => width.value * LAYERS[5][0]);
  const w6 = useDerivedValue(() => width.value * LAYERS[6][0]);
  const ws = [w0, w1, w2, w3, w4, w5, w6];
  const headA = useDerivedValue(() => Math.max(0, end.value - 0.06));
  const headW = useDerivedValue(() => width.value * 0.9);
  return (
    <Group opacity={opacity as DerivedValue<number>} blendMode="plus">
      {LAYERS.map(([, a], i) => (
        <Path key={i} path={path} style="stroke" strokeWidth={ws[i]} strokeCap="round" strokeJoin="round" end={end}>
          <Shader source={chalk} uniforms={{ col: [...(i < 5 ? soft : hot), a] }} />
        </Path>
      ))}
      <Path path={path} style="stroke" strokeWidth={headW} strokeCap="round" strokeJoin="round" start={headA} end={end}>
        <Shader source={chalk} uniforms={{ col: [...hot, 0.35] }} />
      </Path>
      <Circle cx={tipX} cy={tipY} r={6} color={`rgba(${hot.map((v) => Math.round(v * 255)).join(",")},0.55)`}>
        <BlurMask blur={5} style="normal" />
      </Circle>
    </Group>
  );
}
