import React from "react";
import { BlurMask, Circle, Group, Path, Skia } from "react-native-skia";
import { useAnimatedReaction, useDerivedValue, useSharedValue, type SharedValue } from "react-native-reanimated";
import { NEON } from "./palette";
import { SWITCH } from "../ui/Switch";

/**
 * Ripple on finger tap (select tube, pick colour, flip the switch): ONE thin ring expanding from the fingertip edge 9 → 20 pt (≈ 44 pt
 * on screen at its largest — v60's 84 pt ring was twice the switch size), fading
 * over RIPPLE_T seconds, with a very faint glow of the same radius. 3 slots used round-robin. `rip` = [x, y, t0, colour] × 3 (design pt,
 * scene seconds; colour −1 = white, i = NEON[i], RIP_SWITCH = switch flip).
 *
 * Switch flip (POLISH 02/11, critic: "the tap doesn't read → the screen snaps dark like the app crashed"): its own ring (14 → 25 pt,
 * soft edge, α 0.6, centre clamped inside the frame) + a "pop" on the plate right at cut / power on: soft warm flash + 7 short rays, 0.2 s.
 */
export const RIPPLE_T = 0.4;
export const RIPPLE_SLOTS = 3;
export const RIP_F = 4;
/** colour code of the switch-flip ripple (addRipple(..., RIP_SWITCH)) */
export const RIP_SWITCH = -2;
const SW_T = 0.5;
const POP_T = 0.2;
/** white ring (tube tap / plain tap): fully gone within 0.3 s — the finger lifts after 0.15 s (critic v71: the old ring lingered
 * on the "l" while the finger had already reached the palette → two tap indicators at once) */
const TAP_T = 0.3;
/** switch ring: max radius (design pt ≈ Ø 165 px on the 1320 px image) — previously a hard 66 pt white stroke spilled past the right edge */
const SW_R0 = 14, SW_R1 = 25;
/** visible frame edge (design pt, frame scaled 1.13): the ring centre is clamped so the whole ring stays on screen */
const EDGE_L = 26, EDGE_R = 414;
const RING_HEX = NEON.map((n) => n.hex as string);

export const addRipple = (rip: SharedValue<number[]>, x: number, y: number, t: number, color = -1) => {
  "worklet";
  rip.modify((r) => {
    "worklet";
    // oldest slot
    let best = 0;
    for (let i = 1; i < RIPPLE_SLOTS; i++) if (r[i * RIP_F + 2] < r[best * RIP_F + 2]) best = i;
    r[best * RIP_F] = x;
    r[best * RIP_F + 1] = y;
    r[best * RIP_F + 2] = t;
    r[best * RIP_F + 3] = color;
    return r;
  });
};

/** 7 short rays around the centre (radius 0.45 → 1, unit, shifted upward): scaled over time via transform, no path allocation */
const RAYS = (() => {
  const b = Skia.PathBuilder.Make();
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (k - 3) * 0.62 + (k % 2 ? 0.12 : -0.08);
    const l = k % 2 ? 0.8 : 1;
    b.moveTo(Math.cos(a) * 0.45, Math.sin(a) * 0.45);
    b.lineTo(Math.cos(a) * l, Math.sin(a) * l);
  }
  return b.build();
})();
const HIDDEN = [{ translateX: -9999 }, { translateY: -9999 }, { scale: 1 }];

function Ring({ rip, i, time }: { rip: SharedValue<number[]>; i: number; time: SharedValue<number> }) {
  const big = useDerivedValue(() => rip.value[i * RIP_F + 3] === RIP_SWITCH);
  const d = useDerivedValue(() => time.value - rip.value[i * RIP_F + 2]);
  const u = useDerivedValue(() => {
    const c = rip.value[i * RIP_F + 3];
    return d.value / (big.value ? SW_T : c === -1 ? TAP_T : RIPPLE_T);
  });
  const cx = useDerivedValue(() => {
    const x = rip.value[i * RIP_F];
    const m = big.value ? SW_R1 + 3 : 0;
    return big.value ? Math.max(EDGE_L + m, Math.min(EDGE_R - m, x)) : x;
  });
  const cy = useDerivedValue(() => rip.value[i * RIP_F + 1]);
  const ring = useDerivedValue(() => {
    const c = rip.value[i * RIP_F + 3];
    return c >= 0 ? (RING_HEX[c] ?? "#ffffff") : "#ffffff";
  });
  const r = useDerivedValue(() => {
    const v = Math.min(1, Math.max(0, u.value));
    const e = 1 - (1 - v) * (1 - v) * (1 - v);
    // the switch is 57 × 84 pt (ring 7): the ring expands from outside the lever past the plate edge
    if (big.value) return SW_R0 + (SW_R1 - SW_R0) * e;
    // colour ring = tap on a palette swatch (swatch Ø ~45 screen pt since 02/11): expands outward from the swatch edge, not sunk inside it
    // white ring = tube tap (opens the palette) / plain tap: more visible (critic v70: the tap on "hello" got lost under the heart's flicker)
    return rip.value[i * RIP_F + 3] >= 0 ? 19 + 19 * e : 13 + 23 * e;
  });
  const op = useDerivedValue(() => {
    if (u.value < 0 || u.value >= 1) return 0;
    const k = 1 - u.value;
    if (big.value) return k * 0.6;
    return rip.value[i * RIP_F + 3] === -1 ? k * k * 0.95 : k * Math.sqrt(k) * 0.8;
  });
  const sw = useDerivedValue(() => {
    const v = 1 - Math.min(1, Math.max(0, u.value));
    return big.value ? 1.6 * v + 0.6 : 2.2 * v + 0.7;
  });
  const glowW = useDerivedValue(() => (big.value ? 5 : 4));
  const edgeBlur = useDerivedValue(() => (big.value ? 0.9 : 0.2));
  // tap (white / colour ring): soft bright disc flashing at the tap point for 0.15 s
  const tapOp = useDerivedValue(() => {
    const t = d.value;
    if (big.value || t < 0 || t > 0.15) return 0;
    const k = 1 - t / 0.15;
    return k * k * 0.5;
  });
  // "pop" on the plate (switch-flip ring only): flash + rays
  const popOp = useDerivedValue(() => {
    const t = d.value;
    if (!big.value || t < 0 || t > POP_T) return 0;
    const k = 1 - t / POP_T;
    return k * k;
  });
  const raysTf = useDerivedValue(() => {
    const t = d.value;
    if (!big.value || t < 0 || t > POP_T) return HIDDEN;
    const e = 1 - (1 - t / POP_T) * (1 - t / POP_T);
    return [{ translateX: cx.value }, { translateY: cy.value }, { scale: 10 + 12 * e }];
  });
  // ray stroke ~1.1 pt even though the path is scaled
  const raysW = useDerivedValue(() => {
    const t = Math.max(0, Math.min(1, d.value / POP_T));
    return 1.2 / (10 + 12 * (1 - (1 - t) * (1 - t)));
  });
  return (
    <>
      <Group opacity={op} blendMode="plus">
        <Circle cx={cx} cy={cy} r={r} style="stroke" strokeWidth={sw} color={ring}>
          {/* slightly soft edge on the switch ring (no more hard white ring like a debug layer) */}
          <BlurMask blur={edgeBlur} style="normal" />
        </Circle>
        <Circle cx={cx} cy={cy} r={r} style="stroke" strokeWidth={glowW} color={ring} opacity={0.14}>
          <BlurMask blur={3} style="normal" />
        </Circle>
      </Group>
      <Group opacity={tapOp} blendMode="plus">
        <Circle cx={cx} cy={cy} r={12} color={ring}>
          <BlurMask blur={6} style="normal" />
        </Circle>
      </Group>
      <Group opacity={popOp} blendMode="plus">
        <Circle cx={cx} cy={cy} r={12} color="rgba(255,214,160,0.6)">
          <BlurMask blur={8} style="normal" />
        </Circle>
        <Group transform={raysTf}>
          <Path path={RAYS} style="stroke" strokeWidth={raysW} strokeCap="round" color="#ffe2b8" />
        </Group>
      </Group>
    </>
  );
}

export function Ripples({ rip, time }: { rip: SharedValue<number[]>; time: SharedValue<number> }) {
  return (
    <>
      {Array.from({ length: RIPPLE_SLOTS }, (_, i) => (
        <Ring key={i} rip={rip} i={i} time={time} />
      ))}
    </>
  );
}

/**
 * Virtual finger (demo) — POLISH 02/11 (critic v68: "you never see the finger draw", yet that's the app's core promise):
 *  - iOS screen-recording touch-dot style (critic v70: the grey disc version read as a "grey blob"): Ø 30 screen pt, sharp white ring
 *    2 pt α 0.85 around a soft white core α 0.25; light drop shadow under the ring only, offset 3 pt down-right;
 *  - trail fading ~0.12 s behind the moving finger (6 ghost discs at previous frames' positions, hidden while the finger is still);
 *  - press (scale 0.9 then spring back) on touch down: a tap (ripple) or stroke start (`a` just reached 1); lift =
 *    `a` back to 0 (the scene handles fade timing). Near the switch (≤ 18 pt) 1.3× larger.
 * x, y: design pt (drawn inside the sceneT group); `k` = fit.k to keep the size in screen pt. Demo mode only.
 */
const FD_R = 20; // screen pt (15 was a "tiny grey dot" at mockup size, critic v78)
const TRAIL_N = 7; // stored samples (sample 0 = current frame)
const TRAIL_T = 0.12;
const GHOSTS = [1, 2, 3, 4, 5, 6];

export function FingerDot({ x, y, a, rip, time, k }: { x: SharedValue<number>; y: SharedValue<number>; a: SharedValue<number>; rip: SharedValue<number[]>; time: SharedValue<number>; k: number }) {
  // position history [x, y, t] × TRAIL_N, shifted in place each frame (no allocation); downAt = when `a` just reached 1
  const hist = useSharedValue<number[]>(new Array(TRAIL_N * 3).fill(-1e4));
  const downAt = useSharedValue(-10);
  const wasDown = useSharedValue(false);
  useAnimatedReaction(
    () => time.value,
    (t, prev) => {
      if (prev !== null && t <= prev) return;
      const down = a.value >= 0.999;
      if (down && !wasDown.value) downAt.value = t;
      wasDown.value = down;
      const xv = x.value, yv = y.value;
      hist.modify((h) => {
        "worklet";
        for (let i = TRAIL_N - 1; i > 0; i--) {
          h[i * 3] = h[i * 3 - 3];
          h[i * 3 + 1] = h[i * 3 - 2];
          h[i * 3 + 2] = h[i * 3 - 1];
        }
        h[0] = xv;
        h[1] = yv;
        h[2] = t;
        return h;
      });
    },
  );
  // smaller over the switch: the 20 pt dot covered the lever it flips (critic v80)
  const near = useDerivedValue(() => {
    const dist = Math.hypot(x.value - SWITCH.x, y.value - SWITCH.y);
    return Math.max(0, Math.min(1, 1 - (dist - 18) / 40));
  });
  const R0 = FD_R / k;
  const r = useDerivedValue(() => {
    const R = rip.value;
    let last = downAt.value;
    for (let i = 0; i < RIPPLE_SLOTS; i++) last = Math.max(last, R[i * RIP_F + 2]);
    const d = time.value - last;
    // press: 1 → 0.9 in 0.06 s, then spring back over ~0.2 s
    const press = d >= 0 && d < 0.45 ? 0.1 * Math.sin(Math.min(1, d / 0.06) * Math.PI * 0.5) * Math.exp(-Math.max(0, d - 0.06) / 0.1) : 0;
    return R0 * (1 - 0.25 * near.value) * (1 + 0.12 * (1 - a.value)) * (1 - press);
  });
  const off = 3 / k;
  const sx = useDerivedValue(() => x.value + off);
  const sy = useDerivedValue(() => y.value + off);
  return (
    <Group opacity={a}>
      {/* light drop shadow (ring outline only, not under the disc — the disc turns grey if the shadow sits under the translucent white) */}
      <Circle cx={sx} cy={sy} r={r} style="stroke" strokeWidth={3 / k} color="rgba(0,0,0,0.35)">
        <BlurMask blur={2.5 / k} style="normal" />
      </Circle>
      {GHOSTS.map((j) => (
        <Ghost key={j} j={j} hist={hist} time={time} r={r} />
      ))}
      <Circle cx={x} cy={y} r={r} color="rgba(255,255,255,0.45)">
        <BlurMask blur={1.2 / k} style="normal" />
      </Circle>
      {/* sharp 2 pt white ring, α 0.85 — iOS screen-recording touch-dot style */}
      <Circle cx={x} cy={y} r={r} style="stroke" strokeWidth={2.5 / k} color="rgba(255,255,255,0.92)" />
    </Group>
  );
}

/** Ghost disc j of the trail: position j frames back, smaller + fainter with age; hidden when it overlaps the finger (finger still). */
function Ghost({ j, hist, time, r }: { j: number; hist: SharedValue<number[]>; time: SharedValue<number>; r: SharedValue<number> }) {
  const cx = useDerivedValue(() => hist.value[j * 3]);
  const cy = useDerivedValue(() => hist.value[j * 3 + 1]);
  const gr = useDerivedValue(() => r.value * (0.92 - 0.07 * j));
  const op = useDerivedValue(() => {
    const h = hist.value;
    const age = time.value - h[j * 3 + 2];
    if (age < 0 || age > TRAIL_T) return 0;
    const dist = Math.hypot(h[j * 3] - h[0], h[j * 3 + 1] - h[1]);
    return (1 - age / TRAIL_T) * Math.min(1, dist / (r.value * 0.6)) * 0.5;
  });
  return (
    <Circle cx={cx} cy={cy} r={gr} color="rgba(255,255,255,0.3)" opacity={op}>
      <BlurMask blur={2} style="normal" />
    </Circle>
  );
}
