/**
 * Brightness of each neon slot over time — pure function, deterministic per seed (no state), runs in a worklet.
 *  - On power up: random delay, 3–5 blinks (on 40–200 ms, off 30–120 ms), then fully on with a +15 % overshoot.
 *  - Steady: ~2 % wobble; occasionally a "broken" slot cuts out for ~60 ms (every 6–12 s).
 */
export const hash = (n: number) => {
  "worklet";
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** First shared flash (transformer striking): all tubes flash together → sync anchor when cutting the promo (tools/sync.py). */
export const FIRST_FLASH = [0.05, 0.12] as const;

/**
 * u: seconds since the slot was powered. gas: 0 = neon (red), 1 = argon/mercury (every other colour) — see GAS in palette.ts.
 *  - neon: strong, short strike blinks, fully on immediately, clear overshoot (+15 %).
 *  - argon: weaker strike blinks, longer off gaps, one extra blink; fully on at ~65 % then warms up to 100 % over ~3 s
 *    (mercury vaporising), small overshoot.
 * No gas passed (−1) = legacy behaviour.
 */
export const ignite = (u: number, seed: number, gas = -1) => {
  "worklet";
  if (u < FIRST_FLASH[0]) return 0;
  if (u < FIRST_FLASH[1]) return 0.9;
  const ar = gas === 1;
  let t = FIRST_FLASH[1] + 0.05 + hash(seed) * 0.06;
  if (u < t) return 0;
  // critic 3 (02/11): long flicker on a fresh tube stole the eye from the palette → 2–3 blinks within ~0.5 s
  const n = 1 + Math.floor(hash(seed + 1.3) * 2); // 1–2 blinks (critic 7: heart still read as 5 blinks)
  const onK = gas === 0 ? 0.75 : 1;
  const offK = ar ? 1.5 : 1;
  for (let i = 0; i < n; i++) {
    const on = (0.06 + hash(seed + 10.7 + i) * 0.06) * onK;
    if (u < t + on) {
      const lvl = 0.5 + hash(seed + 20.1 + i) * 0.55;
      return gas === 0 ? Math.min(1.15, lvl + 0.2) : ar ? lvl * 0.72 : lvl;
    }
    t += on;
    const off = (0.05 + hash(seed + 30.3 + i) * 0.03) * offK;
    if (u < t + off) return ar ? 0.05 : 0.03;
    t += off;
  }
  const v = u - t;
  if (gas < 0) {
    if (v < 0.05) return 0.6 + (v / 0.05) * 0.55;
    return 1 + 0.15 * Math.exp(-(v - 0.05) * 7);
  }
  if (gas === 0) {
    if (v < 0.04) return 0.7 + (v / 0.04) * 0.48;
    return 1 + 0.18 * Math.exp(-(v - 0.04) * 8);
  }
  // argon: up to 65 % in 80 ms, then warms up (τ ≈ 1.1 s), small overshoot right after striking
  if (v < 0.08) return 0.35 + (v / 0.08) * 0.3;
  const warm = 1 - 0.35 * Math.exp(-(v - 0.08) / 1.1);
  return warm + 0.06 * Math.exp(-(v - 0.08) * 9);
};

/** Small wobble when steady (~2 %). */
export const steady = (t: number, k: number) => {
  "worklet";
  return 1 + 0.012 * Math.sin(t * 37 + k * 3.1) + 0.008 * Math.sin(t * 91 + k * 1.7);
};

/** "Broken" tube cycle: one glitch per BROKEN_P-second window, 6–12 s apart. */
const BROKEN_P = 9;

/**
 * "Broken" tube (one fixed slot per power-on): brightness multiplier at second `u` since steady.
 * Three glitch kinds: 60 ms blackout · 2-beat stutter · fully off ~0.3 s then flickering re-strike.
 * Between glitches the broken tube glows weaker and jitters slightly (contaminated gas).
 */
/** Dark level during one discharge dropout (x seconds since the dropout, from brightness `from`); phosphor (gas 1) keeps an afterglow. */
const dip = (lo: number, x: number, from: number, gas: number) => {
  "worklet";
  if (gas !== 1) return lo;
  const ph = x < 0.04 ? 1 - (x / 0.04) * 0.75 : 0.25 * Math.exp(-(x - 0.04) / 0.12);
  return Math.max(lo, ph * from);
};

/**
 * Flickering broken tube. gas = 1 (phosphor-coated argon): the phosphor keeps an afterglow, so each discharge dropout only falls to
 * ~25 % in 40 ms, then fades (τ 0.12 s) like `extinguish`, instead of snapping black like red neon. gas = -1/0: legacy behaviour.
 */
export const brokenGlitch = (u: number, seed: number, gas = -1) => {
  "worklet";
  if (u < 2) return 1;
  const w = Math.floor(u / BROKEN_P);
  const at = w * BROKEN_P + 1.5 + hash(w * 3.7 + seed) * 6;
  const d = u - at;
  const shimmer = 0.94 + 0.04 * Math.sin(u * 113 + seed) * Math.sin(u * 7.3);
  if (d < 0 || d > 0.9) return shimmer;
  const kind = Math.floor(hash(w * 1.9 + seed + 0.3) * 3);
  if (kind === 0) return d < 0.06 ? dip(0.05, d, 0.94, gas) : shimmer;
  if (kind === 1) {
    if (d < 0.05) return dip(0.04, d, 0.94, gas);
    if (d < 0.09) return 0.55;
    if (d < 0.17) return dip(0.04, d - 0.09, 0.55, gas);
    return shimmer;
  }
  if (d < 0.12) return dip(0.03, d, 0.94, gas);
  if (d < 0.14) return 0.35;
  if (d < 0.32) return dip(0.03, d - 0.14, 0.35, gas);
  if (d < 0.36) return 0.6;
  if (d < 0.41) return dip(0.08, d - 0.36, 0.6, gas);
  if (d < 0.5) return 0.8 + (d - 0.41) * 2;
  return shimmer;
};

/**
 * Broken tube "dies and re-strikes" (demo script, ~0.85 s): snaps off, dark 0.2 s, one flash, off, two flickers, then
 * relights with a slight overshoot. d = seconds since start; returns 1 outside [0, 0.85).
 */
export const restrike = (d: number, gas = -1) => {
  "worklet";
  if (d < 0 || d >= 0.85) return 1;
  if (d < 0.25) return dip(0.03, d, 1, gas);
  if (d < 0.28) return 0.45;
  if (d < 0.45) return dip(0.03, d - 0.28, 0.45, gas);
  if (d < 0.5) return 0.7;
  if (d < 0.56) return dip(0.04, d - 0.5, 0.7, gas);
  if (d < 0.62) return 0.85;
  if (d < 0.66) return 0.3;
  if (d < 0.74) return 0.6 + ((d - 0.66) / 0.08) * 0.5;
  return 1.1 - ((d - 0.74) / 0.11) * 0.1;
};

/** Which slot is the broken tube: chosen per power-on, so each relight can hit a different letter. */
export const pickBroken = (nSlots: number, powerN: number) => {
  "worklet";
  return Math.floor(hash(powerN * 1.37 + nSlots * 0.11 + 4.2) * nSlots);
};

/**
 * Brightness after the power cut, u = seconds since the cut. Neon gas (red) goes out almost instantly (~50 ms); phosphor-coated argon
 * tubes have an afterglow: a fast drop to ~25 % in 40 ms, then an exponential fade (τ ≈ 0.12 s) — letters dim rather than snap off.
 */
export const extinguish = (u: number, gas: number) => {
  "worklet";
  if (u < 0) return 1;
  if (gas !== 1) return Math.max(0, 1 - u / 0.05);
  if (u < 0.04) return 1 - (u / 0.04) * 0.75;
  const v = 0.25 * Math.exp(-(u - 0.04) / 0.12);
  return v < 0.004 ? 0 : v;
};
