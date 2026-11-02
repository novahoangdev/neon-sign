"""In-app background music: a soft lo-fi loop (72 BPM, 16 bars ≈ 53 s) that wraps seamlessly.

Electric piano 7th/9th chords, round sine bass, very light swung lo-fi drums from bar 3, a sparse bell motif in the
second half of each 8-bar phrase, faint vinyl crackle. Ringing notes and reverb past the loop end are wrapped onto the
start, so the file loops without a click or a gap.

    Blender -b --factory-startup -P blender/scripts/app_music.py      (or any python with numpy + ffmpeg on PATH)
Writes app/assets/audio/bgm_chill.m4a (AAC 128 kbps, −20 LUFS — a bed under the app's sound effects).
The promo / showcase music is blender/scripts/mix_showcase.py and is unrelated.
"""
import math
import os
import subprocess

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "app", "assets", "audio", "bgm_chill.m4a")
SR = 44100
BPM = 72
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 16
LOOP = BAR * BARS
TAIL = 4.0
N = int((LOOP + TAIL) * SR)
rng = np.random.default_rng(7)
ns = lambda s: int(round(s * SR))
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)


def band(x, lo, hi):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, len(x))


class Bus:
    def __init__(self):
        self.x = np.zeros((N, 2))

    def put(self, sig, at, gain=1.0, pan=0.0):
        if at < 0:   # before the loop start → place it at the end; the wrap below brings it round to the start
            at += LOOP
        i = ns(at)
        if i >= N:
            return
        s = sig[: N - i] * gain
        self.x[i:i + len(s), 0] += s * math.sqrt((1 - pan) / 2) * 1.414
        self.x[i:i + len(s), 1] += s * math.sqrt((1 + pan) / 2) * 1.414


def ep(ms, sec, vel=1.0):
    """Rhodes-like 2-op FM: warm sine body, short soft tine, slow tremolo."""
    t = np.arange(ns(sec)) / SR
    x = np.zeros(len(t))
    for m in ms:
        f = hz(m) * (1 + rng.uniform(-0.0015, 0.0015))
        idx = 0.8 * np.exp(-t * 4.0) + 0.18
        x += np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t)) * np.exp(-t * 0.5)
        x += 0.06 * np.sin(2 * np.pi * f * 7 * t) * np.exp(-t * 14)
    x *= 1 + 0.1 * np.sin(2 * np.pi * 3.2 * t)
    env = np.minimum(t / 0.006, 1) * np.clip((sec - t) / 0.25, 0, 1)
    return x * env * vel * 0.12 / max(1.0, len(ms) ** 0.5)


def pad(ms, sec, vel=1.0):
    """soft sustained bed (detuned sines, slow attack / release) so every bar keeps its level to the end"""
    t = np.arange(ns(sec)) / SR
    x = np.zeros(len(t))
    for m in ms:
        for d in (-0.004, 0.004):
            ph = 2 * np.pi * hz(m) * (1 + d) * t + rng.random() * 6
            x += np.sin(ph) + 0.15 * np.sin(2 * ph)
    env = np.minimum(t / 0.6, 1) * np.clip((sec - t) / 0.8, 0, 1)
    return band(x * env, 80, 1800) * vel * 0.05 / len(ms)


def bass(m, sec, vel=1.0):
    t = np.arange(ns(sec)) / SR
    x = np.sin(2 * np.pi * hz(m) * t) + 0.18 * np.sin(4 * np.pi * hz(m) * t)
    env = np.minimum(t / 0.02, 1) * np.exp(-t * 0.6) * np.clip((sec - t) / 0.12, 0, 1)
    return np.tanh(x * 1.2) * env * vel * 0.32


def bell(m, sec, vel=1.0):
    t = np.arange(ns(sec)) / SR
    ph = 2 * np.pi * hz(m) * t
    x = np.sin(ph + 0.5 * np.exp(-t * 6) * np.sin(3.5 * ph)) + 0.2 * np.sin(2 * ph)
    env = np.minimum(t / 0.01, 1) * np.exp(-t * 1.6) * np.clip((sec - t) / 0.2, 0, 1)
    return x * env * vel * 0.1


def kick(vel=1.0):
    t = np.arange(ns(0.35)) / SR
    f = 48 + 60 * np.exp(-t / 0.04)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    return x * vel * 0.5


def rim(vel=1.0):
    """brushed snare / rim: soft noise + a little body, no crack"""
    t = np.arange(ns(0.25)) / SR
    nz = band(rng.standard_normal(len(t)), 1200, 5000) * np.exp(-t / 0.06) * 0.35
    body = np.sin(2 * np.pi * 200 * t) * np.exp(-t / 0.03) * 0.25
    return (nz + body) * vel


def hat(vel=1.0):
    t = np.arange(ns(0.08)) / SR
    return band(rng.standard_normal(len(t)), 5000, 9000) * np.exp(-t / 0.015) * vel * 0.12


def reverb(x, sec=2.4):
    n = ns(sec)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = band(rng.standard_normal(n), 200, 5000) * np.exp(-t * 6.9 / sec)
        ir[: ns(0.015)] *= np.linspace(0, 1, ns(0.015))
        ir /= np.sqrt((ir ** 2).sum())
        L = len(x) + n
        out[:, ch] = np.fft.irfft(np.fft.rfft(x[:, ch], L) * np.fft.rfft(ir, L), L)[: len(x)]
    return out


# F major lo-fi: I–iii–ii–I  /  IV–iii–ii–V (7th / 9th voicings, close and warm)
CHORDS = [
    ([53, 57, 60, 64, 67], 41), ([52, 55, 59, 62], 40), ([50, 53, 57, 60, 64], 38), ([48, 52, 55, 59], 36),
    ([46, 50, 53, 57], 34), ([45, 48, 52, 55], 33), ([43, 46, 50, 53, 57], 31), ([48, 53, 55, 58], 36),
]
# sparse bell motif (beat, midi) for bars 5–8 of each 8-bar phrase, F major pentatonic
MOTIF = {4: [(1.5, 72), (2.5, 69)], 5: [(0.5, 67), (2.0, 69)], 6: [(1.0, 72), (2.5, 74), (3.0, 72)], 7: [(1.5, 69)]}

keys, low, drums, lead = Bus(), Bus(), Bus(), Bus()
for bar in range(BARS):
    t0 = bar * BAR
    ch, root = CHORDS[bar % 8]
    keys.put(ep(ch, BAR * 1.15, 0.9), t0, 1.0, -0.1)
    keys.put(ep(ch[1:], BEAT * 1.6, 0.45), t0 + 2.5 * BEAT, 1.0, 0.15)     # soft lo-fi re-hit on the "and" of 3
    keys.put(ep(ch[:3], BEAT * 1.4, 0.32), t0 + 3.5 * BEAT, 1.0, -0.2)     # and a quiet one before the next bar
    keys.put(pad(ch, BAR + 0.9), t0 - 0.3, 1.0)
    low.put(bass(root + 12, BEAT * 2.2), t0)
    low.put(bass(root + 19, BEAT * 1.4, 0.6), t0 + 2 * BEAT)
    if bar >= 2:   # bars 1–2 are keys only: a breath every time the loop comes round
        for b, v in ((0, 1.0), (1.5, 0.55)):
            drums.put(kick(v), t0 + b * BEAT)
        for b in (1, 3):
            drums.put(rim(0.8), t0 + b * BEAT + 0.012, 1.0, 0.1)
        for j in range(8):
            sw = 0.09 if j % 2 else 0.0   # swing
            drums.put(hat(0.8 if j % 2 else 0.5), t0 + (j / 2) * BEAT + sw, 1.0, 0.3)
    for b, m in MOTIF.get(bar % 8, []):
        lead.put(bell(m, BEAT * 2.5), t0 + b * BEAT, 1.0, 0.2)

# faint vinyl: low hiss + sparse crackles
vin = Bus()
hiss = band(rng.standard_normal(N), 300, 6000)
hiss = hiss / (np.std(hiss) + 1e-9) * 0.004
vin.x += np.stack([hiss, np.roll(hiss, 911)], 1)
for at in np.cumsum(rng.uniform(0.05, 0.6, 600)):
    if at < LOOP + TAIL:
        k = ns(0.003)
        vin.put(rng.standard_normal(k) * np.exp(-np.arange(k) / (k / 4)) * rng.uniform(0.01, 0.04), at, 1.0, float(rng.uniform(-0.6, 0.6)))

music = keys.x * 1.0 + low.x * 0.85 + drums.x * 0.8 + lead.x * 0.8
music = music + reverb(music) * 0.3
mix = music + vin.x
# warmth: gentle low-pass + soft saturation
for ch in range(2):
    mix[:, ch] = band(mix[:, ch], 30, 7000)
mix = np.tanh(mix * 1.4) / 1.4

# seamless loop: wrap everything that rings past the loop end onto the start
L = ns(LOOP)
out = mix[:L].copy()
out[: N - L] += mix[L:]

tmp = OUT[:-4] + "_tmp.wav"
import wave  # noqa: E402

pk = np.max(np.abs(out)) or 1
with wave.open(tmp, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(out / pk * 0.9, -1, 1) * 32767).astype("<i2").tobytes())
# static gain to −20 LUFS (loudnorm's dynamic mode would ride the level and make the loop seam audible)
import json  # noqa: E402
import re  # noqa: E402

meas = subprocess.run(["ffmpeg", "-hide_banner", "-i", tmp, "-af", "loudnorm=I=-20:TP=-3:print_format=json", "-f", "null", "-"],
                      capture_output=True, text=True).stderr
gain = -20.0 - float(json.loads(meas[meas.rindex("{"):meas.rindex("}") + 1])["input_i"])
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.7", "-ar", str(SR),
                "-c:a", "aac", "-b:a", "128k", OUT], check=True)
os.remove(tmp)
print(f"BGM → {os.path.relpath(OUT, ROOT)}  {LOOP:.1f} s loop")
