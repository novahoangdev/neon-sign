import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { BackdropBlur, BlurMask, Circle, Group, LinearGradient, RadialGradient, RoundedRect, Skia, vec } from "react-native-skia";
import Animated, { Easing, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { ms, spring } from "../scene/clock";
import { NEON } from "../neon/palette";

/**
 * "Pop-up" palette next to the tapped tube (clean recording mode: no colour bar, no fixed text buttons on screen).
 * POLISH 01/11 night (art director: "7 tiny dots on a dark pill, looks like debug UI"): a FROSTED GLASS pill (real background
 * blur via BackdropBlur + light dark tint + top glass sheen + thin border), 30 pt swatches, 8 pt padding, selected swatch gets a ring +
 * a glow in its own colour. Drawn with Skia INSIDE the scene Canvas (`PopPill`) so the virtual finger + ripples draw ON TOP of the palette.
 * Shown on tube tap, hidden after a colour is picked; position and visibility are driven by the scene (shared values, scene time).
 */
/**
 * global scale every palette dimension is multiplied by (02/11: ×1.15 then ×1.5 — in the shrunken 4:3 mockup the swatches were still tiny): swatch Ø 45 pt,
 * pill 402 × 69 pt — fits the 440 pt width with 10 pt margins (popOrigin clamps 14 pt on each side).
 */
export const POP_K = 1.5;
export const POP = { dot: 30 * POP_K, gap: 7 * POP_K, pad: 8 * POP_K, lift: 64 * POP_K };
export const POP_W = NEON.length * POP.dot + (NEON.length - 1) * POP.gap + POP.pad * 2;
export const POP_H = POP.dot + POP.pad * 2;

/** Top-left corner of the pill (screen pt) for tap point (sx, sy). Placed above the finger, clamped to the screen. */
export const popOrigin = (sx: number, sy: number, screenW: number, out: number[]) => {
  "worklet";
  out[0] = Math.max(14, Math.min(screenW - 14 - POP_W, sx - POP_W / 2));
  out[1] = sy - POP.lift - POP_H > 60 ? sy - POP.lift - POP_H : sy + POP.lift;
};
/** Centre of swatch i (screen pt) when the pill is at (ox, oy). */
export const popSwatchX = (i: number, ox: number) => {
  "worklet";
  return ox + POP.pad + i * (POP.dot + POP.gap) + POP.dot / 2;
};
export const popSwatchY = (oy: number) => {
  "worklet";
  return oy + POP_H / 2;
};

type Props = {
  /** 0..1: visibility (0 = hidden) */
  show: SharedValue<number>;
  /** top-left corner (screen pt) */
  ox: SharedValue<number>;
  oy: SharedValue<number>;
  /** selected swatch (glowing ring) */
  active: SharedValue<number>;
};

// config precomputed on JS (spring() / ms() called inside a worklet crash the Release build)
const RING_SPRING = spring({ damping: 9, stiffness: 380, mass: 0.5 });
const DOT_SPRING = spring({ damping: 10, stiffness: 420, mass: 0.5 });
const RING_IN = { duration: ms(140) };
const RING_OUT = { duration: ms(220) };

// ── Skia (main scene) ──
const PILL = Skia.RRectXY(Skia.XYWHRect(0, 0, POP_W, POP_H), POP_H / 2, POP_H / 2);
/** hidden: moved off-screen (BackdropBlur gets clipped to nothing → costs nothing) */
const HIDDEN = [{ translateX: -9999 }, { translateY: -9999 }, { scale: 1 }, { translateX: 0 }, { translateY: 0 }];
const R_DISC = POP.dot / 2 - 3 * POP_K;
const K = POP_K;
const SHEEN = ["rgba(255,255,255,0.16)", "rgba(255,255,255,0.03)", "rgba(255,255,255,0)"];
const SHEEN_POS = [0, 0.45, 1];

/**
 * Frosted glass pill in the scene Canvas, screen coordinates (placed OUTSIDE the sceneT group, before ripples / finger).
 * Opens / closes on a SPRING (POLISH 02/11, art director v61: instead of a fade): `show` crossing 0.5 → `open` springs to 1 (pops from
 * 0.35 slightly past full size, then settles), below 0.5 → springs to 0 (shrinks). Opacity only keeps the pill from floating half-visible while
 * still small (fully opaque at open ≈ 0.3). Background blur follows `open` (group opacity can't apply to the backdrop layer); once fully closed it is
 * moved off-screen.
 */
const OPEN_SPRING = spring({ damping: 14, stiffness: 300, mass: 0.6 });
const CLOSE = { duration: ms(170), easing: Easing.in(Easing.quad) };
export function PopPill({ show, ox, oy, active }: Props) {
  const open = useSharedValue(0);
  useAnimatedReaction(
    () => show.value > 0.5,
    (on, was) => {
      if (on === was) return;
      // open on a spring; close with a short ease-in (a spring rings around 0 and flips the pill between HIDDEN and
      // visible several times → BackdropBlur layer churn = 4-frame stall in v64 at scene 3.92)
      open.value = on ? withSpring(1, OPEN_SPRING) : withTiming(0, CLOSE);
    },
  );
  const tf = useDerivedValue(() => {
    const o = open.value;
    if (o <= 0.01) return HIDDEN;
    return [
      { translateX: ox.value + POP_W / 2 },
      { translateY: oy.value + (1 - Math.min(1, o)) * 8 * K + POP_H / 2 },
      { scale: Math.max(0, 0.35 + 0.65 * o) },
      { translateX: -POP_W / 2 },
      { translateY: -POP_H / 2 },
    ];
  });
  const alpha = useDerivedValue(() => Math.max(0, Math.min(1, open.value * 3.3)));
  // sigma always > 0: Blur sigma 0 yields an empty image filter
  const blur = useDerivedValue(() => 0.4 + 13.6 * alpha.value);
  const shadowOp = useDerivedValue(() => alpha.value * alpha.value);
  return (
    <Group transform={tf}>
      <Group opacity={shadowOp}>
        <RoundedRect x={2 * K} y={8 * K} width={POP_W - 4 * K} height={POP_H} r={POP_H / 2} color="rgba(0,0,0,0.5)">
          <BlurMask blur={12 * K} style="normal" />
        </RoundedRect>
      </Group>
      <BackdropBlur blur={blur} clip={PILL} />
      <Group opacity={alpha}>
        <RoundedRect rect={PILL} color="rgba(22,20,30,0.34)" />
        <RoundedRect rect={PILL}>
          <LinearGradient start={vec(0, 0)} end={vec(0, POP_H)} colors={SHEEN} positions={SHEEN_POS} />
        </RoundedRect>
        <RoundedRect rect={PILL} style="stroke" strokeWidth={0.75 * K} color="rgba(255,255,255,0.24)" />
        {NEON.map((c, i) => (
          <PillChip key={c.name} i={i} hex={c.hex} active={active} />
        ))}
      </Group>
    </Group>
  );
}

function PillChip({ i, hex, active }: { i: number; hex: string; active: SharedValue<number> }) {
  const cx = popSwatchX(i, 0), cy = POP_H / 2;
  // selection 0..1: ring + glow fade over to the new swatch; the selected disc springs up to 1.15× (overshoots, then settles), stays at 1.15 while selected
  const sel = useSharedValue(0);
  const pop = useSharedValue(1);
  useAnimatedReaction(
    () => active.value === i,
    (on, was) => {
      if (on === was) return;
      sel.value = withTiming(on ? 1 : 0, on ? RING_IN : RING_OUT);
      pop.value = withSpring(on ? 1.15 : 1, DOT_SPRING);
    },
  );
  // selection ring hugs the scaled-up disc
  const ringR = useDerivedValue(() => R_DISC * pop.value + (1.2 + 1.4 * sel.value) * K);
  const discR = useDerivedValue(() => R_DISC * pop.value);
  const glowOp = useDerivedValue(() => sel.value * 0.75);
  // flat: slightly muted core → true colour → brightening toward the edge (inner glow); static gradient sized to the largest disc (1.15×)
  const tones = useMemo(() => [shade(hex, -0.18), hex, shade(hex, 0.3), shade(hex, 0.38)], [hex]);
  return (
    <Group>
      <Group opacity={glowOp} blendMode="plus">
        <Circle cx={cx} cy={cy} r={POP.dot / 2 + 3 * K} color={hex}>
          <BlurMask blur={8 * K} style="normal" />
        </Circle>
      </Group>
      <Circle cx={cx} cy={cy} r={ringR} style="stroke" strokeWidth={1.5 * K} color={hex} opacity={sel} />
      {/* FLAT disc (critic v72: black rim + gloss spot = "2012 glossy gel ball" next to a photoreal scene): slightly muted base colour + inner
          glow of that same colour from the edge inward, no reflection spot */}
      <Circle cx={cx} cy={cy} r={discR}>
        <RadialGradient c={vec(cx, cy)} r={R_DISC * 1.15} colors={tones} positions={TONE_POS} />
      </Circle>
    </Group>
  );
}

const TONE_POS = [0, 0.55, 0.87, 1];
/** mix a hex colour: k > 0 toward white, k < 0 toward black */
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

// ── RN version (old perf variant: a view floating outside the Canvas) — same size, no background blur ──
export function PopPalette({ show, ox, oy, active }: Props) {
  const box = useAnimatedStyle(() => {
    const s = show.value;
    const e = 1 - (1 - s) * (1 - s);
    return {
      opacity: s,
      transform: [{ translateX: ox.value }, { translateY: oy.value + (1 - e) * 10 }, { scale: 0.86 + 0.14 * e }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.pill, box]}>
      {NEON.map((c, i) => (
        <Dot key={c.name} i={i} hex={c.hex} active={active} />
      ))}
    </Animated.View>
  );
}

function Dot({ i, hex, active }: { i: number; hex: string; active: SharedValue<number> }) {
  const ring = useAnimatedStyle(() => {
    const on = active.value === i;
    return {
      opacity: withTiming(on ? 1 : 0, on ? RING_IN : RING_OUT),
      transform: [{ scale: withSpring(on ? 1 : 0.55, RING_SPRING) }],
    };
  });
  const dot = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(active.value === i ? 1.1 : 1, DOT_SPRING) }],
  }));
  return (
    <View style={styles.cell}>
      <Animated.View style={[styles.ring, { borderColor: hex, shadowColor: hex }, ring]} />
      <Animated.View style={[styles.dot, { backgroundColor: hex }, dot]} />
    </View>
  );
}

const D = POP.dot;
const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    left: 0,
    top: 0,
    width: POP_W,
    height: POP_H,
    borderRadius: POP_H / 2,
    paddingHorizontal: POP.pad,
    flexDirection: "row",
    alignItems: "center",
    gap: POP.gap,
    backgroundColor: "rgba(40,38,52,0.62)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.24)",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  cell: { width: D, height: D, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: D,
    height: D,
    borderRadius: D / 2,
    borderWidth: 1.6,
    shadowRadius: 8,
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 0 },
  },
  dot: {
    width: D - 8,
    height: D - 8,
    borderRadius: (D - 8) / 2,
  },
});
