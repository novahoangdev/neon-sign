# Sound + music for the ~42.5 s showcase (demo script v4+, src/demo/script.ts), synthesized with numpy, no copyrighted
# samples. Times = scene clock seconds (t = 0 = first frame of render/showcase/<v>/screen.mp4).
#
#   125 BPM synthwave (beat 0.48 s = the sign's pulse period), Am – F – C – G:
#     0 → 8.6     intro: pad + arpeggiated pluck + hook, rain, light hi-hat from the colour change
#     8.6         switch off → "tape stop", dark gap, riser → 9.8 DROP 1 (first flash): four-on-the-floor kick, clap, bass
#     25.4        switch off → tape stop, rain, THUNDER 26.25 → riser → 27.6 DROP 2 (cascade on): crash, lead hook, denser
#     37.2/39.12  light pulses run along the tubes: rising "whoosh" · 40.08 → 42.48 pulse: kick + heavy sidechain, final chord
#   App sounds: switch click, zap + sparks on power-up, crackle on each ignition flicker (detected in the recording), sparkler
#   while drawing, glass "ting" when a tube freezes, gas flow on colour change, touch (tick), broken tube, transformer hum following real brightness.
#   Master −14 LUFS, true peak ≤ −1.5 dBTP (X/TikTok re-encode headroom) (ffmpeg loudnorm, 2 passes), 48 kHz stereo.
#
#   Blender -b --factory-startup -P blender/scripts/mix_showcase.py -- --screen render/showcase/v8/screen.mp4 \
#       [--out render/showcase/v8/mix.wav] [--dur 42.5]
import json, math, os, re, subprocess, sys, wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth_audio as sa  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
ROOT = sa.ROOT
SCREEN = arg("--screen")
DUR = float(arg("--dur", "13.0"))
PRE = float(arg("--pre", "0"))   # intro seconds before t = 0 (screen.mp4 starts at t = −PRE)
OUT = os.path.join(ROOT, arg("--out", os.path.join(os.path.dirname(SCREEN) if SCREEN else "render/showcase", "mix.wav")))
SR = 48000
# tail rings under the promo end card (promo.sh pads + fades the audio; final.mp4 trims at DUR + PRE)
TAIL = float(arg("--tail", "3.0"))
CARD_AT = float(arg("--card-at", "11.44"))   # scene second the promo cuts to the end card (mkbeats app_end)
N = int((DUR + 0.6 + TAIL) * SR)
rng = np.random.default_rng(11)
ns = lambda sec: int(round(sec * SR))
tm = np.arange(N) / SR
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
Z = 440 / 402

# ───────── script v3 (matches src/demo/script.ts, night of 01/11: ~21.6 s, one off/on) ─────────
HEART_AT, HEART_SPEED = 0.25, 680 * Z
STAR_AT, STAR_SPEED = 3.15, 640 * Z
RECOLOR = [2.35]   # chip-tap seconds (script.ts recolor `at`); the tube tap is 0.45 s earlier
QUICK = []
UL_AT, UL_LEN, UL_SPEED = 7.6, 313.2, 560 * 440 / 402      # underline stroke (estimated length)
CHASE_LAST = 9.04
SWITCH = [(4.72, False), (5.2, True)]
N_OPEN = 0
BROKEN = []
THUNDER = [4.9]
CHASE = []
PULSE = (9.04, 10.0)
BEAT = 0.48
BAR = BEAT * 4
G1 = 5.2                     # beat grid: DROP (cascade-style power back on)
OFF1, ON1 = 4.72, 5.2


def heart_len():
    p = []
    for i in range(73):
        t = math.pi * 2 * i / 72
        p.append((16 * math.sin(t) ** 3 * 3.45 * Z, -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) * 3.45 * Z))
    return sum(math.dist(p[i], p[i - 1]) for i in range(1, len(p)))


def star_len(R=46, r=19):
    v = [((R if k % 2 == 0 else r) * math.cos(-math.pi / 2 + k * math.pi / 5), (R if k % 2 == 0 else r) * math.sin(-math.pi / 2 + k * math.pi / 5)) for k in range(10)]
    return sum(math.dist(v[i], v[(i + 1) % 10]) for i in range(10)) * 0.97


HEART_END = HEART_AT + heart_len() / HEART_SPEED
STAR_END = STAR_AT + star_len() / STAR_SPEED
print(f"MIX heart {HEART_AT}–{HEART_END:.2f}  star {STAR_AT}–{STAR_END:.2f}")


# ───────── bus + DSP ─────────
class Bus:
    def __init__(self, n=None):
        self.n = n or N
        self.x = np.zeros((self.n, 2))

    def put(self, sig, at, gain=1.0, pan=0.0):
        i = ns(at)
        if i >= self.n or i + len(sig) <= 0:
            return
        s = sig * gain
        if i < 0:
            s, i = s[-i:], 0
        s = s[:self.n - i]
        if s.ndim == 1:
            self.x[i:i + len(s), 0] += s * math.sqrt((1 - pan) / 2) * 1.414
            self.x[i:i + len(s), 1] += s * math.sqrt((1 + pan) / 2) * 1.414
        else:
            self.x[i:i + len(s)] += s


band = lambda x, lo, hi: sa.band(x, lo, hi, SR)


def fades(x, a=0.002, r=0.01):
    x = x.copy()
    na, nr = max(1, ns(a)), max(1, ns(r))
    x[:na] *= np.linspace(0, 1, na)
    x[-nr:] *= np.linspace(1, 0, nr)
    return x


def resamp(x, sr_in=44100):
    return np.interp(np.arange(int(len(x) * SR / sr_in)) / SR, np.arange(len(x)) / sr_in, x)


def reverb(x, sec=1.6, damp=4500, seed=1):
    r = np.random.default_rng(seed)
    n = ns(sec)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = r.standard_normal(n) * np.exp(-t * 6.9 / sec)
        ir = band(ir, 180, damp)
        ir[:ns(0.012)] *= np.linspace(0, 1, ns(0.012))
        ir /= np.sqrt((ir ** 2).sum())
        L = len(x) + n
        out[:, ch] = np.fft.irfft(np.fft.rfft(x[:, ch], L) * np.fft.rfft(ir, L), L)[:len(x)]
    return out


def pluck(m, sec=0.9, vel=1.0, bright=1.0):
    n = ns(sec)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for d in (-0.003, 0.003):
        f = hz(m) * (1 + d)
        for h in range(1, 9):
            if f * h > 9000:
                break
            x += np.sin(2 * np.pi * f * h * t + h) / h * np.exp(-t * (2.2 + 1.6 * h / bright))
    return fades(x * 0.32 * vel * np.minimum(t / 0.003, 1), 0.0, 0.05)


def lead_note(m, sec, vel=1.0):
    n = ns(sec)
    t = np.arange(n) / SR
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.15) / 0.2, 0, 1)
    x = np.zeros(n)
    for mult, g in ((1, 1.0), (0.5, 0.45), (2, 0.18)):
        ph = 2 * np.pi * np.cumsum(hz(m) * mult * vib) / SR
        for h in range(1, 7):
            x += g * np.sin(h * ph) / h * math.exp(-0.28 * h)
    e = np.minimum(t / 0.012, 1) * np.exp(-t * 0.9) * np.clip((sec - t) / 0.06, 0, 1)
    return x * e * 0.22 * vel


def pad(ms, sec, att=0.35, rel=0.6, cut=2600):
    n = ns(sec)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for m in ms:
        for d in (-0.005, 0.0, 0.006):
            ph = 2 * np.pi * hz(m) * (1 + d) * t + rng.random() * 6
            x += np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph) + 0.05 * np.sin(4 * ph)
    e = np.minimum(t / att, 1) * np.clip((sec - t) / rel, 0, 1)
    return band(x * e / (len(ms) * 3), 90, cut)


def kick(sec=0.42, f0=140, f1=48, dec=8.0, click=0.08):
    n = ns(sec)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / 0.035)
    x = np.tanh(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * dec) * 1.5) / np.tanh(1.5)
    x += band(rng.standard_normal(n), 1500, 5000) * np.exp(-t / 0.002) * click
    return fades(x, 0.0005, 0.02)


def clap(sec=0.35):
    n = ns(sec)
    x = np.zeros(n)
    for k, dt in enumerate((0, 0.01, 0.019, 0.027)):
        i = ns(dt)
        tt = np.arange(n - i) / SR
        x[i:] += rng.standard_normal(n - i) * np.exp(-tt / (0.004 if k < 3 else 0.07)) * (0.7 if k < 3 else 1.0)
    return fades(band(x, 900, 6000) * 0.5, 0.0003, 0.03)


def hat(vel=1.0, dec=0.02):
    n = ns(dec * 6)
    t = np.arange(n) / SR
    return fades(band(rng.standard_normal(n), 6000, 9500) * np.exp(-t / dec) * vel * 0.4, 0.0002, 0.01)


def sub(m, sec):
    n = ns(sec)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * hz(m) * t) + 0.25 * np.sin(4 * np.pi * hz(m) * t)
    x = np.tanh(x * 1.6) / np.tanh(1.6)
    return fades(x * np.exp(-t * 1.2) * np.clip((sec - t) / 0.04, 0, 1), 0.004, 0.03)


def riser(sec, top=12.0):
    n = ns(sec)
    u = np.arange(n) / n
    nz = rng.standard_normal(n)
    out = np.zeros(n)
    seg = 2048
    for i in range(0, n - seg, seg // 2):
        fc = 400 * (top ** u[i])
        out[i:i + seg] += band(nz[i:i + seg], fc * 0.5, fc * 1.5) * np.hanning(seg)
    return out * u ** 2.2 * 0.5


def crash(sec=2.2):
    n = ns(sec)
    return band(rng.standard_normal(n), 3000, 11000) * np.exp(-np.arange(n) / SR * 2.2) * 0.35


def tape_stop(x, at, sec=0.5):
    i0, L = ns(at), ns(sec)
    tau = np.arange(L) / SR
    pos = at + tau - tau ** 2 / (2 * sec)
    ts = np.empty((L, 2))
    for ch in range(2):
        ts[:, ch] = np.interp(pos, tm, x[:, ch]) * (1 - tau / sec) ** 0.5
    x[i0:] = 0
    x[i0:i0 + L] = ts


# v91 music (user: "the buzz is unpleasant, I want a nice background track"): warm I–V–vi–IV in F major,
# electric-piano chords + soft pluck arp + bell lead; same 125 BPM grid and sync points as before
CH = {"F": [53, 57, 60, 64], "C": [55, 60, 62, 67], "Dm": [53, 57, 60, 62], "Bb": [53, 57, 58, 62]}
ROOT_ = {"F": 41, "C": 36, "Dm": 38, "Bb": 34}
# catchy 4-bar hook (user: "catchy, trend-friendly"): 3-3-2 syncopation, same rhythm every bar, repeats
HOOK = {
    "F": [(0, 72), (0.75, 72), (1.5, 69), (2.5, 72), (3, 74)],
    "C": [(0, 76), (0.75, 74), (1.5, 72), (2.5, 67), (3, 72)],
    "Dm": [(0, 74), (0.75, 74), (1.5, 72), (2.5, 69), (3, 72)],
    "Bb": [(0, 77), (0.75, 74), (1.5, 72), (2.5, 70), (3, 69)],
}
PROG = ["F", "C", "Dm", "Bb"]


def ep(ms, sec, vel=1.0):
    """electric piano (Rhodes-like 2-op FM): warm sine body + a short bell tine, slow decay"""
    n = ns(sec)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for m in ms:
        f = hz(m)
        idx = 1.1 * np.exp(-t * 5.0) + 0.25
        x += np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t)) * np.exp(-t * 1.3)
        x += 0.12 * np.sin(2 * np.pi * f * 7.0 * t) * np.exp(-t * 18)
    trem = 1 + 0.08 * np.sin(2 * np.pi * 4.5 * t)
    return fades(x * trem * vel * 0.16 / max(1, len(ms) ** 0.5) * np.minimum(t / 0.004, 1), 0.0, 0.08)


def bell(m, sec, vel=1.0):
    """soft bell lead: sine + octave + a little FM shimmer, gentle vibrato"""
    n = ns(sec)
    t = np.arange(n) / SR
    vib = 1 + 0.003 * np.sin(2 * np.pi * 5.0 * t) * np.clip((t - 0.12) / 0.2, 0, 1)
    ph = 2 * np.pi * np.cumsum(hz(m) * vib) / SR
    x = np.sin(ph + 0.6 * np.exp(-t * 8) * np.sin(3.5 * ph)) + 0.25 * np.sin(2 * ph)
    e = np.minimum(t / 0.006, 1) * np.exp(-t * 2.2) * np.clip((sec - t) / 0.05, 0, 1)
    return x * e * 0.2 * vel


def chop(m, sec, vel=1.0):
    """vocal-chop lead: band-limited saw through "ah" formants (≈ 730 / 1090 / 2440 Hz), tiny pitch dip at the tail"""
    n = ns(sec)
    t = np.arange(n) / SR
    bend = 1 - 0.035 * np.clip((t - sec * 0.6) / (sec * 0.4), 0, 1) ** 2
    ph = 2 * np.pi * np.cumsum(hz(m) * bend * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t))) / SR
    f0 = hz(m)
    x = np.zeros(n)
    for h in range(1, 40):
        if f0 * h > 5000:
            break
        x += np.sin(h * ph) / h
    v = band(x, 600, 900) * 1.0 + band(x, 950, 1300) * 0.55 + band(x, 2200, 2800) * 0.22 + band(x, 150, 500) * 0.35
    e = np.minimum(t / 0.008, 1) * np.exp(-t * 2.6) * np.clip((sec - t) / 0.04, 0, 1)
    return v * e * 0.9 * vel


def snare_soft(sec=0.3):
    n = ns(sec)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * (185 + 40 * np.exp(-t / 0.01)) * t) * np.exp(-t / 0.05) * 0.5
    nz = band(rng.standard_normal(n), 1400, 6500) * np.exp(-t / 0.07) * 0.45
    return fades((body + nz) * 0.8, 0.0003, 0.03)


def bars(grid, first, last):
    """beat slots (index, start second) of grid `grid` within [first, last)"""
    k0 = math.ceil((first - grid) / BAR - 1e-6)
    k = k0
    while grid + k * BAR < last - 1e-6:
        yield k, grid + k * BAR
        k += 1


def bar_full(bus, drums, bass, k, t0, c, energy, until):
    """one full bar: EP chord (beat 1 + syncopated stab on the "and" of 2), sub bass, round kick 4/4, soft snare on 2 & 4,
    light hats, soft pluck arp; energy > 0.5 adds the bell hook"""
    cut = lambda sig, at: sig[:max(0, ns(until - at))]
    bus.put(cut(pad(CH[c] + [CH[c][0] + 12], BAR + 0.1, att=0.08, rel=0.3, cut=2400), t0), t0, 0.22)
    for b_, v in ((0, 1.0), (1.5, 0.7), (3, 0.55)):
        at = t0 + b_ * BEAT
        if at < until:
            bus.put(cut(ep(CH[c], BEAT * 2.2, v), at), at, 1.0, 0.0)
    for b_ in range(4):
        at = t0 + b_ * BEAT
        if at >= until:
            break
        drums.put(kick(f0=120, click=0.04, dec=9), at, 0.62)
        if b_ % 2:
            drums.put(snare_soft(), at, 0.32, -0.1)
            drums.put(clap(), at + 0.004, 0.3, 0.12)
        bass.put(cut(sub(ROOT_[c] + 12, BEAT * 0.9), at), at, 0.42)
    for j in range(8):
        at = t0 + j * BEAT / 2
        if at >= until:
            break
        drums.put(hat(0.6 if j % 2 else 0.3, 0.015), at + (0.04 if j % 2 else 0), 0.32, 0.35)   # swing
        m = CH[c][j % 4] + 12
        bus.put(cut(pluck(m, 0.35, 0.22, 0.5), at), at, 1.0, -0.4 + 0.8 * (j % 2))
    if energy > 0.5:
        for b_, m in HOOK[c]:
            at = t0 + b_ * BEAT
            if at < until:
                bus.put(cut(chop(m, BEAT * 0.7, 0.9), at), at, 1.0, 0.08)
                bus.put(cut(bell(m - 12, BEAT * 0.7, 0.35), at), at, 1.0, -0.15)


# ═════════════ 1. NHẠC ═════════════
mus, drums, bass = Bus(), Bus(), Bus()
END = PULSE[1]

# 0 → OFF1 (G1 grid extended backwards): pad + hook pluck + arpeggio; hat + light kick from the second slot
for k, t0 in bars(G1, -BAR, OFF1 + BAR):
    c = PROG[k % 4]
    mus.put(pad(CH[c], BAR + 0.7, att=0.12, rel=0.6, cut=2200), max(t0 - 0.1, 0), 0.45)   # overlaps the next bar: no dip
    for b_, v in ((0, 0.75), (1.5, 0.6), (2.5, 0.55), (3.5, 0.5)):
        mus.put(ep(CH[c], BEAT * 2.5, v), max(0.0, t0 + b_ * BEAT), 1.0, 0.0)
    for j in range(8):
        mus.put(pluck(CH[c][j % 4] + 12, 0.35, 0.18, 0.5), max(0.0, t0 + j * BEAT / 2), 1.0, -0.3 + 0.6 * (j % 2))
    bass.put(sub(ROOT_[c] + 12, BEAT * 1.8), t0, 0.28)
    for b_, m in HOOK[c]:
        at = t0 + b_ * BEAT
        if 0.5 < at < OFF1:
            mus.put(chop(m, BEAT * 0.7, 0.36), at, 1.0, 0.08)
    if t0 > 1.0:
        for j in range(8):
            ramp = min(1.0, 0.35 + j / 10) if t0 < 2.0 else 1.0   # drums ease in on their first bar
            drums.put(hat(0.4 if j % 2 else 0.2, 0.015), t0 + j * BEAT / 2, 0.3 * ramp, 0.3)
        for b_ in (0, 2):
            drums.put(kick(f0=110, click=0.02, dec=10), t0 + b_ * BEAT, 0.2 if t0 < 2.0 else 0.24)
music = mus.x + drums.x + bass.x
# v12: soft 0.4 s fade into the outage instead of a tape stop (user: levels jumping up and down were unpleasant)
music *= np.interp(tm, [OFF1, OFF1 + 0.4], [1.0, 0.0])[:, None]

# hook as the intro settles (t = 0) + dark gap: thunder + riser → DROP (G1)
sec1 = Bus()
sec1.put(crash(2.0), 0.02, 0.3, 0.2)
sec1.put(sub(41, 1.2), 0.02, 0.4)
sec1.put(pad([48, 55, 60, 62, 67], G1 - OFF1 + 0.25, att=0.2, rel=0.12, cut=2600), OFF1 - 0.1, 0.65)   # Csus2 → resolves to F on the drop; covers the outage
sec1.put(riser(G1 - (OFF1 + 0.05), 16), OFF1 + 0.05, 0.5)   # whole dark beat rises into the drop
sec1.put(crash(3.0), G1, 0.35, -0.2)
sec1.put(kick(f0=150, click=0.05), G1, 0.4)
m1, d1, b1 = Bus(), Bus(), Bus()
for k, t0 in bars(G1, G1, END):
    bar_full(m1, d1, b1, k, t0, PROG[k % 4], 1.0, END)
# sidechain on the kick, stronger in the pulse section
duck = np.ones(N)
for k, t0 in bars(G1, G1, END):
    for b_ in range(4):
        at = t0 + b_ * BEAT
        depth = 0.18 if at >= PULSE[0] - 0.01 else 0.12   # v12: gentle (0.62 / 0.4 pumped)
        i = ns(at)
        kk = np.arange(min(ns(0.3), N - i)) / SR
        duck[i:i + len(kk)] = np.minimum(duck[i:i + len(kk)], 1 - depth * np.exp(-kk / 0.1))
music += sec1.x + (m1.x + b1.x) * duck[:, None] + d1.x
# finale breath: the sign drops out 0.25 s before the downbeat (app FINALE_GAP) → the music drops out with it
_g0, _g1 = ns(END - 0.12), ns(END - 0.005)
_env = np.ones(N)
_env[_g0:_g1] = 1.0   # v12: no breath dip (read as a jolt)
_env = np.convolve(_env, np.ones(ns(0.008)) / ns(0.008), mode="same")
music *= _env[:, None]
# final chord at the finale, sustained through the hero hold
fin = Bus()
fin.put(pad([53, 57, 60, 64, 67, 72], DUR - END + 0.4 + TAIL * 0.5, att=0.01, rel=2.2, cut=3600), END - 0.02, 0.7)
fin.put(ep([53, 57, 60, 64, 67], 3.0, 1.1), END - 0.02, 1.0)
fin.put(sub(41, 1.6), END - 0.02, 0.7)
fin.put(kick(f0=140, click=0.04), END - 0.02, 0.45)
fin.put(crash(2.4), END - 0.02, 0.32, 0.2)
# v12 outro (user: "the music stops abruptly"): no drums after the finale hit — the EP walks F → B♭maj7 → F(add9)
# with a short descending bell line, ringing out under the 3 s hold and on under the promo end card
for _k, (_ch, _v) in enumerate(((CH["Bb"], 0.75), ([53, 57, 60, 67, 72], 0.65))):
    _at = END + (_k + 1) * BAR
    fin.put(ep(_ch, 4.5, _v), _at, 1.0)
    fin.put(pad(_ch, 4.0, att=0.6, rel=2.5, cut=2200), _at, 0.25)
for _b, _m in ((2.0, 72), (2.75, 72), (3.5, 69), (4.5, 72), (5.0, 74), (6.0, 72)):
    fin.put(chop(_m, 0.5, 0.45), END + _b * BEAT, 1.0, 0.1)
    fin.put(bell(_m, 1.2, 0.3), END + _b * BEAT, 1.0, -0.15)
music += fin.x

music = music + reverb(music, 1.8) * 0.26
lvl = np.interp(tm, [0, 0.4, OFF1, G1, END, DUR + 0.6], [0.84, 0.86, 0.88, 1.0, 1.0, 1.0])   # v12: flatter
music *= lvl[:, None]

# ═════════════ 2. TIẾNG APP ═════════════
fx = Bus()
R = lambda x: resamp(x)
sw_on, sw_off = R(sa.switch(True)), R(sa.switch(False))
flicks = [R(sa.flick(i)) for i in range(6)]
glitch, flow, freeze = R(sa.glitch()), R(sa.flow()), R(sa.freeze())


def tick(f=2600, sec=0.06, g=0.3):
    t = np.arange(ns(sec)) / SR
    return fades(np.sin(2 * np.pi * f * t) * np.exp(-t / 0.012) * g + band(rng.standard_normal(len(t)), 3000, 9000) * np.exp(-t / 0.002) * 0.15)


def sparkler(sec):
    """sparkler: dense, high-frequency, random crackle"""
    n = ns(sec)
    x = np.zeros(n)
    for _ in range(int(sec * 140)):
        i = rng.integers(0, n - 400)
        k = int(rng.integers(30, 260))
        x[i:i + k] += band(rng.standard_normal(k * 4), 2500, 12000)[:k] * np.exp(-np.arange(k) / (k * 0.3)) * rng.uniform(0.2, 1.0)
    x += band(rng.standard_normal(n), 4000, 10000) * 0.05
    e = np.minimum(np.arange(n) / ns(0.05), 1) * np.clip((n - np.arange(n)) / ns(0.1), 0, 1)
    return x * e * 0.5


def zap(sec=0.9):
    """power on: sizzling discharge + spraying sparks (spark burst at the transformer box)"""
    n = ns(sec)
    t = np.arange(n) / SR
    saw = 2 * ((t * 120) % 1) - 1
    # v91: the 120 Hz saw is mostly gone (too buzzy), a soft sine thump + sparkle carries it
    x = band(saw, 100, 2500) * np.exp(-t / 0.03) * 0.15
    x += np.sin(2 * np.pi * (90 + 120 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.09) * 0.6
    x += band(rng.standard_normal(n), 2500, 11000) * np.exp(-t / 0.04) * 0.5
    x += sparkler(sec) * np.exp(-t / 0.3) * 0.9
    return fades(np.tanh(x * 1.3) * 0.8, 0.0005, 0.05)


def thunder(sec=4.0):
    n = ns(sec)
    t = np.arange(n) / SR
    crack = band(rng.standard_normal(n), 800, 9000) * np.exp(-t / 0.06) * 1.2
    boom = band(rng.standard_normal(n), 25, 260) * (np.exp(-t / 1.1) * (1 - np.exp(-t / 0.08))) * 2.6
    roll = band(rng.standard_normal(n), 60, 600) * np.exp(-t / 1.6) * (0.6 + 0.4 * np.sin(2 * np.pi * 3.1 * t)) * 0.9
    return np.tanh((crack + boom + roll) * 1.1) * 0.9


def whoosh(sec=1.0):
    n = ns(sec)
    u = np.arange(n) / n
    nz = rng.standard_normal(n)
    out = np.zeros(n)
    seg = 1024
    for i in range(0, n - seg, seg // 2):
        fc = 600 * (10 ** u[i])
        out[i:i + seg] += band(nz[i:i + seg], fc * 0.6, fc * 1.6) * np.hanning(seg)
    return out * np.sin(np.pi * u) ** 1.5 * 0.7


# drawing: sparkler sound following the pen tip + "ting" when the tube freezes
UL_END = UL_AT + UL_LEN / UL_SPEED
for a, b in ((HEART_AT, HEART_END), (STAR_AT, STAR_END), (UL_AT, UL_END)):
    fx.put(sparkler(b - a + 0.05), a, 0.3, -0.1)
    fx.put(freeze, b + 0.02, 0.3, 0.1)
# tube touch + colour touch + gas flow
# script: tube tap at `at` − 0.45, chip tap at `at`, gas flows from `at` (checked frame by frame on v77; the v75
# "fix" had shifted all three 0.45 s late)
for at in RECOLOR:
    fx.put(tick(2800), at - 0.45, 0.6, 0.1)
    fx.put(tick(3400, g=0.35), at, 0.8, 0.2)
    fx.put(flow, at + 0.02, 0.75)
for i, at in enumerate(QUICK):
    fx.put(flow, at, 0.42, -0.5 if i % 2 else 0.5)
    fx.put(tick(4200 if i % 2 else 3600, 0.04, 0.25), at, 0.5, 0.0)
fx.put(whoosh(0.6), CHASE_LAST - 0.05, 0.6)
# finale: every tube flashes + sparks fly from every segment
# finale power-surge stutter (app: two 2-frame dips at −0.15 / −0.07 s) → two crackles
for _i, _d in enumerate((-0.15, -0.07)):
    fx.put(flicks[(_i + 3) % len(flicks)], PULSE[1] + _d, 0.55, -0.2 + 0.4 * _i)
fx.put(zap(1.4), PULSE[1], 0.35, 0.0)
fx.put(sparkler(1.2) * np.exp(-np.arange(ns(1.2)) / SR / 0.5), PULSE[1] + 0.02, 0.8, -0.2)
# switch
for at, on in SWITCH:
    if at > 0.5:          # opening switch-on has no finger → zap only, no flick sound
        fx.put(sw_on if on else sw_off, at - 0.01, 0.8 if on else 0.9, 0.35)
    elif not on:          # opening: short circuit snaps off → buzzy "pop"
        fx.put(glitch, at - 0.01, 0.8, 0.0)
    if on:
        fx.put(zap(), at + 0.05, 0.35, 0.25)
# electric pulse along the cables (app: Decor WirePulse): off → power drains back to the box (downward "zzip", quiet);
# finale → pulses on every cable converge on the transformer box at +0.24 s (deep "thump" + short buzz)
def digi_glitch(sec=0.22):
    """digital glitch (matches IntroLens colour split / band shift): repeated 28 ms grain, bitcrush + downsample, volume stutter"""
    n = ns(sec)
    g = ns(0.028)
    src = band(rng.standard_normal(g), 400, 9000) + np.sin(2 * np.pi * 1450 * np.arange(g) / SR) * 0.6
    x = np.tile(src, n // g + 1)[:n]
    hold = 6
    x = np.repeat(x[::hold], hold)[:n]                      # downsample → digital aliasing
    x = np.round(x * 6) / 6                                  # bitcrush
    gate = np.repeat(rng.choice([0.0, 0.5, 1.0], n // ns(0.018) + 1, p=[0.25, 0.3, 0.45]), ns(0.018))[:n]
    return fades(x * gate * 0.5, 0.001, 0.03)


def zip_down(sec=0.36, f0=1800.0, f1=240.0):
    n = ns(sec)
    t = np.arange(n) / SR
    f = f0 * (f1 / f0) ** (t / sec)
    ph = 2 * np.pi * np.cumsum(f) / SR
    buzz = np.sin(ph) * 0.7 + np.sin(ph * 2) * 0.12   # smooth (the square wave buzzed)
    x = band(buzz, 150, 6000) * np.exp(-t / (sec * 0.6))
    x += band(rng.standard_normal(n), 2000, 9000) * np.exp(-t / 0.05) * 0.4
    return fades(x * 0.6, 0.002, 0.04)


def box_thump(sec=0.5):
    t = np.arange(ns(sec)) / SR
    body = np.sin(2 * np.pi * (70 + 60 * np.exp(-t / 0.03)) * t) * np.exp(-t / 0.14)
    rasp = band(rng.standard_normal(len(t)), 300, 3000) * np.exp(-t / 0.04) * 0.5
    return fades(np.tanh((body + rasp) * 1.4) * 0.8, 0.001, 0.05)


for at, on in SWITCH:
    if not on:
        fx.put(zip_down(), at + 0.01, 0.32 if at > 0.5 else 0.22, 0.3)
fx.put(box_thump(), PULSE[1] + 0.24, 0.3, 0.35)
# heart ignition (app: born + BORN_DELAY 0.3 + FIRST_FLASH 0.05): a hum clunk so it is not silent (critic 6)
fx.put(box_thump(0.4), HEART_END + 0.35, 0.28, 0.1)
fx.put(zap(0.35), HEART_END + 0.35, 0.25, 0.1)
# star ignition + palette chip tap accents (critic 8: no onset 2.2–4.3 s)
fx.put(box_thump(0.4), STAR_END + 0.35, 0.26, -0.3)
fx.put(zap(0.35), STAR_END + 0.35, 0.22, -0.3)
for _r in RECOLOR:
    fx.put(whoosh(0.45), _r + 0.02, 0.35, 0.2)
# end card: the "Neon Sign" logo tube strikes (promo.py: flickers at card + 0.30 / 0.38 / 0.47, lit at 0.58)
# (v12: no logo crackles — the music outro carries into the card; they also sounded in final.mp4 with no card)


# digital glitch matching the lens layer (src/intro BeatLens) on peak beats: drop 1, drop 2, finale (2 beats)
# (digital glitches on the drops removed: harsh)

# broken tube
for at, kind in BROKEN:
    fx.put(glitch, at - 0.01, 0.75 if kind == "restrike" else 0.55, -0.3)
    if kind == "restrike":
        for d in (0.28, 0.5, 0.62):
            fx.put(flicks[int(d * 10) % 6], at + d, 0.5, -0.3)
# thunder
for at in THUNDER:
    fx.put(thunder(), at, 1.0)
# light pulse running along the tubes
for at in CHASE:
    fx.put(whoosh(1.0), at - 0.1, 0.8, -0.2)
    fx.put(whoosh(0.8), at + 0.3, 0.5, 0.3)

# crackle on each ignition flicker: detected in the recording (sign area brightness jumps), excluding colour change / lightning / running pulses
lum = lum_t = None
if SCREEN:
    W, H = 22, 48
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", os.path.join(ROOT, SCREEN), "-vf", f"scale={W}:{H},format=gray",
                          "-f", "rawvideo", "-"], capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)
    lum = fr[:, int(H * 0.2):int(H * 0.72)].mean(axis=(1, 2))
    lum_t = np.arange(len(lum)) / 60.0 - PRE
    d = np.diff(lum, prepend=lum[0])
    thr = max(1.2, np.percentile(np.abs(d), 99) * 0.3)
    skip = [(a - 0.1, a + 0.8) for a in RECOLOR + QUICK] + [(a - 0.05, a + 1.2) for a in THUNDER] + [(a - 0.1, a + 2.0) for a in CHASE] \
        + [(PULSE[0] - 0.1, PULSE[1] + 0.5)]
    rises, last = [], -1
    for i in range(3, len(lum)):
        tt = lum_t[i]
        if tt < 0 or any(a < tt < b for a, b in skip):
            continue
        if lum[i] - lum[i - 3:i].min() > thr and tt - last > 0.05:
            rises.append(tt)
            last = tt
    print("MIX rises", len(rises), [round(float(x), 2) for x in rises[:40]])
    for i, at in enumerate(rises):
        fx.put(flicks[i % 6], at - 0.005, 0.28, float(rng.uniform(-0.4, 0.4)))

# transformer hum following real brightness (or the switch if there is no recording)
h = R(sa.hum())
hum = np.tile(h, int(np.ceil(N / len(h))) + 1)[:N]
if lum is not None:
    base = np.percentile(lum, 3)
    top = np.percentile(lum, 85)
    vol = np.interp(tm, lum_t, np.clip((lum - base) / max(1e-3, top - base), 0, 1.3))
else:
    vol = np.zeros(N)
    for (a, on), (b, _) in zip(SWITCH, SWITCH[1:] + [(DUR + 1, None)]):
        vol[(tm >= a) & (tm < b)] = 1.0 if on else 0.0
    vol[tm < SWITCH[0][0]] = 0.0
vol = np.convolve(vol, np.ones(480) / 480, mode="same")
# (transformer hum bed removed: the constant 120 Hz buzz was unpleasant, user 02/11)

# rain + drips into the puddle
rain = band(rng.standard_normal(N), 400, 7000)
rain = rain / (np.std(rain) + 1e-9) * 0.035 * (1 + 0.15 * np.sin(2 * np.pi * 0.11 * tm))
amb = Bus()
amb.put(np.stack([rain, np.roll(rain, 997)], 1), 0, 1.0)
for at in np.cumsum(rng.uniform(0.25, 0.9, 120)):
    if at < DUR:
        k = ns(0.07)
        tt = np.arange(k) / SR
        f = 1300 + rng.uniform(-300, 700)
        amb.put(np.sin(2 * np.pi * (f + 900 * tt / 0.07) * tt) * np.exp(-tt * 70) * 0.06, at, 1.0, float(rng.uniform(-0.7, 0.7)))
# dark gap: slightly heavier rain
dark = np.interp(tm, [OFF1, OFF1 + 0.4, ON1, ON1 + 0.6], [1, 1.3, 1.3, 1])   # v12: 1.8 jumped
amb.x *= dark[:, None]

mix = music * 0.9 + fx.x * 0.6 + amb.x * 0.6   # v12: effects / rain under the music (user)
k = ns(0.5)
mix[-k:] *= np.linspace(1, 0, k)[:, None]
mix = mix[:ns(DUR + 0.6 + TAIL)]

# ── "LIVE WIRE" app opening sound (src/intro/timeline.ts: times read straight from the file so they always match the picture) ──
def _intro_times():
    src = open(os.path.join(ROOT, "app/src/intro/timeline.ts")).read()
    g = lambda k: float(re.search(rf"export const {k} = (-?[\d.]+)", src).group(1))
    st = [tuple(map(float, m)) for m in re.findall(r"\[(-?[\d.]+), ([\d.]+), ([\d.]+)\]", src[src.index("const STRIKES"):src.index("];", src.index("const STRIKES"))])]
    return {k: g(k) for k in ("T_CONDUIT", "T_BOX", "T_LAUNCH", "T_HIT", "T_SURGE")}, st


def arc_buzz(sec, amp=1.0):
    """short-circuit arc: 120 Hz buzz (saw) + crackle, amplitude jerks with the shorting rhythm"""
    n = ns(sec)
    t = np.arange(n) / SR
    saw = 2 * ((t * 120) % 1) - 1
    gate = np.repeat(rng.uniform(0.35, 1.0, n // 400 + 1), 400)[:n]
    x = band(saw, 180, 5000) * gate * 0.7
    x += band(rng.standard_normal(n), 2500, 11000) * (rng.random(n) < 0.02) * 2.0
    x += band(rng.standard_normal(n), 1200, 8000) * 0.25 * gate
    return fades(np.tanh(x * 1.6) * 0.7 * amp, 0.002, 0.02)


def sub_drone(sec):
    t = np.arange(ns(sec)) / SR
    x = np.sin(2 * np.pi * 41 * t) * 0.6 + np.sin(2 * np.pi * 82 * t) * 0.15
    return x * np.minimum(1, t / 0.5) * 0.5


def intro_cues(b, pre):
    """LIVE WIRE v4 intro (1.4 s hook): plasma particle races along the cable → hits the electrode at T_HIT → gas writes the letters → bloom at T_SURGE"""
    T, _ = _intro_times()
    at = lambda t: t + pre          # scene seconds → time in the intro bus (0 = first frame = −pre)
    # (no 41 Hz drone: read as an unpleasant hum, user 02/11)
    # music bed under the whole hook (critic 2: level sagged to −24 dB right after the first hit)
    b.put(pad([48, 55, 60, 64, 67], pre + 0.5, att=0.02, rel=0.45, cut=2600), 0, 0.45)
    b.put(ep([48, 55, 60, 64], pre + 0.5, 0.8), 0, 1.0)
    # plasma particle: rising whoosh + crackle, runs from before the first frame until impact
    fl = T["T_HIT"] - T["T_LAUNCH"]
    b.put(whoosh(fl + 0.08), at(T["T_LAUNCH"]), 0.75, 0.25)
    b.put(sparkler(fl) * 0.7, at(T["T_LAUNCH"]), 0.4, 0.1)
    # electrode impact: sharp zap + sub
    # clip now opens mid-hit (frame 1 = bead on the electrode): land the transient on frame 1, never before it
    hit = max(0.0, at(T["T_HIT"]))
    b.put(zap(0.6), hit, 0.45, -0.3)
    b.put(box_thump(0.5), hit, 0.3, -0.2)
    # gas sizzle builds up to the bloom, each letter ignition gets a double crackle
    gl = T["T_SURGE"] - T["T_HIT"]
    n = ns(gl)
    tt = np.arange(n) / SR
    siz = band(rng.standard_normal(n), 3000, 10000) * (0.25 + 0.75 * tt / gl) * 0.25
    b.put(fades(siz, 0.02, 0.03), at(T["T_HIT"]), 0.8, -0.1)
    for lt in (-0.94, -0.80, -0.66, -0.52, -0.31):
        b.put(flicks[int(abs(lt) * 100) % 6], at(lt), 0.5, float(rng.uniform(-0.4, 0.4)))
        b.put(flicks[int(abs(lt) * 37) % 6], at(lt) + 0.14, 0.35, float(rng.uniform(-0.4, 0.4)))
    # bloom: riser lands on time, soft deep "whoomph" (no digital glitch), thin crash
    rz = riser(0.9)
    b.put(rz * 0.5, at(T["T_SURGE"]) - len(rz) / SR, 0.6)
    b.put(box_thump(0.9), at(T["T_SURGE"]), 0.4)
    b.put(crash(1.6) * 0.45, at(T["T_SURGE"]), 0.3)


# intro (app opening, src/intro) before t = 0: built separately then prepended
if PRE > 0:
    NI = ns(PRE)
    ti = np.arange(NI) / SR
    ib = Bus(NI + ns(2.0))   # time 0 = t −PRE; the part spilling past t = 0 is added to the start of the main mix
    rn = band(rng.standard_normal(NI), 400, 7000)
    rn = rn / (np.std(rn) + 1e-9) * 0.035 * np.minimum(1, ti / 0.4)
    ib.x[:NI] += np.stack([rn, np.roll(rn, 997)], 1)
    try:
        intro_cues(ib, PRE)
    except NameError:
        pass
    head = ib.x[:NI]
    tailx = ib.x[NI:]
    mix[:len(tailx)] += tailx[:len(mix)]
    mix = np.concatenate([head, mix], 0)

# ═════════════ 3. MASTER ═════════════
# v12 glue compressor (user: music and effects jumping up and down): RMS in 10 ms blocks, attack 15 ms / release
# 300 ms, 3:1 above −20 dB of the peak, gain interpolated per sample → bed and hits sit on one level
def glue(x, thr_db=-20.0, ratio=3.0, att=0.015, rel=0.3):
    blk = ns(0.01)
    nb = len(x) // blk + 1
    pad_ = np.zeros((nb * blk, 2))
    pad_[:len(x)] = x
    r = np.sqrt((pad_.reshape(nb, blk, 2) ** 2).mean(axis=(1, 2)) + 1e-12)
    pk_ = np.max(np.abs(x)) or 1
    lvl_db = 20 * np.log10(r / pk_)
    over = np.maximum(0.0, lvl_db - thr_db)
    tgt = -over * (1 - 1 / ratio)
    g = np.zeros(nb)
    a_c, r_c = math.exp(-0.01 / att), math.exp(-0.01 / rel)
    cur = 0.0
    for i in range(nb):
        c = a_c if tgt[i] < cur else r_c
        cur = c * cur + (1 - c) * tgt[i]
        g[i] = cur
    gs = np.interp(np.arange(len(x)), np.arange(nb) * blk + blk / 2, 10 ** (g / 20))
    return x * gs[:, None]


mix = glue(mix)
pre = OUT[:-4] + "_pre.wav"
os.makedirs(os.path.dirname(OUT), exist_ok=True)
pk = np.max(np.abs(mix)) or 1
x16 = (np.clip(mix / pk * 0.9, -1, 1) * 32767).astype("<i2")
with wave.open(pre, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(x16.tobytes())
meas = subprocess.run(["ffmpeg", "-hide_banner", "-i", pre, "-af", "loudnorm=I=-15:TP=-3:LRA=11:print_format=json", "-f", "null", "-"],
                      capture_output=True, text=True).stderr
js = json.loads(meas[meas.rindex("{"):meas.rindex("}") + 1])
af = (f"loudnorm=I=-15:TP=-3:LRA=11:measured_I={js['input_i']}:measured_TP={js['input_tp']}:measured_LRA={js['input_lra']}"
      f":measured_thresh={js['input_thresh']}:offset={js['target_offset']}:linear=true,aresample=48000")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", pre, "-af", af, "-c:a", "pcm_s16le", OUT], check=True)
os.remove(pre)
out = subprocess.run(["ffmpeg", "-hide_banner", "-i", OUT, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
I_ = re.search(r"I:\s*(-?[\d.]+) LUFS", out[out.rindex("Summary"):]).group(1)
print(f"MIX → {os.path.relpath(OUT, ROOT)}  {I_} LUFS")
