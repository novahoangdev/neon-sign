import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Atlas, BlurMask, Canvas, Circle, Group, Path, RoundedRect, Skia, useImage, type SkImage } from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue } from "react-native-reanimated";
import meta from "../../assets/sprites/sprites.json";
import { TRANSFORMER, type Fit } from "../scene/layout";

/**
 * WALL-mounted switch to the right of the transformer box (POLISH 01/11 night — art director: "a flat grey plate lying on the road,
 * its reflection blending into the puddle" → clip-art). Now part of the scene: drawn in the main Canvas (wall layer, design pt,
 * follows parallax / shake / intro camera), level with the transformer box, joined to it by a short cable, with a contact shadow
 * on the wall, darkening when the alley lights go out. Plate ~57 × 84 pt (readable in the 4:3 mockup; bigger than a real switch — storytelling first).
 *  - `SwitchArt`: the artwork (Skia, placed in the scene's wallT group).
 *  - `Switch`: transparent RN touch area placed right over it on screen (≥ 44 pt), toggles on / off as before.
 */
// 0.68 (02/11, critic: the flip doesn't read — a 30 × 44 pt plate is too small, ~14 pt lever): plate ~38 × 56 pt, lever ~18 pt
// 02/11 round 7: another ×1.5 → 1.02 (in the 4:3 mockup the switch was still only ~115 px): plate ~57 × 84 pt, lever ~28 pt;
// tight against the transformer box (7 pt gap), right edge ~4 pt from the drainpipe
const SC = 1.02;
const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";
/**
 * plate centre (design pt); `hit` = touch area side (design pt).
 * w / h / right / bottom: old box (screen pt, bottom-right corner) — only kept for the not-yet-migrated perf variant (Switch without `fit`).
 */
export const SWITCH = { x: TRANSFORMER[2] + 7 + 28 * SC, y: (TRANSFORMER[1] + TRANSFORMER[3]) / 2 + 1.5, hit: 92, w: 62, h: 88, right: 16, bottom: 30 };

const PX = meta.pxPerPt;
const [CW, CH] = meta.switch.cell; // pt (sprite cell)
const PW = 56 * SC, PH = 82 * SC; // plate within the cell (sprites.py: 56 × 82 pt)
/** plate bounding box (design pt): Decor keeps the vertical drop cable from crossing it */
export const SWITCH_RECT = { x0: SWITCH.x - PW / 2, y0: SWITCH.y - PH / 2, x1: SWITCH.x + PW / 2, y1: SWITCH.y + PH / 2 };

const FRAMES = meta.switch.lever.length;
const cellRect = (i: number) => Skia.XYWHRect(i * CW * PX, 0, CW * PX, CH * PX);
const PLATE = [cellRect(meta.switch.plate)];
const LEVER = meta.switch.lever.map(cellRect);
const XF = [Skia.RSXform(SC / PX, 0, SWITCH.x - (CW * SC) / 2, SWITCH.y - (CH * SC) / 2)];
const BLACK = [Skia.Color("black")];
/** pilot light on the plate (sprites.py: 19 pt above the bottom edge of the 82 pt plate) */
const PILOT = { x: SWITCH.x, y: SWITCH.y + (41 - 19) * SC };
const R_PLATE = 8 * SC;

/** short cable from the right side of the transformer box to the left side of the plate, slightly sagging */
const STUB = (() => {
  const y = SWITCH.y + PH * 0.18;
  const x0 = TRANSFORMER[2] - 0.5, x1 = SWITCH_RECT.x0 + 1.2;
  const b = Skia.PathBuilder.Make();
  b.moveTo(x0, y);
  b.cubicTo(x0 + 4, y + 3.2, x1 - 4, y + 3.2, x1, y);
  return b.build();
})();

/**
 * Switch artwork in the scene. `lever` 0..1 (sprung) → blends the two nearest sprite frames; `pilot` 0..1: sign brightness —
 * the amber pilot light follows it, the plate darkens when the sign is off (the surrounding wall is lit only by the neon sign itself).
 */
/**
 * `beckon` 0..1 (normal app only): until the first flip the plate stays readable in the dark, its pilot LED blinks and a
 * soft warm halo breathes around it, so a new user finds the switch (user 02/11).
 */
export function SwitchArt({ lever, pilot, beckon }: { lever: SharedValue<number>; pilot: SharedValue<number>; beckon?: SharedValue<number> }) {
  const img = useImage(require("../../assets/sprites/switch.png"));
  const f = useDerivedValue(() => Math.max(0, Math.min(1, lever.value)) * (FRAMES - 1));
  const sprA = useDerivedValue(() => [LEVER[Math.floor(f.value)]]);
  const sprB = useDerivedValue(() => [LEVER[Math.min(FRAMES - 1, Math.floor(f.value) + 1)]]);
  const opB = useDerivedValue(() => f.value - Math.floor(f.value));
  const opA = useDerivedValue(() => 1 - opB.value);
  // black overlay (modulate) by alley darkness: fully lit is still 25 % darker (sprite shot under studio lights), fully off ~15 %
  // normal app: the plate darkens much less with the lights off (0.85 → 0.45) so it can be found; demo unchanged
  const dark = useDerivedValue(() => 0.25 + (DEMO ? 0.6 : 0.2) * (1 - Math.min(1, pilot.value)));
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (DEMO || !beckon) return;
    pulse.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [beckon, pulse]);
  const call = useDerivedValue(() => (beckon ? beckon.value * pulse.value : 0));
  const haloOp = useDerivedValue(() => 0.5 * call.value);
  const ledOp = useDerivedValue(() => call.value);
  const darkA = useDerivedValue(() => dark.value * opA.value);
  const darkB = useDerivedValue(() => dark.value * opB.value);
  // readable flip (critic v70): motion blur = 3 "ghost" frames trailing by lever velocity (sprite frames / video frame)
  // + white flash on the lever while it swings; the scene spring is fast (~0.12 s), so only a few frames show the streak
  const prevF = useSharedValue(-1);
  const vel = useSharedValue(0);
  // track the raw lever (changes every frame until the spring settles — including clamped overshoot) so vel returns to 0 when the lever is still
  useAnimatedReaction(
    () => lever.value,
    (l) => {
      const v = Math.max(0, Math.min(1, l)) * (FRAMES - 1);
      vel.value = prevF.value < 0 ? 0 : v - prevF.value;
      prevF.value = v;
    },
  );
  const speed = useDerivedValue(() => Math.min(1, Math.abs(vel.value) / 0.7));
  const flash = useDerivedValue(() => speed.value * 0.55);
  const glow = useDerivedValue(() => Math.min(1, pilot.value));
  const core = useDerivedValue(() => 0.25 + 0.75 * Math.min(1, pilot.value));
  if (!img) return null;
  return (
    <Group>
      {/* shadow: the ~2 pt thick plate stands off the wall — soft shadow offset down-right (same direction as tube shadows) + dark contact edge hugging the rim */}
      <RoundedRect x={SWITCH_RECT.x0 + 1.6} y={SWITCH_RECT.y0 + 2.8} width={PW} height={PH} r={R_PLATE} color="rgba(0,0,0,0.5)">
        <BlurMask blur={3.4} style="normal" />
      </RoundedRect>
      <RoundedRect x={SWITCH_RECT.x0 + 0.3} y={SWITCH_RECT.y0 + 0.6} width={PW} height={PH} r={R_PLATE} color="rgba(0,0,0,0.55)">
        <BlurMask blur={0.8} style="normal" />
      </RoundedRect>
      {/* cable from the transformer box */}
      <Path path={STUB} style="stroke" strokeWidth={2.6} strokeCap="round" color="rgba(0,0,0,0.45)" transform={SHADOW_OFF}>
        <BlurMask blur={1.2} style="normal" />
      </Path>
      <Path path={STUB} style="stroke" strokeWidth={2.3} strokeCap="round" color="rgb(9,9,11)" />
      <Path path={STUB} style="stroke" strokeWidth={0.7} strokeCap="round" color="rgba(150,172,220,0.3)" transform={SHEEN_OFF} />
      <Atlas image={img} sprites={PLATE} transforms={XF} />
      <Group opacity={dark}>
        <Atlas image={img} sprites={PLATE} transforms={XF} colors={BLACK} colorBlendMode="modulate" />
      </Group>
      <Group opacity={glow} blendMode="plus">
        <Circle cx={PILOT.x} cy={PILOT.y} r={9} color="rgba(255,140,40,0.55)">
          <BlurMask blur={7} style="normal" />
        </Circle>
      </Group>
      <Circle cx={PILOT.x} cy={PILOT.y} r={2} color="#ffb24a" opacity={core} />
      {beckon && (
        <Group blendMode="plus">
          <Group opacity={haloOp}>
            <RoundedRect x={SWITCH_RECT.x0 - 3} y={SWITCH_RECT.y0 - 3} width={PW + 6} height={PH + 6} r={R_PLATE + 3} style="stroke" strokeWidth={3} color="rgba(255,190,120,0.55)">
              <BlurMask blur={6} style="normal" />
            </RoundedRect>
          </Group>
          <Group opacity={ledOp}>
            <Circle cx={PILOT.x} cy={PILOT.y} r={11} color="rgba(255,150,50,0.8)">
              <BlurMask blur={8} style="normal" />
            </Circle>
            <Circle cx={PILOT.x} cy={PILOT.y} r={2.6} color="#ffd38a" />
          </Group>
        </Group>
      )}
      <Group opacity={opA}>
        <Atlas image={img} sprites={sprA} transforms={XF} />
      </Group>
      <Group opacity={opB}>
        <Atlas image={img} sprites={sprB} transforms={XF} />
      </Group>
      {GHOST_OP.map((o, g) => (
        <LeverGhost key={g} g={g + 1} o={o} f={f} vel={vel} speed={speed} img={img} />
      ))}
      <Group opacity={flash} blendMode="plus">
        <Atlas image={img} sprites={sprA} transforms={XF} colors={WHITE} colorBlendMode="modulate" />
      </Group>
      <Group opacity={darkA}>
        <Atlas image={img} sprites={sprA} transforms={XF} colors={BLACK} colorBlendMode="modulate" />
      </Group>
      <Group opacity={darkB}>
        <Atlas image={img} sprites={sprB} transforms={XF} colors={BLACK} colorBlendMode="modulate" />
      </Group>
    </Group>
  );
}
const GHOST_OP = [0.45, 0.28, 0.15];
const WHITE = [Skia.Color("white")];

/** Motion-blur "ghost" frame g: steps back g × velocity toward where the lever just left. */
function LeverGhost({ g, o, f, vel, speed, img }: { g: number; o: number; f: SharedValue<number>; vel: SharedValue<number>; speed: SharedValue<number>; img: SkImage }) {
  const spr = useDerivedValue(() => [LEVER[Math.max(0, Math.min(FRAMES - 1, Math.round(f.value - vel.value * g)))]]);
  const op = useDerivedValue(() => o * speed.value);
  return (
    <Group opacity={op}>
      <Atlas image={img} sprites={spr} transforms={XF} />
    </Group>
  );
}
const SHADOW_OFF = [{ translateX: 1.1 }, { translateY: 1.9 }];
const SHEEN_OFF = [{ translateX: -0.4 }, { translateY: -0.6 }];

/**
 * Touch area (RN, transparent) right over the switch on screen: in normal mode it toggles power on / off.
 * Without `fit` (old perf variant): the switch floats in the bottom-right corner as before, drawn in its own small Canvas.
 */
export function Switch({ fit, onToggle, lever, pilot, beckon }: { fit?: Fit; onToggle: () => void; lever?: SharedValue<number>; pilot?: SharedValue<number>; beckon?: SharedValue<number> }) {
  const tap = Gesture.Tap().maxDuration(400).runOnJS(true).onEnd(() => onToggle());
  if (!fit)
    return (
      <GestureDetector gesture={tap}>
        <Canvas style={[styles.legacy, { width: SWITCH.w, height: SWITCH.h }]}>
          {lever && pilot && (
            <Group transform={LEGACY_TF}>
              <SwitchArt lever={lever} pilot={pilot} />
            </Group>
          )}
        </Canvas>
      </GestureDetector>
    );
  const s = SWITCH.hit * fit.k;
  const pos = { left: SWITCH.x * fit.k + fit.ox - s / 2, top: SWITCH.y * fit.k + fit.oy - s / 2, width: s, height: s };
  return (
    <>
      {beckon && <SwitchHint fit={fit} beckon={beckon} />}
      <GestureDetector gesture={tap}>
        <View testID="switch" accessibilityRole="switch" accessibilityLabel="Power switch" collapsable={false} style={[styles.hit, pos]} />
      </GestureDetector>
    </>
  );
}

/** Faint two-line "TAP TO / SWITCH ON" label under the plate when the app opens; fades out after the first flip. */
function SwitchHint({ fit, beckon }: { fit: Fit; beckon: SharedValue<number> }) {
  const intro = useSharedValue(0);
  useEffect(() => {
    intro.value = withDelay(1200, withTiming(1, { duration: 900 }));
  }, [intro]);
  const style = useAnimatedStyle(() => ({ opacity: 0.55 * intro.value * beckon.value }));
  // a small engraved-looking label centred just under the plate (user: "place it tastefully")
  const cx = fit.k * SWITCH.x + fit.ox;
  const top = fit.k * (SWITCH_RECT.y1 + 7) + fit.oy;
  return (
    <Animated.View pointerEvents="none" style={[styles.hint, { left: cx - 60, top, width: 120 }, style]}>
      <Text style={styles.hintText}>{"TAP TO\nSWITCH ON"}</Text>
    </Animated.View>
  );
}

const LEGACY_TF = [{ translateX: SWITCH.w / 2 }, { translateY: SWITCH.h / 2 }, { scale: 1 / SC }, { translateX: -SWITCH.x }, { translateY: -SWITCH.y }];
const styles = StyleSheet.create({
  hit: { position: "absolute" },
  hint: { position: "absolute", alignItems: "center" },
  hintText: {
    color: "rgba(255,236,214,1)",
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: "600",
    letterSpacing: 1.6,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  legacy: { position: "absolute", right: SWITCH.right, bottom: SWITCH.bottom },
});
