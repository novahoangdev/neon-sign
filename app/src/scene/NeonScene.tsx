import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { BlurMask, Canvas, TileMode, Path, Skia, Circle, Fill, FilterMode, Group, ImageShader, MipmapMode, Shader, useImage, type SkImage } from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  SensorType,
  useAnimatedSensor,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { runOnUISync, scheduleOnRN } from "react-native-worklets";
import { wall } from "../shaders/wall";
import { grade, steam } from "../shaders/post";
import { rain } from "./rain";
import { DRAW, HORIZON, PUDDLE, REFL_K, TRANSFORMER, VIEW, fitView } from "./layout";
import { catmullPath, distToPoly, type Pts } from "../draw/stroke";
import { FLOW_DUR, SLOTS, flowInfo, linkTubes, makeTube, slotInfo, type FlowInfo, type SlotInfo, type Tube } from "../neon/model";
import { A_K, A_TILE, B_K, B_TILE, renderAtlas } from "../neon/atlas";
import { GAS, NEON_LIN, NEON_RGB } from "../neon/palette";
import { LiveTrail } from "../neon/LiveTrail";
import { Sparks, emitSparks, makeSparks, stepSparks } from "../neon/Sparks";
import { TubeChase } from "../neon/Chase";
import { FingerDot, RIPPLE_SLOTS, RIP_F, RIP_SWITCH, Ripples, addRipple } from "../neon/Ripples";
import { TubeDrops } from "../neon/Drops";
import { brokenGlitch, extinguish, ignite, pickBroken, restrike, steady } from "../neon/flicker";
import { TubeFreeze, TubeGlass, TubeShadow, UnitLit } from "../neon/Tube";
import { ClipsBack, ClipsFront, Electrodes, TubeLink, Wires } from "../neon/Decor";
import { Palette } from "../ui/Palette";
import { SWITCH, Switch, SwitchArt } from "../ui/Switch";
import { fireHaptic, type HapticKind } from "../fx/haptics";
import { initAudio, setHum, sfx, startMusic, type Sfx } from "../fx/audio";
import { DEMO as SCRIPT, demoTilt } from "../demo/script";
import { TIMESCALE, ms, spring } from "./clock";
import { POP_H, POP_W, PopPill, popOrigin, popSwatchX, popSwatchY } from "../ui/PopPalette";
import { INTRO_LEN, INTRO_T0, IntroAir, IntroFx, IntroLens, IntroWall, introBright, introRainK, introWallBright, useIntro } from "../intro/Intro";
import { BeatLens } from "../intro/BeatLens";

/** EXPO_PUBLIC_DEMO=1: the app plays the storyboard by itself for clip recording. */
const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";
/** Clean screen for recording (default in DEMO): no fixed colour bar / text buttons; tapping a tube pops the palette up beside it. */
const CLEAN = DEMO || process.env.EXPO_PUBLIC_CLEAN === "1";
const THIN = 6;
const THICK = 9;
/** delay from lifting the finger until the new tube gets powered (if the lights are on) */
const BORN_DELAY = 0.3;
/** parallax: wall and tubes (~2 cm off the wall) drift with device tilt (pt at tilt = 1) */
const PAR_WALL = 5;
const PAR_TUBE = 6.5;
/** chalk trail fade after lifting the finger (s): coincides with the tube "setting" along the stroke */
const TRAIL_FADE = 0.45;

const sceneAssets = {
  ambient: require("../../assets/scene/ambient.jpg"),
  albedo: require("../../assets/scene/albedo.jpg"),
  normal: require("../../assets/scene/normal.png"),
  data: require("../../assets/scene/data.png"),
  parts: require("../../assets/sprites/parts.png"),
};

const LINEAR = { filter: FilterMode.Linear, mipmap: MipmapMode.None };

const clamp = (v: number, a: number, b: number) => {
  "worklet";
  return Math.max(a, Math.min(b, v));
};

type Auto = { at: number; si: number; pts: Pts; speed: number; len: number; cum: number[] };
type Tf = ({ translateX: number } | { translateY: number })[];
type RecPlan = ({ ax: number; ay: number; ox: number; oy: number; wx: number; wy: number; from: number } | null)[];
/**
 * Lightning (demo, while the alley is dark), d = seconds since the strike: white flash for exactly 2 frames (hard on/off, no fade), full dark, then
 * a 50 % after-flash at +160 ms, 2 frames. Between the flashes the wall stays dark as before.
 */
const boltAt = (d: number) => {
  "worklet";
  // flash: 2 frames full then a 3-frame decay (1–2 frame blips read as glitches at 30 fps), echo at +160 ms likewise
  if (d < 0 || d >= 0.29) return 0;
  if (d < 0.05) return 1; // 3 full frames (critic 5: 2 frames still read as one glitched frame at 30 fps)
  if (d < 0.1) return Math.exp(-(d - 0.05) / 0.025);
  if (d < 0.16) return 0;
  if (d < 0.193) return 0.25; // v87: echo 0.5 → 0.25 (read as a second flash that re-lit the blackout, critic v86)
  return 0.25 * Math.exp(-(d - 0.193) / 0.03);
};
/** hard shadow of tubes / cables during a flash: source at top left → shadow offset down-right (tube ~2 cm off the wall, pt) */
const BOLT_SHADOW = [{ translateX: 6 }, { translateY: 8.5 }];
/** the flash is a big but distant source: crisp-ish shadow, not a cut-out (blur 3.5 pt) */
const BOLT_SHADOW_PAINT = (() => {
  const p = Skia.Paint();
  p.setImageFilter(Skia.ImageFilter.MakeBlur(3.5, 3.5, TileMode.Decal, null));
  return p;
})();
const BOLTS = DEMO ? (SCRIPT.lightning ?? []).map((l) => l.at) : [];
/** glass highlight offset toward the flash (top-left) */
const BOLT_HL = [{ translateX: -1.1 }, { translateY: -1.3 }];
/** scene time of the invisible strobe warm-up draw (calm, lights on, before the storm) */
const BOLT_WARM = 1.4;
const CHASE = DEMO ? (SCRIPT.chase ?? []) : [];
/** tube that pulses to the beat (demo: the heart) */
const BEAT_TUBE = 1;
const PULSE = DEMO ? SCRIPT.pulse : null;
const FINALE = DEMO ? (SCRIPT.finale?.at ?? -1) : -1;
/** finale blackout before the relight (s) */
const FINALE_GAP = 0; // no second blackout: it repeated the switch-off gag (critic 6)
const END_T = SCRIPT.end;
/** gas flow time when changing colour on the beat (s) */
const QUICK_FLOW = 0.25;
/** pulse markers along tube i (precomputed: a new array every render breaks the memo) */
const CHASE_DUR = CHASE.map((c) => c.dur);
const CHASE_AT = Array.from({ length: 16 }, (_, i) => CHASE.map((c) => c.at + i * c.stagger));
const CHASE_AT_0 = CHASE.map((c) => c.at);
/** beat pulse on the end card: brightness multiplier */
const beatAt = (t: number) => {
  "worklet";
  if (!PULSE || t < PULSE.from) return 1;
  // ~4 frame attack: an instant ×1.8 step read as a one-frame flash on every beat (critic v77, 9.52 / 10.0)
  const A = 0.06;
  const peak = 1 + PULSE.amp;
  if (t > PULSE.to) {
    // leave the pulse by easing from the last trough back to 1 over 0.12 s (was a hard step right on the finale
    // downbeat; v78 with 40 ms still jumped +4.8 luma in one frame)
    const d = t - PULSE.to, X = 0.12;
    if (d >= X) return 1;
    const lo = PULSE.low + (peak - PULSE.low) * Math.exp(-(PULSE.period - A) / 0.11);
    const u = d / X;
    return lo + (1 - lo) * u * u * (3 - 2 * u);
  }
  const ph = (t - PULSE.from) % PULSE.period;
  // flare on the beat then settle to `low` (tube brightness is capped at 1 → the contrast lives in the quiet part)
  if (ph < A) {
    const from = t - PULSE.from < A ? 1 : PULSE.low + (peak - PULSE.low) * Math.exp(-(PULSE.period - A) / 0.11);
    return from + (peak - from) * (ph / A);
  }
  return PULSE.low + (peak - PULSE.low) * Math.exp(-(ph - A) / 0.11);
};
/** top of the transformer box (design pt): where the spark burst shoots out on power-up */
/** the recolour palette closes at d = POP_CLOSE s after the swatch tap (opened by the tube tap at d = −0.45): the spring starts retracting at
 * d ≈ 0.35 → the picked swatch stays visible ~0.4 s (critic v72: at 1 s the palette lingered too long) */
const POP_CLOSE = 1.0; // v11: +0.25 s (critics v83/v85: palette too brief at mockup size)
// was 0.75 (critic 7: 0.45 left the swatches on screen ~0.6 s — too brief at mockup size
const BOX_TOP = [(TRANSFORMER[0] + TRANSFORMER[2]) / 2, TRANSFORMER[1] + 2];
/** Point on a polyline (with cumulative length `cum`) at length L → written to out. */
const pointAt = (pts: number[], cum: number[], L: number, out: number[]) => {
  "worklet";
  let lo = 0, hi = cum.length - 1;
  if (L <= 0) {
    out[0] = pts[0];
    out[1] = pts[1];
    return;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < L) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const w = seg > 0 ? Math.min(1, Math.max(0, (L - cum[lo]) / seg)) : 0;
  out[0] = pts[lo * 2] + (pts[hi * 2] - pts[lo * 2]) * w;
  out[1] = pts[lo * 2 + 1] + (pts[hi * 2 + 1] - pts[lo * 2 + 1]) * w;
};
type Poly = { pts: number[]; cum: number[] };
const polyOf = (t: Tube): Poly => {
  const cum = [0];
  for (let k = 2; k < t.pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(t.pts[k] - t.pts[k - 2], t.pts[k + 1] - t.pts[k - 1]));
  // polyline length ≈ path length; normalise to tube.len to match the segments' `a`, `b`
  const k = cum[cum.length - 1] > 0 ? t.len / cum[cum.length - 1] : 1;
  return { pts: t.pts, cum: cum.map((v) => v * k) };
};

/** sparks reflected only on the water: an oval shaped to the puddle mask (data.b), not spilling onto the dry ground around it */
const PUDDLE_CLIP = Skia.RRectXY(Skia.XYWHRect(PUDDLE[0] + 36, PUDDLE[1] - 1, PUDDLE[2] - PUDDLE[0] - 36, PUDDLE[3] - PUDDLE[1]), 70, 40);
const SPARK_MIRROR = [{ translateY: HORIZON * (1 + 1 / REFL_K) }, { scaleY: -1 / REFL_K }];
/** cascade power-up: each tube segment (in draw order) ignites this many seconds after the previous one */
const CASCADE_STEP = 0.07; // relight in ~0.8 s (0.17: the dark/relight section dragged, critic 4)

const reportErr = (m: string) => console.error("NEONERR " + m);

/** Writes the lightning flash into the wall uniforms in place (wall.ts boltLight). */
const setBolt = (u: { bolt: number }, v: number) => {
  "worklet";
  u.bolt = v;
};
/** Writes time / brightness / colour / tilt into the uniform object in place (no allocation). */
const feedU = (u: { time: number; bright?: number[]; col?: number[]; tilt?: number[] }, t: number, b: number[] | null, c: number[] | null, tl: number[] | null) => {
  "worklet";
  u.time = t;
  if (b) u.bright = b;
  if (c) u.col = c;
  if (tl) u.tilt = tl;
};

/** Tubes present when the app opens in demo mode (sign already lit on the first frame). */
const preTubes = (): Tube[] => {
  if (!DEMO) return [];
  const out: Tube[] = [];
  for (const s of SCRIPT.strokes) {
    if (!s.pre) continue;
    const t = makeTube(s.pts, s.color, s.width, s.at, s.splits, true, s.startedAt ?? s.at);
    if (t) out.push(linkTubes(out[out.length - 1], t));
  }
  return out;
};
const PRE_LIT = DEMO && SCRIPT.strokes.some((s) => s.pre) && !SCRIPT.openDark;
const STORM = DEMO ? (SCRIPT.storm ?? null) : null;
/** shared [x, y] translation, mutated in place every frame */
const tf = (x = 0, y = 0): Tf => [{ translateX: x }, { translateY: y }];
const setTf = (v: Tf, x: number, y: number) => {
  "worklet";
  (v[0] as { translateX: number }).translateX = x;
  (v[1] as { translateY: number }).translateY = y;
};

export function NeonScene() {
  const ambient = useImage(sceneAssets.ambient);
  const albedo = useImage(sceneAssets.albedo);
  const normal = useImage(sceneAssets.normal);
  const data = useImage(sceneAssets.data);
  const parts = useImage(sceneAssets.parts);
  const ready = !!(ambient && albedo && normal && data && parts);

  const [size, setSize] = useState({ w: VIEW.w, h: VIEW.h });
  const fit = useMemo(() => fitView(size.w, size.h), [size]);
  const fitS = useSharedValue(fit);
  useEffect(() => fitS.set(fit), [fit, fitS]);

  const [tubes, setTubes] = useState<Tube[]>(preTubes);
  const tubesRef = useRef<Tube[]>([]);
  useEffect(() => {
    tubesRef.current = tubes;
  }, [tubes]);
  const geomKey = tubes.map((t) => `${t.id}:${t.width}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const atlas = useMemo(() => renderAtlas(tubes), [geomKey]);
  const [color, setColor] = useState(0);
  const [thick, setThick] = useState(false);
  /** demo: chalk trail colour = colour of the stroke being drawn (not the colour selected on the palette) */
  const [trailColor, setTrailColor] = useState(0);

  // ── clock, power, tilt ──
  const time = useSharedValue(INTRO_T0);
  /**
   * Scene time read from the JS thread: read SYNCHRONOUSLY on the UI thread. `time.get()` on JS is an async-synced copy — under load it
   * lags hundreds of ms → a new tube appears already "grown" (losing the setting effect), the colour gas flow starts midway, the first
   * flicker on power-up gets swallowed. Events called from a worklet pass that frame's `t` directly.
   */
  const nowUI = useCallback(() => runOnUISync(() => {
    "worklet";
    return time.value;
  }), [time]);
  const power = useSharedValue(PRE_LIT ? 1 : 0);
  const powerAt = useSharedValue(-10);
  const offAt = useSharedValue(-10);
  const powerN = useSharedValue(PRE_LIT ? 1 : 0);
  const lever = useSharedValue(PRE_LIT ? 1 : 0);
  const uiFade = useSharedValue(1);
  /** normal app: the switch beckons (blinking LED, halo, hint text) until the user flips it once */
  const beckon = useSharedValue(DEMO ? 0 : 1);
  const tilt = useSharedValue<number[]>([0, 0]);
  const tiltU = useSharedValue<[number, number] | null>(null); // two-finger drag (dev) fakes tilt
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 16 });
  const grav0 = useSharedValue<number | null>(null);

  // ── per-slot light ──
  // arrays allocated once, mutated in place every frame then .modify() to signal changes (no allocation in worklets)
  const bright = useSharedValue<number[]>(new Array(SLOTS).fill(0));
  /** [born, readyAt] per slot: when each unit's lit layer finished mounting (UnitLit) */
  const litReady = useSharedValue<number[]>(new Array(SLOTS * 2).fill(-1e9));
  /** intro: slot brightness for light on the wall / mist / rain (smooth, not following each tube flicker) */
  const brightW = useSharedValue<number[]>(new Array(SLOTS).fill(0));
  const colLin = useSharedValue<number[]>(new Array(SLOTS * 3).fill(0));
  const slots = useSharedValue<SlotInfo>([]);
  const flows = useSharedValue<FlowInfo>([]);
  const prevB = useSharedValue<number[]>(new Array(SLOTS).fill(0));
  const lastHap = useSharedValue(-10);
  const lastGlitch = useSharedValue(0);
  const humV = useSharedValue(0);
  const humT = useSharedValue(-10);
  useEffect(() => {
    initAudio();
    // chill background loop for normal use; the scripted demo / showcase recordings keep their own mixed soundtrack
    if (!DEMO) startMusic();
  }, []);
  const polys = useSharedValue<Poly[]>([]);
  const slotPos = useSharedValue<number[]>(new Array(SLOTS * 2).fill(-999));
  const broken = useSharedValue<{ at: number; k: number; kind: number }[]>([]);
  useEffect(() => {
    slots.set(slotInfo(tubes));
    flows.set(flowInfo(tubes));
    // polyline per tube (sparks along the gas front) + midpoint per segment (sparks when a segment ignites)
    const ps = tubes.map(polyOf);
    polys.set(ps);
    const sp = new Array(SLOTS * 2).fill(-999);
    const o = [0, 0];
    tubes.forEach((t, ti) =>
      t.units.forEach((u) => {
        pointAt(ps[ti].pts, ps[ti].cum, (u.a + u.b) / 2, o);
        sp[u.k * 2] = o[0];
        sp[u.k * 2 + 1] = o[1];
      }),
    );
    slotPos.set(sp);
    if (DEMO) {
      broken.set(
        SCRIPT.broken.flatMap((b) => {
          // empty unit = whole tube
          const us = b.unit === undefined ? (tubes[b.tube]?.units ?? []) : [tubes[b.tube]?.units[b.unit]].filter((u) => !!u);
          return us.map((u) => ({ at: b.at, k: u!.k, kind: b.kind === "restrike" ? 1 : 0 }));
        }),
      );
    }
  }, [tubes, slots, flows, broken, polys, slotPos]);

  // ── drawing ──
  const pts = useSharedValue<Pts>([]);
  const drawing = useSharedValue(false);
  const drawAt = useSharedValue(0);
  const brushW = useSharedValue(THIN);
  useEffect(() => brushW.set(thick ? THICK : THIN), [thick, brushW]);
  // virtual finger (design coordinates)
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const fa = useSharedValue(0);
  /** seconds when the virtual finger lifted off the stroke (−1 = no fade) */
  const fOff = useSharedValue(-1);
  /** seconds when the finger lifted off the stroke: the chalk trail fades over TRAIL_FADE instead of cutting out (no more empty frame before the tube grows) */
  const liveOffAt = useSharedValue(-10);
  // ── effects: sparks, ripples ──
  const sparks = useSharedValue(makeSparks());
  const sparkT = useSharedValue(INTRO_T0);
  const sparkAcc = useSharedValue(0);
  const burstLeft = useSharedValue(0);
  const lastBurst = useSharedValue(-10);
  const rip = useSharedValue<number[]>(new Array(RIPPLE_SLOTS * RIP_F).fill(-10));
  const trailCol = useSharedValue(0);
  const tmpPt = useSharedValue<number[]>([0, 0]);
  const tipX = useSharedValue(-99);
  const tipY = useSharedValue(-99);
  const liveEnd = useSharedValue(1);
  // pop-up palette (screen pt)
  const popShow = useSharedValue(0);
  const popX = useSharedValue(0);
  const popY = useSharedValue(0);
  const popActive = useSharedValue(0);
  const recPlan = useSharedValue<RecPlan>([]);
  const auto = useSharedValue<Auto[]>([]);
  const errOnce = useSharedValue(false);
  const autoIdx = useSharedValue(0);
  /** number of recolour phases run (2 per change: tube tap, swatch tap) and number of switch flips run */
  const recStep = useSharedValue(0);
  const trailSi = useSharedValue(-1);
  const swStep = useSharedValue(0);
  /** the most recent power-up was a cascade */
  const cascade = useSharedValue(false);
  const wirePw = useMemo(() => ({ power, powerAt, offAt, cascade, step: CASCADE_STEP, bornDelay: BORN_DELAY, chase: CHASE, finale: FINALE }), [power, powerAt, offAt, cascade]);
  const selected = useRef<number | null>(null);

  const commit = useCallback(
    (p: Pts, opts?: { color?: number; width?: number; splits?: number[]; raw?: boolean; startedAt?: number; at?: number }) => {
      const born = (opts?.at ?? nowUI()) + 0.02;
      const t = makeTube(p, opts?.color ?? color, opts?.width ?? (thick ? THICK : THIN), born, opts?.splits, opts?.raw, opts?.startedAt);
      if (!t) return;
      setTubes((ts) => [...ts, linkTubes(ts[ts.length - 1], t)]);
      selected.current = tubesRef.current.length;
      fireHaptic("light");
      sfx("freeze");
    },
    [color, thick, nowUI],
  );
  const commitDemo = useCallback(
    (i: number, at: number) => {
      const s = SCRIPT.strokes[i];
      commit(s.pts, { color: s.color, width: s.width, splits: s.splits, raw: true, startedAt: s.startedAt ?? s.at, at });
    },
    [commit],
  );

  const recolor = useCallback(
    (ti: number, c: number, at?: number, dur?: number) => {
      const flowAt = at ?? nowUI();
      const flowDur = dur ?? FLOW_DUR;
      setTubes((ts) => ts.map((t, i) => (i === ti && t.color !== c ? { ...t, prev: t.color, color: c, flowAt, flowDur } : t)));
      fireHaptic("medium");
      if (power.get() > 0.5) sfx("flow");
    },
    [nowUI, power],
  );

  /** Audio / haptic / UI side of a switch flip (JS thread). Power state was already changed beforehand (`toggle` or demo). */
  const toggleFx = useCallback((on: boolean) => {
    uiFade.set(withTiming(on ? 0.4 : 1, { duration: ms(on ? 1200 : 300) }));
    lever.set(withSpring(on ? 1 : 0, spring({ damping: 11, stiffness: 420, mass: 0.6 })));
    fireHaptic("heavy");
    sfx(on ? "switch_on" : "switch_off");
    if (!on) setHum(0);
    setTimeout(() => fireHaptic("medium"), ms(70));
  }, [lever, uiFade]);
  const toggle = useCallback((at?: number, cascadeOn = false) => {
    const now = at ?? nowUI();
    const on = power.get() < 0.5;
    power.set(on ? 1 : 0);
    if (beckon.get() > 0) beckon.set(withTiming(0, { duration: ms(500) }));
    if (on) {
      cascade.set(cascadeOn);
      powerAt.set(now);
      powerN.set(powerN.get() + 1);
    } else offAt.set(now);
    toggleFx(on);
  }, [power, powerAt, powerN, offAt, nowUI, cascade, toggleFx, beckon]);

  const onColor = useCallback(
    (i: number, at?: number) => {
      // demo: pen colour unused (scripted strokes carry their own colour) — skip setColor to avoid rebuilding commit / gestures / the whole scene
      // right while gas is flowing (v50: every tap recolour stalled 4–6 frames; the disco beat without setColor didn't)
      if (!DEMO) setColor(i);
      const s = selected.current;
      if (s !== null && tubesRef.current[s]) recolor(s, i, at);
      else fireHaptic("select");
    },
    [recolor],
  );
  const undo = useCallback(() => {
    setTubes((ts) => ts.slice(0, -1));
    selected.current = null;
    fireHaptic("light");
  }, []);
  const clear = useCallback(() => {
    setTubes([]);
    selected.current = null;
    fireHaptic("medium");
  }, []);
  const selectAt = useCallback((x: number, y: number) => {
    const ts = tubesRef.current;
    let best = -1, bd = 22;
    ts.forEach((t, i) => {
      const d = distToPoly(t.pts, x, y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    selected.current = best >= 0 ? best : null;
    if (best >= 0) fireHaptic("select");
  }, []);

  useEffect(() => {
    if (!DEMO) return;
    auto.set(
      SCRIPT.strokes.flatMap((s, si) => {
        if (s.pre) return [];
        const cum = [0];
        for (let k = 2; k < s.pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(s.pts[k] - s.pts[k - 2], s.pts[k + 1] - s.pts[k - 1]));
        return [{ at: s.at, si, pts: s.pts, speed: s.speed, len: cum[cum.length - 1], cum }];
      }),
    );
  }, [auto]);

  // ── clock: runs only once the scene image has loaded ──
  const t0 = useSharedValue(-1);
  const readyAt = useSharedValue(-1);
  const lastTs = useSharedValue(0);
  const smoothN = useSharedValue(0);
  const readyS = useSharedValue(false);
  useEffect(() => readyS.set(ready), [ready, readyS]);
  const tubeAnchors = useMemo(() => tubes.map((t) => [t.pts[Math.floor(t.pts.length / 4) * 2], t.pts[Math.floor(t.pts.length / 4) * 2 + 1]]), [tubes]);
  const anchorsS = useSharedValue<number[][]>([]);
  useEffect(() => anchorsS.set(tubeAnchors), [tubeAnchors, anchorsS]);
  // demo recolour plan (coordinates precomputed on JS whenever tubes / frame change)
  useEffect(() => {
    if (!DEMO) return;
    const o = [0, 0];
    recPlan.set(
      SCRIPT.recolor.map((ev) => {
        const an = tubeAnchors[ev.tube];
        if (!an) return null;
        const sx = an[0] * fit.k + fit.ox, sy = an[1] * fit.k + fit.oy;
        popOrigin(sx, sy, size.w, o);
        // place along the top / bottom edge of the whole tube, ≥ 24 screen pt from EVERY tube (selected one included), measured from the tube body edge;
        // if nowhere is clear, keep the old position by the tap point
        const CLR = 24;
        const box = (t: Tube) => {
          let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9;
          for (let k = 0; k < t.pts.length; k += 2) {
            x0 = Math.min(x0, t.pts[k]);
            x1 = Math.max(x1, t.pts[k]);
            y0 = Math.min(y0, t.pts[k + 1]);
            y1 = Math.max(y1, t.pts[k + 1]);
          }
          const m = t.width / 2;
          return [(x0 - m) * fit.k + fit.ox - CLR, (y0 - m) * fit.k + fit.oy - CLR, (x1 + m) * fit.k + fit.ox + CLR, (y1 + m) * fit.k + fit.oy + CLR];
        };
        const all = tubes.map(box);
        const me = all[ev.tube];
        const free = (ox: number, oy: number, b: number[]) => ox + POP_W <= b[0] || ox >= b[2] || oy + POP_H <= b[1] || oy >= b[3];
        const clear = (ox: number, oy: number) =>
          ox >= 10 && ox + POP_W <= size.w - 10 && oy > 60 && oy + POP_H < size.h - 140 && all.every((b) => free(ox, oy, b));
        // preference: above the tube, below it (centred on the tube), then right / left of it (top-aligned)
        // fallback: below all tubes (empty space on the ground), then above all tubes
        const lowY = Math.max(...all.map((b) => b[3])), topY = Math.min(...all.map((b) => b[1])) - POP_H;
        const midX = Math.max(14, Math.min(size.w - 14 - POP_W, (me[0] + me[2]) / 2 - POP_W / 2));
        const cands: [number, number][] = [
          [midX, me[1] - POP_H - 30], // 30 pt higher: don't crowd the tops of the "l" strokes
          [midX, me[3]],
          [me[2], me[1]],
          [me[0] - POP_W, me[1]],
          // above every tube before the ground: the palette then opens in the same spot every time (critic v78: top
          // the first time, bottom the second)
          [midX, topY],
          [midX, lowY],
        ];
        const pick = cands.find(([x, y]) => clear(x, y));
        if (pick) {
          o[0] = pick[0];
          o[1] = pick[1];
        }
        const wx = (popSwatchX(ev.color, o[0]) - fit.ox) / fit.k, wy = (popSwatchY(o[1]) - fit.oy) / fit.k;
        return { ax: an[0], ay: an[1], ox: o[0], oy: o[1], wx, wy, from: tubes[ev.tube].color };
      }),
    );
  }, [tubeAnchors, tubes, fit, size.w, size.h, recPlan]);
  const swPos = useMemo(
    // wall-mounted switch (design pt): the finger touches the lever, slightly above the plate centre
    () => [SWITCH.x, SWITCH.y - 3],
    [],
  );
  const swPosS = useSharedValue(swPos);
  useEffect(() => swPosS.set(swPos), [swPos, swPosS]);

  // uniforms + translation: one object for the scene's lifetime, mutated in place every frame
  const imgK = ambient ? ambient.width() / VIEW.w : 1;
  const wallU = useSharedValue({
    bright: bright.value,
    col: colLin.value,
    view: [VIEW.w, VIEW.h],
    aTile: A_TILE,
    aK: A_K,
    imgK,
    bTile: B_TILE,
    bK: B_K,
    horizon: HORIZON,
    reflK: REFL_K,
    time: 0,
    gain: 3.2,
    bolt: 0,
    ambK: 1,
    relief: 0.9,
    tilt: tilt.value,
  });
  useEffect(() => wallU.set({ ...wallU.get(), imgK }), [imgK, wallU]);
  const steamU = useSharedValue({
    bright: bright.value,
    col: colLin.value,
    view: [VIEW.w, VIEW.h],
    aTile: A_TILE,
    aK: A_K,
    horizon: HORIZON,
    time: 0,
    haze: 0.05,
    density: 1.0,
  });
  const gradeU = useSharedValue({ view: [VIEW.w, VIEW.h], time: 0 });
  const rainU = useSharedValue({
    bright: bright.value,
    col: colLin.value,
    view: [VIEW.w, VIEW.h],
    aTile: A_TILE,
    aK: A_K,
    horizon: HORIZON,
    time: 0,
    amount: 1.0,
    flash: 0,
  });
  const { plan: introPlan, cam: introCam, geo: introGeo } = useIntro(tubes, time);
  const wallT = useSharedValue<Tf>(tf());
  const tubeT = useSharedValue<Tf>(tf());
  const shadowT = useSharedValue<Tf>(tf(2.2, 3.4));
  const hlT = useSharedValue<Tf>(tf(-1.1, -1.1));

  // declared before useFrameCallback: the worklets plugin turns functions into consts (not hoisted)
  const frame = (timestamp: number) => {
    "worklet";
    if (!readyS.value) return;
    // Scene clock holds at 0 until the first draw (shader compile, baked image load) is done: the demo needs ≥ 1.5 real s since
    // the scene is ready AND 45 consecutive smooth frames (< 25 ms) → demo second 0 is always a fully lit, still sign.
    if (t0.value < 0) {
      if (readyAt.value < 0) readyAt.set(timestamp);
      const dt = timestamp - lastTs.value;
      lastTs.set(timestamp);
      smoothN.set(dt > 0 && dt < 25 ? smoothN.value + 1 : 0);
      if (!DEMO || (timestamp - readyAt.value > 1500 && smoothN.value >= 45)) t0.set(timestamp + (DEMO ? 100 : 150));
    }
    // intro: the clock starts at −INTRO_LEN (held there until the scene is ready), demo second 0 unchanged
    const t = t0.value < 0 ? INTRO_T0 : Math.max(INTRO_T0, ((timestamp - t0.value) / 1000) * TIMESCALE + INTRO_T0);
    time.set(t);
    let bolt = 0;
    for (let i = 0; i < BOLTS.length; i++) bolt = Math.max(bolt, boltAt(t - BOLTS[i]));
    // lightning (source top left, far) → tube / cable shadows jump farther, down-right exactly during flash frames
    const bs = bolt > 0.02 ? 1 : 0;

    // tilt
    const tl = tilt.value;
    const tu = tiltU.value;
    if (tu) {
      tl[0] = tu[0];
      tl[1] = tu[1];
    } else if (DEMO) demoTilt(t, tl);
    else if (gravity.isAvailable) {
      const g = gravity.sensor.value;
      if (grav0.value === null && (g.x !== 0 || g.y !== 0)) grav0.set(g.y);
      const base = grav0.value ?? g.y;
      grav0.set(base + (g.y - base) * 0.003);
      const tx = clamp((g.x / 9.81) * 2.6, -1, 1);
      const ty = clamp(((g.y - base) / 9.81) * 2.6, -1, 1);
      tl[0] += (tx - tl[0]) * 0.15;
      tl[1] += (ty - tl[1]) * 0.15;
    }
    tilt.modify();
    setTf(wallT.value, -tl[0] * PAR_WALL, -tl[1] * PAR_WALL);
    wallT.modify();
    setTf(tubeT.value, -tl[0] * PAR_TUBE, -tl[1] * PAR_TUBE);
    tubeT.modify();
    setTf(shadowT.value, 2.2 + tl[0] * 2.2 + bs * 3.8, 3.4 + tl[1] * 1.8 + bs * 5.1);
    shadowT.modify();
    setTf(hlT.value, -1.1 + tl[0] * 1.3, -1.1 + tl[1] * 1.0);
    hlT.modify();

    // per-slot brightness + colour
    const S = slots.value;
    const F = flows.value;
    const b = bright.value;
    const c = colLin.value;
    b.fill(0);
    c.fill(0);
    const on = power.value > 0.5;
    const brk = broken.value;
    // random tube failures: normal mode, or after the demo script ends (doesn't shift clip timing)
    const randomBroken = !DEMO || t > SCRIPT.end + 1;
    const badK = S.length > 2 && randomBroken ? S[pickBroken(S.length, powerN.value)].k : -1;
    const IP = introPlan.value;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      let v = 0;
      if (on) {
        const fl = F[s.tube];
        // multi-unit strokes (star, underline) strike unit by unit along the tube (0.22 s across the whole tube)
        // instead of all at once — critic v77: the star's ignition repeated the heart's blink
        const sweep = fl && fl.len > 0 ? (s.a / fl.len) * 0.22 : 0;
        let start = Math.max(powerAt.value + (cascade.value ? i * CASCADE_STEP : 0), s.born + BORN_DELAY + sweep);
        // a freshly drawn tube ignites only once its lit layer is mounted (no lit reflection under a dark tube)
        if (s.born >= 0) {
          const R = litReady.value;
          start = R[s.k * 2] === s.born ? Math.max(start, R[s.k * 2 + 1] + 0.05 + sweep) : 1e9;
        }
        v = ignite(t - start, s.k * 7.13 + powerN.value * 3.7 + s.born, GAS[fl ? fl.to : 0]) * steady(t, s.k) * beatAt(t);
        // pulses running along the tube + finale flash also light the wall / puddle (brightness > 1 only affects lighting)
        if (fl) {
          for (let j = 0; j < CHASE.length; j++) {
            const ch = CHASE[j];
            const u = (t - ch.at - s.tube * ch.stagger) / ch.dur;
            if (u < 0 || u > 1.2) continue;
            const hp = u * fl.len;
            {
              // wall / puddle spill follows the comet, eased in/out over ~8 % of the tube (a hard ×1.7 popped in one frame)
              const w = fl.len * 0.26, e = fl.len * 0.08;
              const kin = Math.min(1, Math.max(0, (hp - s.a) / e)), kout = Math.min(1, Math.max(0, (s.b - (hp - w)) / e));
              v *= 1 + 0.7 * kin * kout;
            }
          }
        }
        // finale: the sign drops out for 6 frames (the beat breathes in), then every tube relights together on the
        // downbeat, overdriven ×1.9 and settling with τ 0.2 s (>1 only drives the light on wall / puddle)
        if (FINALE >= 0) {
          const df = t - FINALE;
          if (FINALE_GAP > 0 && df >= -FINALE_GAP && df < 0) v *= 0.03;
          // power-surge stutter: two 2-frame dips right before the downbeat, then the swell lands on the hit (critic v86:
          // "the ending lands on nothing")
          else if ((df >= -0.15 && df < -0.115) || (df >= -0.07 && df < -0.035)) v *= 0.3;
          else if (df >= 0 && df < 1.5) v *= 1 + 0.4 * (df < 0.12 ? df / 0.12 : Math.exp(-(df - 0.12) / 0.6)); // v84: 0.4 — v81 0.22 left "no payoff" (critic v83); the white blow-out was the comets + white core, both gone // 4-frame ramp, cap ×1.3 (×1.9 clipped "hello" to white, critic 3)
        }
        if (s.k === badK) v *= brokenGlitch(t - start, powerN.value * 5.1, GAS[fl ? fl.to : 0]);
        for (let j = 0; j < brk.length; j++) {
          if (brk[j].k !== s.k) continue;
          const d = t - brk[j].at;
          if (brk[j].kind === 1) v *= restrike(d, GAS[fl ? fl.to : 0]);
          else if ((d >= 0 && d < 0.07) || (d > 0.16 && d < 0.2)) v *= 0.05;
        }
      } else {
        const fo = F[s.tube];
        v = extinguish(t - offAt.value, GAS[fo ? fo.to : 0]) * (offAt.value > powerAt.value ? 1 : 0);
      }
      b[s.k] = introBright(t, IP, s.k, v);
      const f = F[s.tube];
      let mixN = 1;
      if (f && f.at >= 0) {
        const p = clamp((t - f.at) / f.dur, 0, 1);
        mixN = clamp((p * f.len - s.a) / Math.max(1, s.b - s.a), 0, 1);
      }
      const ca = NEON_LIN[f ? f.from : 0], cb = NEON_LIN[f ? f.to : 0];
      for (let j = 0; j < 3; j++) c[s.k * 3 + j] = ca[j] + (cb[j] - ca[j]) * mixN;
    }
    // light haptic on every ignition beat
    const pb = prevB.value;
    let rise = false;
    for (let k = 0; k < SLOTS; k++) if (pb[k] < 0.3 && b[k] > 0.45) rise = true;
    if (rise && t - lastHap.value > 0.05) {
      lastHap.set(t);
      scheduleOnRN(fireHaptic, "light" as HapticKind);
      scheduleOnRN(sfx, "flick" as Sfx, t - powerAt.value < 2 ? 1 : 0.7);
    }
    // ── sparks ──
    const dtS = Math.min(0.05, Math.max(0, t - sparkT.value));
    sparkT.set(t);
    const SP = slotPos.value;
    const PL = polys.value;
    const drawingNow = drawing.value;
    const tx0 = tipX.value, ty0 = tipY.value;
    const tc = NEON_RGB[trailCol.value] ?? NEON_RGB[0];
    const burst = on && lastBurst.value !== powerAt.value && t >= powerAt.value;
    if (burst) lastBurst.set(powerAt.value);
    const pt = tmpPt.value;
    sparks.modify((st) => {
      "worklet";
      // sparkler at the pen tip
      if (drawingNow && dtS > 0) {
        const acc = sparkAcc.value + dtS * 70; // 200/s read as a "magic wand" (critic 8)
        const n = Math.floor(acc);
        sparkAcc.set(acc - n);
        emitSparks(st, tx0, ty0, n, -Math.PI / 2, 3.8, 60, 300, 0.3, 0.75, tc[0], tc[1], tc[2], 1.0);
      }
      // finale: no more sparks from every slot (the radiating needle burst read like a stock starburst filter — feedback 02/11)
      // power-up: burst spread over ~6 frames (spawned on one frame → colours add up to a burnt-white blob)
      // POLISH 02/11: 8 short sparks ~0.15 s (v60: ~40 long ones like fireworks) — the cascade re-light is the real climax
      if (burst) burstLeft.set(6);
      const bl = burstLeft.value;
      if (bl > 0) {
        const n = Math.min(bl, 14);
        burstLeft.set(bl - n);
        emitSparks(st, BOX_TOP[0], BOX_TOP[1], n, -Math.PI / 2, 2.4, 110, 220, 0.12, 0.17, 1, 0.74, 0.38, 1.0, 5);
        emitSparks(st, BOX_TOP[0], BOX_TOP[1] + 14, Math.ceil(n / 3), Math.PI / 2, 3.0, 60, 140, 0.1, 0.15, 1, 0.86, 0.6, 0.9, 5);
      }
      // each beat a tube segment ignites: a few small sparks at the segment midpoint
      let nr = 0;
      for (let i = 0; i < S.length && nr < 3; i++) {
        const k = S[i].k;
        if (pb[k] < 0.3 && b[k] > 0.45 && SP[k * 2] > -900) {
          nr++;
          const fc = NEON_RGB[F[S[i].tube] ? F[S[i].tube].to : 0];
          emitSparks(st, SP[k * 2], SP[k * 2 + 1], 9, -Math.PI / 2, 3.4, 80, 300, 0.3, 0.65, fc[0], fc[1], fc[2], 1.0);
        }
      }
      // recolour: sparks follow the gas front flowing along the tube
      for (let ti = 0; ti < F.length && ti < PL.length; ti++) {
        const f = F[ti];
        if (!f || f.at < 0 || !on) continue;
        const pf = (t - f.at) / f.dur;
        if (pf <= 0 || pf >= 1) continue;
        pointAt(PL[ti].pts, PL[ti].cum, pf * f.len, pt);
        const fc = NEON_RGB[f.to];
        const n = 2 + (Math.random() < 0.5 ? 1 : 0);
        emitSparks(st, pt[0], pt[1], n, -Math.PI / 2, 6.28, 50, 230, 0.25, 0.55, fc[0], fc[1], fc[2], 0.95);
      }
      stepSparks(st, dtS);
      return st;
    });
    // tube failure: a steadily lit slot suddenly cuts out → a buzzy "pop"
    if (on && t - powerAt.value > 2 && t - lastGlitch.value > 0.8) {
      for (let i = 0; i < S.length; i++) {
        const k = S[i].k;
        if (pb[k] > 0.6 && b[k] < 0.15 && t - S[i].born > 2) {
          lastGlitch.set(t);
          scheduleOnRN(sfx, "glitch" as Sfx, 1);
          break;
        }
      }
    }
    // transformer hum follows mean brightness (sent to JS on significant change)
    let avg = 0;
    for (let i = 0; i < S.length; i++) avg += b[S[i].k];
    avg = S.length ? avg / S.length : 0;
    const dh = Math.abs(avg - humV.value);
    if (dh > 0.04 || (dh > 0.004 && t - humT.value > 0.2)) {
      humV.set(avg);
      humT.set(t);
      scheduleOnRN(setHum, avg);
    }
    for (let k = 0; k < SLOTS; k++) pb[k] = b[k];
    bright.modify();
    colLin.modify();
    // intro (t < 0): wall / mist / rain get smooth brightness (tubes still flicker per b) → the whole wall doesn't "pump"
    let bw = b;
    if (t < 0) {
      bw = brightW.value;
      bw.fill(0);
      for (let i = 0; i < S.length; i++) bw[S[i].k] = introWallBright(t, IP, S[i].k, b[S[i].k]);
    }
    // assign references (no allocation): the uniform object on the UI runtime is a copy, not sharing arrays with bright/colLin
    feedU(wallU.value, t, bw, c, tl);
    setBolt(wallU.value, bolt);
    // the switch also cuts the alley's street light (ambient → 35 % in 80 ms); it comes back with the relight over 0.25 s
    {
      const oA = offAt.value, pA = powerAt.value;
      let ak = 1;
      if (oA > pA) ak = 1 - 0.65 * clamp((t - oA) / 0.08, 0, 1);
      else if (oA >= 0 && pA > oA) ak = 0.35 + 0.65 * clamp((t - pA) / 0.25, 0, 1);
      wallU.value.ambK = ak;
    }
    wallU.modify();
    feedU(steamU.value, t, bw, c, null);
    steamU.modify();
    feedU(gradeU.value, t, null, null, null);
    gradeU.modify();
    feedU(rainU.value, t, bw, c, null);
    let rainAmt = 1;
    if (STORM) {
      const w = Math.min(1, Math.max(0, Math.min((t - STORM.from) / 0.5, (STORM.to - t) / 0.8)));
      rainAmt = 1 + (STORM.amount - 1) * w;
    }
    // intro: rain (world coordinates) hidden during the macro close-up, replaced by the screen-sized intro rain layer
    rainU.value.amount = rainAmt * introRainK(t, IP);
    rainU.value.flash = bolt;
    rainU.modify();

    // ── demo ──
    if (!DEMO) return;
    // virtual finger lifts after the last stroke: fades over 0.28 s (used to cut out)
    if (fOff.value >= 0) {
      const k = (t - fOff.value) / 0.15; // finger lift: 0.15 s fade
      if (k >= 1) {
        fa.set(0);
        fOff.set(-1);
      } else fa.set(1 - k * k);
    }
    // Demo timeline: strokes, recolours and switch flips are non-overlapping time windows; each frame only one window
    // drives the virtual finger. Events sent to JS carry the frame's `t` (no laggy time read from JS).
    let finger = false;
    // ── strokes ──
    const q = auto.value;
    const i = autoIdx.value;
    if (i < q.length) {
      const s = q[i];
      const u = (t - s.at) / (s.len / s.speed);
      if (u >= -0.3 && trailSi.value !== i) {
        trailSi.set(i);
        scheduleOnRN(setTrailColor, SCRIPT.strokes[s.si].color);
      }
      if (u >= -0.3 && u < 0) {
        finger = true;
        fOff.set(-1);
        fx.set(s.pts[0]);
        fy.set(s.pts[1]);
        fa.set(Math.max(fa.value, (u + 0.3) / 0.3));
      } else if (u >= 0) {
        finger = true;
        fOff.set(-1);
        if (!drawing.value) {
          pts.set(s.pts);
          drawing.set(true);
          brushW.set(7);
        }
        // pen tip by arc length (matches the chalk trail's `end` trim)
        const L = Math.min(1, u) * s.len;
        const cum = s.cum;
        let lo = 0, hi = cum.length - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] < L) lo = mid;
          else hi = mid;
        }
        const seg = cum[hi] - cum[lo];
        const w = seg > 0 ? clamp((L - cum[lo]) / seg, 0, 1) : 0;
        const x = s.pts[lo * 2] + (s.pts[hi * 2] - s.pts[lo * 2]) * w;
        const y = s.pts[lo * 2 + 1] + (s.pts[hi * 2 + 1] - s.pts[lo * 2 + 1]) * w;
        fx.set(x);
        fy.set(y);
        fa.set(1);
        tipX.set(x);
        tipY.set(y);
        liveEnd.set(Math.min(1, u));
        if (u >= 1) {
          drawing.set(false);
          liveOffAt.set(t);
          autoIdx.set(i + 1);
          scheduleOnRN(commitDemo, s.si, t);
          fOff.set(t); // finger lift: 0.28 s fade
        }
      }
    }
    // ── recolour: tap tube → palette pops up beside it → tap swatch ──
    const rc = SCRIPT.recolor;
    const plan = recPlan.value;
    let show = 0;
    for (let r = 0; r < rc.length && r < plan.length; r++) {
      const P = plan[r];
      if (!P) continue;
      const ev = rc[r];
      const d = t - ev.at;
      if (ev.quick) {
        // direct swap (disco): no finger, no palette
        if (d >= 0 && recStep.value === r * 2) {
          recStep.set(r * 2 + 2);
          // on-beat recolour: gas flows 0.25 s so the new colour fills the tube right on the beat (art director v60: 0.6 s → half old half new)
          scheduleOnRN(recolor, ev.tube, ev.color, t, QUICK_FLOW);
        }
        continue;
      }
      if (d < -0.75 || d >= 0.35) continue;
      if (d > -0.45 && d < POP_CLOSE) {
        show = Math.max(show, Math.min(clamp((d + 0.45) / 0.16, 0, 1), clamp((POP_CLOSE - d) / 0.2, 0, 1)));
        popX.set(P.ox);
        popY.set(P.oy);
        popActive.set(d < 0 ? P.from : ev.color);
      }
      finger = true;
      fOff.set(-1);
      if (d < -0.45) {
        fx.set(P.ax);
        fy.set(P.ay);
        fa.set(Math.max(fa.value, Math.min(1, (d + 0.75) / 0.12)));
      } else if (d < 0) {
        if (recStep.value === r * 2) {
          recStep.set(r * 2 + 1);
          scheduleOnRN(selectAt, P.ax, P.ay);
          addRipple(rip, P.ax, P.ay, t);
        }
        const k = 1 - Math.pow(1 - clamp((d + 0.3) / 0.28, 0, 1), 3);
        fx.set(P.ax + (P.wx - P.ax) * k);
        fy.set(P.ay + (P.wy - P.ay) * k);
        fa.set(1);
      } else {
        if (recStep.value === r * 2 + 1) {
          recStep.set(r * 2 + 2);
          scheduleOnRN(onColor, ev.color, t);
          addRipple(rip, P.wx, P.wy, t, ev.color);
        }
        fx.set(P.wx);
        fy.set(P.wy);
        fa.set(Math.max(0, 1 - d / 0.15)); // lift off the swatch: 0.15 s fade
      }
    }
    // palette stays open after the tap (d up to POP_CLOSE: ~1.5 s on screen incl. spring) even after the finger leaves
    for (let r = 0; r < rc.length && r < plan.length; r++) {
      const d = t - rc[r].at;
      if (plan[r] && !rc[r].quick && d >= 0.35 && d < POP_CLOSE) show = Math.max(show, clamp((POP_CLOSE - d) / 0.2, 0, 1));
    }
    if (popShow.value !== show) popShow.set(show);
    // ── switch: finger moves in, flips; two flips close together (< 3 s) keep the finger, lifting slightly while waiting ──
    const sw = SCRIPT.switches;
    const sx = swPosS.value[0], sy = swPosS.value[1];
    for (let j = 0; j < sw.length; j++) {
      const at = sw[j].at;
      const prevClose = j > 0 && at - sw[j - 1].at < 3;
      const nextClose = j + 1 < sw.length && sw[j + 1].at - at < 3;
      const silent = !!sw[j].silent;
      if (!silent && !prevClose && t > at - 0.6 && t < at) {
        // move to the switch
        const ua = (t - (at - 0.6)) / 0.6;
        const k = 1 - Math.pow(1 - Math.min(1, ua), 3);
        finger = true;
        fOff.set(-1);
        fx.set(sx - 46 * (1 - k));
        fy.set(sy - 70 * (1 - k));
        fa.set(Math.min(1, ua * 5)); // appear over 0.12 s
      }
      if (t >= at && swStep.value === j) {
        swStep.set(j + 1);
        // flip power state right on the UI thread (this frame), JS only handles sound / haptic / lever — a busy JS at app launch
        // used to delay it ~0.5 s and swallow the first flicker beats
        const turnOn = power.value < 0.5;
        power.set(turnOn ? 1 : 0);
        if (turnOn) {
          cascade.set(!!sw[j].cascade);
          powerAt.set(t);
          powerN.set(powerN.value + 1);
        } else offAt.set(t);
        scheduleOnRN(toggleFx, turnOn);
        // big switch ripple + a "pop" on the plate on the exact cut / power frame (the tap must read before the dark)
        if (!silent) addRipple(rip, sx, sy, t, RIP_SWITCH);
      }
      if (nextClose && t >= at && t < sw[j + 1].at) {
        // lift the finger a little while waiting, then lower it to flip again
        const v = clamp((t - at) / (sw[j + 1].at - at), 0, 1);
        const lift = Math.sin(Math.PI * v);
        finger = true;
        fOff.set(-1);
        fx.set(sx - 10 * lift);
        fy.set(sy - 22 * lift);
        fa.set(1 - 0.45 * lift);
      } else if (!silent && !nextClose && t >= at && t < at + 0.5) {
        finger = true;
        fx.set(sx);
        fy.set(sy);
        fa.set(t < at + 0.2 ? 1 : Math.max(0, 1 - (t - at - 0.2) / 0.3));
      }
    }
    // outside all windows: finger fades out (if already fading via fOff, leave it to fOff)
    if (!finger && fOff.value < 0 && fa.value > 0) fa.set(Math.max(0, fa.value - 0.08));
  };

  useFrameCallback(({ timestamp }) => {
    "worklet";
    try {
      frame(timestamp);
    } catch (e) {
      if (!errOnce.value) {
        errOnce.set(true);
        scheduleOnRN(reportErr, String((e as Error)?.message ?? e) + " | " + String((e as Error)?.stack ?? ""));
      }
    }
  });

  // ── gesture ──
  const toDesign = (x: number, y: number) => {
    "worklet";
    const f = fitS.value;
    const [tx, ty] = tilt.value;
    return [(x - f.ox) / f.k + tx * PAR_TUBE, (y - f.oy) / f.k + ty * PAR_TUBE] as const;
  };
  const pan = Gesture.Pan()
    .maxPointers(1)
    .minDistance(2)
    .enabled(!DEMO)
    .onStart((e) => {
      const [x, y] = toDesign(e.x - e.translationX, e.y - e.translationY);
      const [x2, y2] = toDesign(e.x, e.y);
      if (x < DRAW.x0 || x > DRAW.x1 || y < DRAW.y0 || y > DRAW.y1) return;
      drawing.set(true);
      drawAt.set(time.value);
      liveEnd.set(1);
      tipX.set(x2);
      tipY.set(y2);
      pts.set([x, y, x2, y2]);
    })
    .onUpdate((e) => {
      if (!drawing.value) return;
      const [x, y] = toDesign(e.x, e.y);
      const p = pts.value;
      const cx = clamp(x, DRAW.x0, DRAW.x1), cy = clamp(y, DRAW.y0, DRAW.y1);
      if (Math.hypot(cx - p[p.length - 2], cy - p[p.length - 1]) < 3) return;
      tipX.set(cx);
      tipY.set(cy);
      pts.set([...p, cx, cy]);
    })
    // eslint-disable-next-line react-hooks/refs -- worklet runs on gesture, not during render
    .onFinalize(() => {
      if (!drawing.value) return;
      const p = pts.value;
      drawing.set(false);
      liveOffAt.set(time.value); // keep `pts` so the chalk trail fades; the next stroke overwrites it
      if (p.length >= 6) scheduleOnRN(commit, p, { startedAt: drawAt.value, at: time.value });
    });
  const tap = Gesture.Tap()
    .maxDuration(300)
    .enabled(!DEMO)
    // eslint-disable-next-line react-hooks/refs -- same as above
    .onEnd((e) => {
      const [x, y] = toDesign(e.x, e.y);
      addRipple(rip, x, y, time.value);
      scheduleOnRN(selectAt, x, y);
    });
  const two = Gesture.Pan()
    .minPointers(2)
    .enabled(!DEMO)
    .onUpdate((e) => tiltU.set([clamp(-e.translationX / 120, -1, 1), clamp(-e.translationY / 120, -1, 1)]))
    .onFinalize(() => tiltU.set(null));
  const gesture = Gesture.Race(two, pan, tap);

  // "punch": on power-up the whole scene zooms 2.5 % then springs back (damped spring) + small shake; beats zoom 0.6 %
  // the heart beats in time during the pulse section (tube BEAT_TUBE, scaled around its bounding-box centre)
  const beatC = useMemo(() => {
    const t = tubes[BEAT_TUBE];
    if (!DEMO || !t) return null;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < t.pts.length; k += 2) {
      x0 = Math.min(x0, t.pts[k]);
      x1 = Math.max(x1, t.pts[k]);
      y0 = Math.min(y0, t.pts[k + 1]);
      y1 = Math.max(y1, t.pts[k + 1]);
    }
    return { id: t.id, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }, [tubes]);
  const beatT = useDerivedValue(() => {
    const c = beatC;
    let k = 0;
    const t = time.value;
    if (c && PULSE && t >= PULSE.from && t <= PULSE.to + 0.3) {
      const ph = (t - PULSE.from) % PULSE.period;
      // "lub-dub": main beat + small secondary beat 0.16 s later
      k = 0.045 * Math.exp(-ph / 0.09) + (ph > 0.16 ? 0.02 * Math.exp(-(ph - 0.16) / 0.07) : 0);
    }
    // finale: one big heart pump on the downbeat (the ending's payoff, critic v83)
    const df = t - FINALE;
    if (c && FINALE >= 0 && df >= 0 && df < 0.8) k += 0.075 * Math.sin(Math.min(1, df / 0.06) * Math.PI * 0.5) * Math.exp(-Math.max(0, df - 0.06) / 0.16);
    return { id: c ? c.id : -1, m: [{ translateX: c ? c.cx : 0 }, { translateY: c ? c.cy : 0 }, { scale: 1 + k }, { translateX: c ? -c.cx : 0 }, { translateY: c ? -c.cy : 0 }] };
  });
  const sceneT = useDerivedValue(() => {
    const t = time.value;
    const d = t - powerAt.value;
    let k = 0, sx = 0, sy = 0;
    if (power.value > 0.5 && d >= 0 && d < 0.9) {
      k = 0.025 * Math.exp(-d / 0.2) * Math.cos(d * 22);
      const sh = 2.2 * Math.exp(-d / 0.12);
      sx = Math.sin(d * 93) * sh;
      sy = Math.cos(d * 71) * sh;
    }
    const df = t - FINALE;
    if (FINALE >= 0 && df >= 0 && df < 1.2) {
      k += 0.035 * Math.exp(-df / 0.22) * Math.cos(df * 18);
      const sh = 2.8 * Math.exp(-df / 0.14);
      sx += Math.sin(df * 97) * sh;
      sy += Math.cos(df * 83) * sh;
    }
    // clip close: camera pushes in very slowly after the finale flash (held to clip end then eased back, so further drawing isn't offset)
    if (FINALE >= 0 && df > 0.3) {
      const e = Math.min(1, (df - 0.3) / Math.max(0.5, END_T - FINALE - 0.3));
      const back = Math.min(1, Math.max(0, (t - END_T - 1.5) / 1.0));
      k += 0.06 * (e * e * (3 - 2 * e)) * (1 - back * back * (3 - 2 * back));
    }
    if (PULSE && t >= PULSE.from && t <= PULSE.to) k += 0.006 * Math.exp(-((t - PULSE.from) % PULSE.period) / 0.1);
    let bolt = 0;
    for (let i = 0; i < BOLTS.length; i++) bolt = Math.max(bolt, boltAt(t - BOLTS[i]));
    sx += bolt * Math.sin(t * 120) * 1.2;
    const s = fit.k * (1 + k);
    // zoom around the frame centre
    return [
      { translateX: fit.ox - (VIEW.w * fit.k * k) / 2 + sx },
      { translateY: fit.oy - (VIEW.h * fit.k * k) / 2 + sy },
      { scale: s },
    ];
  });

  const livePath = useDerivedValue(() => catmullPath(pts.value.length >= 4 ? pts.value : [0, 0]));
  const liveOp = useDerivedValue(() => {
    if (drawing.value) return 1;
    const k = clamp(1 - (time.value - liveOffAt.value) / TRAIL_FADE, 0, 1);
    return k * k;
  });
  // lightning: wall albedo revealed under the directional white flash (additive) + hard tube shadows; NO flat flash layer
  // over the whole frame (it lifted everything to purple-grey, losing direction)
  const boltOp = useDerivedValue(() => {
    let v = 0;
    for (let i = 0; i < BOLTS.length; i++) v = Math.max(v, boltAt(time.value - BOLTS[i]));
    // Graphite compiles the strobe pipelines (hard-shadow layer, glass sheen) on first draw:
    // v61 stalled ~0.45 s right at the bolt. Draw it invisibly once in a calm moment so the pipelines are cached.
    if (v === 0 && BOLTS.length > 0 && time.value > BOLT_WARM && time.value < BOLT_WARM + 0.3) v = 0.003;
    return v;
  });
  const boltShadow = useDerivedValue(() => (boltOp.value > 0.02 ? 0.7 : boltOp.value > 0 ? 0.003 : 0));
  // flash at the transformer box on power-up (with the spark burst)
  const boxFlash = useDerivedValue(() => {
    const d = time.value - powerAt.value;
    let v = power.value > 0.5 && d >= 0 && d < 0.9 ? Math.exp(-d / 0.16) : 0;
    // finale: pulses from every cable converge on the transformer box (Decor PULSE_T 0.24 s) → the box flashes
    const df = time.value - FINALE - 0.24;
    if (FINALE >= 0 && df > -0.05 && df < 0.9) v = Math.max(v, df < 0 ? 0.85 * (1 + df / 0.05) : 0.85 * Math.exp(-df / 0.2));
    return v;
  });
  const uiStyle = useAnimatedStyle(() => ({ opacity: uiFade.value }));
  // the switch (RN view outside the Canvas) doesn't follow the intro camera → hidden during the intro, fades in + rises just before t = 0
  const swStyle = useAnimatedStyle(() => {
    const u = INTRO_LEN > 0 ? Math.min(1, Math.max(0, (time.value + 0.35) / 0.3)) : 1;
    const e = u * u * (3 - 2 * u);
    return { opacity: e, transform: [{ translateY: 14 * (1 - e) }] };
  });
  // switch indicator light: mean brightness of slots that have tubes (flickers with the sign)
  useEffect(() => trailCol.set(DEMO ? trailColor : color), [trailColor, color, trailCol]);
  const pilot = useDerivedValue(() => {
    const S = slots.value;
    if (!S.length) return power.value > 0.5 ? 0.6 : 0;
    let sum = 0;
    for (let i = 0; i < S.length; i++) sum += bright.value[S[i].k];
    return Math.min(1.2, sum / S.length);
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Canvas style={StyleSheet.absoluteFill}>
          {ready && (
            <Group transform={sceneT}>
              <Group transform={introCam}>
              <Group transform={wallT}>
                <Fill>
                  <Shader source={wall} uniforms={wallU}>
                    <ImageShader image={ambient} tx="clamp" ty="clamp" sampling={LINEAR} />
                    <ImageShader image={albedo} tx="clamp" ty="clamp" sampling={LINEAR} />
                    <ImageShader image={normal} tx="clamp" ty="clamp" sampling={LINEAR} />
                    <ImageShader image={data} tx="clamp" ty="clamp" sampling={LINEAR} />
                    <ImageShader image={atlas.a} tx="clamp" ty="clamp" sampling={LINEAR} />
                    <ImageShader image={atlas.b} tx="clamp" ty="clamp" sampling={LINEAR} />
                  </Shader>
                </Fill>
                <IntroWall time={time} plan={introPlan} geo={introGeo} ambient={ambient!} albedo={albedo!} normal={normal!} data={data!} />
                {/* lightning: directional flash computed in the wall shader (uniform `bolt`, wall.ts boltLight) — no more additive albedo layer */}
                {BOLTS.length > 0 && (
                  // hard (unblurred) shadow of tubes + connectors under the flash; the soft baked shadow + cables move with shadowT
                  <Group opacity={boltShadow} transform={BOLT_SHADOW} layer={BOLT_SHADOW_PAINT}>
                    {tubes.map((t) => (
                      <Group key={`bs${t.id}`}>
                        <Path path={t.path} style="stroke" strokeWidth={t.width} strokeCap="round" strokeJoin="round" color="black" />
                        {t.link && <Path path={t.link} style="stroke" strokeWidth={t.width} strokeCap="round" strokeJoin="round" color="black" />}
                      </Group>
                    ))}
                  </Group>
                )}
                {tubes.map((t) => (
                  <Beat key={`s${t.id}`} t={t} bt={beatT}><MTubeShadow tube={t} time={time} shadow={shadowT} bright={bright} /></Beat>
                ))}
                <Wires tubes={tubes} time={time} image={parts!} shadow={shadowT} bright={bright} pw={wirePw} />
                <SwitchArt lever={lever} pilot={pilot} beckon={DEMO ? undefined : beckon} />
              </Group>
              <Group transform={tubeT}>
                {tubes.map((t) => (
                  <MTubeLink key={`k${t.id}`} tube={t} time={time} shadow={shadowT} hl={hlT} />
                ))}
                {/* electrode caps hide BEHIND the tube (drawn before the glass body) */}
                <Electrodes tubes={tubes} time={time} image={parts!} />
                {tubes.map((t) => (
                  <Beat key={`cb${t.id}`} t={t} bt={beatT}><MClipsBack tube={t} time={time} image={parts!} /></Beat>
                ))}
                {tubes.map((t) => (
                  <Beat key={`g${t.id}`} t={t} bt={beatT}><MTubeGlass tube={t} time={time} hl={hlT} /></Beat>
                ))}
                {tubes.map((t) => (
                  <Beat key={`l${t.id}`} t={t} bt={beatT}>
                    {t.units.map((u, i) => <MUnitLit key={`l${t.id}-${i}`} tube={t} unit={u} time={time} bright={bright} hl={hlT} ready={litReady} />)}
                  </Beat>
                ))}
                {tubes.map((t) => (
                  <Beat key={`cf${t.id}`} t={t} bt={beatT}><MTubeClipsFront tube={t} time={time} image={parts!} bright={bright} /></Beat>
                ))}
                {tubes.map((t) => (
                  <Beat key={`d${t.id}`} t={t} bt={beatT}><MTubeDrops tube={t} time={time} bright={bright} /></Beat>
                ))}
                {tubes.map((t) => (
                  <MTubeFreeze key={`f${t.id}`} tube={t} time={time} />
                ))}
                {BOLTS.length > 0 && (
                  // unlit glass goes pale under the flash (v61 read as black marker): body sheen + top-left highlight; v80: −30 %
                  // (paler read as "the lights came back on", critic v78)
                  <Group blendMode="plus" opacity={boltOp}>
                    {tubes.map((t) => (
                      <Group key={`bg${t.id}`}>
                        <Path path={t.path} style="stroke" strokeWidth={t.width * 0.85} strokeCap="round" strokeJoin="round" color="rgb(66,73,88)" />
                        {t.link && <Path path={t.link} style="stroke" strokeWidth={t.width * 0.85} strokeCap="round" color="rgb(66,73,88)" />}
                        <Group transform={BOLT_HL}>
                          <Path path={t.path} style="stroke" strokeWidth={t.width * 0.22} strokeCap="round" strokeJoin="round" color="rgb(140,152,175)" />
                        </Group>
                      </Group>
                    ))}
                  </Group>
                )}
                <LiveTrail path={livePath} end={liveEnd} width={brushW} tipX={tipX} tipY={tipY} opacity={liveOp} tint={NEON_RGB[DEMO ? trailColor : color]} />
                <Group blendMode="plus" opacity={boxFlash}>
                  <Circle cx={BOX_TOP[0]} cy={BOX_TOP[1] + 4} r={22} color="rgba(255,150,70,0.5)">
                    <BlurMask blur={18} style="normal" />
                  </Circle>
                  <Circle cx={BOX_TOP[0]} cy={BOX_TOP[1] + 2} r={4.5} color="rgba(255,236,200,0.9)">
                    <BlurMask blur={4} style="normal" />
                  </Circle>
                </Group>
                {(CHASE.length > 0 || FINALE >= 0) &&
                  tubes.map((tb, i) => (
                    <Beat key={`ch${tb.id}-${tb.color}`} t={tb} bt={beatT}>
                      <MTubeChase tube={tb} time={time} at={CHASE_AT[i] ?? CHASE_AT_0} dur={CHASE_DUR} flashAt={FINALE} />
                    </Beat>
                  ))}
                <Sparks sparks={sparks} />
                <IntroFx time={time} plan={introPlan} geo={introGeo} />
              </Group>
              {/* sparks reflected in the puddle: flipped about the wall foot, squashed vertically like the shader (y = H + (H − y)/reflK) */}
              <Group clip={PUDDLE_CLIP} opacity={0.12}>
                <Group transform={SPARK_MIRROR}>
                  <Sparks sparks={sparks} />
                </Group>
              </Group>
              <Fill blendMode="plus">
                <Shader source={steam} uniforms={steamU}>
                  <ImageShader image={atlas.a} tx="clamp" ty="clamp" sampling={LINEAR} />
                </Shader>
              </Fill>
              <Fill blendMode="plus">
                <Shader source={rain} uniforms={rainU}>
                  <ImageShader image={atlas.a} tx="clamp" ty="clamp" sampling={LINEAR} />
                </Shader>
              </Fill>
              <IntroAir time={time} plan={introPlan} geo={introGeo} />
              </Group>
              <Fill blendMode="multiply">
                <Shader source={grade} uniforms={gradeU} />
              </Fill>
            </Group>
          )}
          {/* frosted-glass palette (screen pt), then ripples + virtual finger drawn OVER it (design pt, same sceneT) */}
          {ready && CLEAN && <PopPill show={popShow} ox={popX} oy={popY} active={popActive} />}
          {ready && (
            <Group transform={sceneT}>
              <Ripples rip={rip} time={time} />
              {DEMO && <FingerDot x={fx} y={fy} a={fa} rip={rip} time={time} k={fit.k} />}
            </Group>
          )}
          {ready && <IntroLens time={time} plan={introPlan} fit={fit} />}
          {ready && <BeatLens time={time} power={power} powerAt={powerAt} fit={fit} tubes={tubes} />}
        </Canvas>
      </GestureDetector>
      {CLEAN ? (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, swStyle]} pointerEvents="box-none">
            <Switch fit={fit} onToggle={toggle} beckon={DEMO ? undefined : beckon} />
          </Animated.View>
        </>
      ) : (
        <Animated.View style={[StyleSheet.absoluteFill, uiStyle]} pointerEvents="box-none">
          <Animated.View style={[StyleSheet.absoluteFill, swStyle]} pointerEvents="box-none">
            <Palette color={color} thick={thick} onColor={onColor} onThick={() => setThick((v) => !v)} onUndo={undo} onClear={clear} />
            <Switch fit={fit} onToggle={toggle} beckon={DEMO ? undefined : beckon} />
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

type BeatT = SharedValue<{ id: number; m: ({ translateX: number } | { translateY: number } | { scale: number })[] }>;
/** Wraps a tube's drawing: the beat-pulsing tube gets the zoom transform, other tubes draw as-is. */
function Beat({ t, bt, children }: { t: Tube; bt: BeatT; children: React.ReactNode }) {
  const tf = useDerivedValue(() => (bt.value.id === t.id ? bt.value.m : IDENT));
  return <Group transform={tf}>{children}</Group>;
}
const IDENT = [{ scale: 1 }];

/** Clamp in front of the tube, tinted by the mean brightness of the tube's segments. */
function TubeClipsFront({ tube, time, image, bright }: { tube: Tube; time: SharedValue<number>; image: SkImage; bright: SharedValue<number[]> }) {
  const lit = useDerivedValue(() => {
    let s = 0;
    const us = tube.units;
    for (let i = 0; i < us.length; i++) s += bright.value[us[i].k] ?? 0;
    return s / us.length;
  });
  return <ClipsFront tube={tube} time={time} image={image} lit={lit} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#07060b" },
});

// ── per-tube memoised layers: recolouring one tube (setTubes) re-renders only that tube — previously every tube / segment /
// water drop re-rendered at once → 4–6 frame stall per tap recolour (v50) ──
const MTubeShadow = React.memo(TubeShadow);
const MTubeLink = React.memo(TubeLink);
const MClipsBack = React.memo(ClipsBack);
const MTubeGlass = React.memo(TubeGlass);
const MUnitLit = React.memo(UnitLit);
const MTubeClipsFront = React.memo(TubeClipsFront);
const MTubeDrops = React.memo(TubeDrops);
const MTubeFreeze = React.memo(TubeFreeze);
const MTubeChase = React.memo(TubeChase);
