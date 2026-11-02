/**
 * In-app audio (synthesised with numpy: blender/scripts/synth_audio.py → assets/audio).
 * Played via expo-audio; lazy-loaded and wrapped in try/catch: a build without the native module still runs, just silent.
 * Called from worklets via scheduleOnRN (sfx, setHum).
 */
type Player = {
  play(): void;
  pause(): void;
  seekTo(s: number): Promise<void>;
  volume: number;
  loop: boolean;
};

export type Sfx = "switch_on" | "switch_off" | "flick" | "glitch" | "flow" | "freeze";

const SRC = {
  switch_on: require("../../assets/audio/switch_on.wav"),
  switch_off: require("../../assets/audio/switch_off.wav"),
  flick_0: require("../../assets/audio/flick_0.wav"),
  flick_1: require("../../assets/audio/flick_1.wav"),
  flick_2: require("../../assets/audio/flick_2.wav"),
  flick_3: require("../../assets/audio/flick_3.wav"),
  glitch: require("../../assets/audio/glitch.wav"),
  flow: require("../../assets/audio/flow.wav"),
  freeze: require("../../assets/audio/freeze.wav"),
  hum: require("../../assets/audio/hum.wav"),
  // soft lo-fi loop (blender/scripts/app_music.py, 53 s, wraps seamlessly)
  bgm: require("../../assets/audio/bgm_chill.m4a"),
};

/** base volume per sound */
const GAIN: Record<Sfx, number> = { switch_on: 0.9, switch_off: 0.8, flick: 0.45, glitch: 0.6, flow: 0.55, freeze: 0.35 };
// transformer hum kept faint so it never buzzes over the music (user 02/11: the buzzing was unpleasant)
const HUM_GAIN = 0.08;
/** background music level (a bed under the sound effects) */
const BGM_GAIN = 0.35;

let pools: Partial<Record<string, Player[]>> = {};
let rr: Record<string, number> = {};
let hum: Player | null = null;
let bgm: Player | null = null;
let humOn = false;
let ready = false;

export const initAudio = () => {
  if (ready) return;
  ready = true;
  // old binary without ExpoAudio: require reports to the global handler (redbox) before catch can run → check first
  if (!(globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules?.ExpoAudio) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const A = require("expo-audio") as typeof import("expo-audio");
    A.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers" }).catch(() => {});
    const make = (src: number, n: number) => Array.from({ length: n }, () => A.createAudioPlayer(src) as unknown as Player);
    pools = {
      switch_on: make(SRC.switch_on, 1),
      switch_off: make(SRC.switch_off, 1),
      flick: [...make(SRC.flick_0, 2), ...make(SRC.flick_1, 2), ...make(SRC.flick_2, 2), ...make(SRC.flick_3, 2)],
      glitch: make(SRC.glitch, 1),
      flow: make(SRC.flow, 2),
      freeze: make(SRC.freeze, 2),
    };
    hum = A.createAudioPlayer(SRC.hum) as unknown as Player;
    hum.loop = true;
    hum.volume = 0;
    bgm = A.createAudioPlayer(SRC.bgm) as unknown as Player;
    bgm.loop = true;
    bgm.volume = 0;
  } catch {
    pools = {};
    hum = null;
    bgm = null;
  }
};

let bgmTimer: ReturnType<typeof setInterval> | null = null;
/** Start the chill background loop with a 2.5 s fade-in (call after initAudio; no-op without the native module). */
export const startMusic = (fadeS = 2.5) => {
  const p = bgm;
  if (!p) return;
  try {
    p.volume = 0;
    p.play();
  } catch {
    return;
  }
  if (bgmTimer) clearInterval(bgmTimer);
  const t0 = Date.now();
  bgmTimer = setInterval(() => {
    const u = Math.min(1, (Date.now() - t0) / (fadeS * 1000));
    try {
      p.volume = BGM_GAIN * u * u;
    } catch {}
    if (u >= 1 && bgmTimer) {
      clearInterval(bgmTimer);
      bgmTimer = null;
    }
  }, 50);
};

export const sfx = (name: Sfx, gain = 1) => {
  const pool = pools[name];
  if (!pool?.length) return;
  // flick: pick a random variant; other sounds round-robin
  const i = name === "flick" ? Math.floor(Math.random() * pool.length) : (rr[name] = ((rr[name] ?? -1) + 1) % pool.length);
  const p = pool[i];
  try {
    p.volume = Math.min(1, GAIN[name] * gain);
    p.seekTo(0).catch(() => {});
    p.play();
  } catch {}
};

/** Transformer hum: volume follows the sign's mean brightness (0..~1.2); fully off at 0. */
export const setHum = (level: number) => {
  if (!hum) return;
  try {
    const v = Math.max(0, Math.min(1, level * HUM_GAIN));
    hum.volume = v;
    if (v > 0.002 && !humOn) {
      humOn = true;
      hum.play();
    } else if (v <= 0.002 && humOn) {
      humOn = false;
      hum.pause();
    }
  } catch {}
};
