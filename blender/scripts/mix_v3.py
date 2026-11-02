# Audio for the X clip v3 (demo script v3, src/demo/script.ts): synthesized with numpy, no copyrighted samples.
#   - warm neon hum (smooth 120 Hz transformer, little high sizzle) following the sign's real brightness in the recording
#   - switch off / on click, crackle on each ignition flicker (detected in the recording), "pop" of the broken o, gas flow on colour change
#   - light pen while drawing the heart, glass "ting" when a tube freezes, tube touch + palette pop-up
#   - soft light rain (harsh band filtered out), drops falling into the puddle
#   - synthwave / lo-fi music with a hook, beat grid anchored to the moment the sign flares up (DROP): Am–F–C–G, music "tape stops" exactly
#     when the switch is flipped off, the dark gap is rain only, riser on power back on → DROP, end card a long sustained C major chord.
#   - master for X: −14 LUFS integrated, true peak ≤ −1 dBTP (ffmpeg loudnorm 2 passes, linear), 48 kHz stereo 24-bit.
# Times = app seconds (t = 0 of the scene clock); promo.sh trims the first app_start seconds to match the picture.
#
#   Blender -b --factory-startup -P blender/scripts/mix_v3.py -- --beats blender/scripts/beats/v3.json \
#       --screen render/promo/v3/screen.mp4 --film-start 0.733 [--out render/audio/mix_v3.wav]
import json, math, os, re, shutil, subprocess, sys, wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth_audio as sa  # noqa: E402  (only the sound generators are used; the file export only runs when called directly)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
ROOT = sa.ROOT
BEATS = json.load(open(os.path.join(ROOT, arg("--beats", "blender/scripts/beats/v3.json"))))
OUT = os.path.join(ROOT, arg("--out", BEATS.get("audio", "render/audio/mix_v3.wav")))
SCREEN = arg("--screen")
FILM0 = float(arg("--film-start", "0"))
SR = 48000
CARD_AT = BEATS["app_end"]
DUR = CARD_AT + BEATS.get("card", 3.2) + 0.4
N = int(DUR * SR)
rng = np.random.default_rng(7)
db = lambda x: 10 ** (x / 20)
ns = lambda sec: int(round(sec * SR))
tm = np.arange(N) / SR

# demo script v3 (matches src/demo/script.ts)
HEART_AT, TAPS, COLORS = 0.45, (2.85, 4.1), (3.3, 4.55)
BROKEN, OFF, ON = 6.9, 8.6, 9.75
Z = 440 / 402


def heart_len():
    p = []
    for i in range(73):
        t = math.pi * 2 * i / 72
        p.append((16 * math.sin(t) ** 3 * 3.0 * Z, -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) * 3.0 * Z))
    return sum(math.dist(p[i], p[i - 1]) for i in range(1, len(p)))


HEART_END = HEART_AT + heart_len() / (360 * Z)


# ───────────── detect sign brightness in the recording ─────────────
lum_t = lum = lumH = None


def lum_of(vf):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", os.path.join(ROOT, SCREEN), "-vf", vf + ",format=gray",
                          "-f", "rawvideo", "-"], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 32 * 32).astype(np.float32).mean(axis=1)


if SCREEN:
    lum = lum_of("crop=iw:ih*0.47:0:ih*0.15,scale=32:32")                  # sign area (excluding ground / switch)
    lumH = lum_of("crop=iw*0.5:ih*0.2:iw*0.3:ih*0.52,scale=32:32")         # around the heart
    lum_t = np.arange(len(lum)) / 60.0 - FILM0


def rises_in(a, b, skip=(), src=None, thr=None):
    out, last = [], -1.0
    y = lum if src is None else src
    if y is None:
        return out
    if thr is None:
        thr = max(1.2, np.percentile(np.abs(np.diff(y)), 99) * 0.3)
    for i in range(3, len(y)):
        t = lum_t[i]
        if t < a or t > b or any(-0.1 < t - s < 0.75 for s in skip):
            continue
        if y[i] - y[i - 3:i].min() > thr and t - last > 0.045:
            out.append(float(t))
            last = t
    return out


if lum is not None:
    steady = np.median(lum[(lum_t > ON + 1.6) & (lum_t < ON + 2.6)])
    k = np.where((lum_t > ON + 0.3) & (lum >= 0.93 * steady))[0]
    DROP = float(lum_t[k[0]]) if len(k) else ON + 1.0
    FLICKS_ON = rises_in(ON, DROP + 0.1)
    FLICKS_HEART = rises_in(HEART_END + 0.2, HEART_END + 2.2, skip=COLORS, src=lumH, thr=6.0)
else:
    DROP = BEATS.get("lit", ON + 1.0)
    FLICKS_ON = [ON + 0.05] + sorted(ON + 0.2 + rng.uniform(0, 0.8, 6))
    FLICKS_HEART = sorted(HEART_END + 0.5 + rng.uniform(0, 0.6, 4))
BAR = CARD_AT - DROP                      # one bar from DROP to the end card → the final chord lands on beat 1
if arg("--bpm"):
    # fixed tempo: end card = DROP + 1 bar; write the new time into the beat sheet (promo.py reads app_end from it)
    BAR = 240.0 / float(arg("--bpm"))
    CARD_AT = round(DROP + BAR, 3)
    DUR = CARD_AT + BEATS.get("card", 3.2) + 0.4
    N = int(DUR * SR)
    tm = np.arange(N) / SR
    BEATS["app_end"] = CARD_AT
    bp = os.path.join(ROOT, arg("--beats"))
    json.dump(BEATS, open(bp, "w"), indent=1, ensure_ascii=False)
    print(f"MIX app_end → {CARD_AT} (written to {arg('--beats')})")
BEAT = BAR / 4
BPM = 60 / BEAT
print(f"MIX heart {HEART_AT:.2f}–{HEART_END:.2f} | DROP {DROP:.3f} | BPM {BPM:.1f} | flicks heart {len(FLICKS_HEART)} on {len(FLICKS_ON)}")


# ───────────── bus stereo ─────────────
class Bus:
    def __init__(self):
        self.x = np.zeros((N, 2))

    def put(self, sig, at, gain=1.0, pan=0.0):
        i = ns(at)
        if i >= N or i + len(sig) <= 0:
            return
        s = sig * gain
        if i < 0:
            s, i = s[-i:], 0
        s = s[:N - i]
        if s.ndim == 1:
            self.x[i:i + len(s), 0] += s * math.sqrt((1 - pan) / 2) * 1.414
            self.x[i:i + len(s), 1] += s * math.sqrt((1 + pan) / 2) * 1.414
        else:
            self.x[i:i + len(s)] += s


def band(x, lo, hi):
    return sa.band(x, lo, hi, SR)


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


hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)

# ═════════════ 1. NHẠC ═════════════
mus, drums, bass, lead = Bus(), Bus(), Bus(), Bus()


def at_(bar, beat=0.0):
    return DROP + bar * BAR + beat * BEAT


def pluck(m, sec=0.9, vel=1.0, bright=1.0):
    """warm lo-fi synth pluck: soft saw (1/h harmonics) decaying faster with harmonic order → bright on attack, warm tail; 2 detuned voices."""
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
    """soft lead for the DROP: filtered saw + light vibrato after 0.15 s, octave-down voice."""
    n = ns(sec)
    t = np.arange(n) / SR
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.15) / 0.2, 0, 1)
    x = np.zeros(n)
    for mult, g in ((1, 1.0), (0.5, 0.45)):
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


def snap(vel=1.0):
    n = ns(0.1)
    t = np.arange(n) / SR
    x = band(rng.standard_normal(n), 1500, 5500) * np.exp(-t / 0.01) * 0.5 + np.sin(2 * np.pi * 1750 * t) * np.exp(-t / 0.007) * 0.3
    return fades(x * vel, 0.0002, 0.02)


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


# chords (MIDI) and hook: Am – F – C – G; hook slides down "E–A–G–E … D–E"
CH = {"Am": [57, 60, 64], "F": [53, 57, 60], "C": [55, 60, 64], "G": [55, 59, 62]}
ROOT_ = {"Am": 45, "F": 41, "C": 48, "G": 43}
HOOK = {
    "Am": [(0, 76), (0.5, 81), (1, 79), (1.5, 76), (2.5, 74), (3, 76)],
    "F": [(0, 81), (0.5, 79), (1, 77), (1.5, 76), (2.5, 72), (3, 74)],
    "C": [(0, 76), (0.5, 79), (1, 84), (1.5, 83), (2, 79), (3, 76)],
    "G": [(0, 74), (0.5, 79), (1, 83), (1.5, 81), (2.5, 79), (3, 74)],
}
PROG = ["Am", "F", "C", "G"]
INTRO = list(range(-5, -1))                 # 4 bars before the lights go off (bar −1 = dark gap + power back on)
for bi, bar in enumerate(INTRO):
    c = PROG[bi % 4]
    t0 = at_(bar)
    mus.put(pad(CH[c], BAR + 0.5, att=0.25 if bi else 0.02), t0 - (0.0 if bi else 0.1), 0.5)
    for b_, m in HOOK[c]:
        mus.put(pluck(m, 0.9, 0.95 if b_ == 0 else 0.8), at_(bar, b_), 1.0, 0.15 * ((m % 5) - 2) / 2)
    for k in range(8):                        # faint 8-note arpeggio in the background
        m = CH[c][k % 3] + (12 if k % 4 == 3 else 0)
        mus.put(pluck(m, 0.45, 0.35, 0.6), at_(bar, k * 0.5 + 0.25), 1.0, -0.4 + 0.8 * (k % 2))
    bass.put(sub(ROOT_[c], BEAT * 1.8), at_(bar), 0.36)
    bass.put(sub(ROOT_[c], BEAT * 1.6), at_(bar, 2.5), 0.26)
    if bi >= 1:
        for b_ in (0, 2):
            drums.put(kick(f0=120, click=0.06), at_(bar, b_), 0.4)
        for b_ in (1, 3):
            drums.put(snap(), at_(bar, b_), 0.5)
        for k in range(8):
            drums.put(hat(0.6 if k % 2 else 0.35), at_(bar, k * 0.5 + (0.04 if k % 2 else 0)), 0.5, 0.3)

# tape stop exactly on the switch-off: music from OFF slows down to 0 over 0.5 s then goes silent
music = mus.x + drums.x * 0.9 + bass.x
i0, L = ns(OFF), ns(0.5)
tau = np.arange(L) / SR
pos = OFF + tau - tau ** 2 / (2 * 0.5)
ts = np.empty((L, 2))
for ch in range(2):
    ts[:, ch] = np.interp(pos, tm, music[:, ch]) * (1 - tau / 0.5) ** 0.5
music[i0:] = 0
music[i0:i0 + L] = ts

# riser on power back on: rising filtered noise sweep + reversed G chord, ending right at DROP
drop = Bus()
rl = DROP - ON
n = ns(rl)
t = np.arange(n) / SR
u = t / rl
nz = rng.standard_normal(n)
ris = np.zeros(n)
seg = 2048
for i in range(0, n - seg, seg // 2):
    fc = 400 * (12 ** u[i])
    ris[i:i + seg] += band(nz[i:i + seg], fc * 0.5, fc * 1.5) * np.hanning(seg)
ris *= u ** 2.2 * 0.5
drop.put(ris, ON, 1.0)
drop.put(pad(CH["G"] + [67], rl, att=rl * 0.9, rel=0.02, cut=3500) * (u ** 2)[:ns(rl)] * 1.2, ON, 0.9)

# DROP: one full bar Am | F, four-on-the-floor kick, clap on 2 & 4, offbeat hat, lead hook + pad ducked by the kick
crash = band(rng.standard_normal(ns(2.0)), 3000, 11000) * np.exp(-np.arange(ns(2.0)) / SR * 2.4) * 0.35
drop.put(crash, DROP, 1.0, 0.2)
drop.put(kick(f0=160, click=0.12), DROP, 1.0)
for half, c in ((0, "Am"), (2, "F")):
    drop.put(pad(CH[c] + [CH[c][0] + 12], BEAT * 2 + 0.2, att=0.02, rel=0.15, cut=4200), at_(0, half), 0.62)
    drop.put(sub(ROOT_[c], BEAT * 0.9), at_(0, half), 0.55)
    drop.put(sub(ROOT_[c] + 12, BEAT * 0.45), at_(0, half + 1.5), 0.45)
for b_ in range(4):
    drop.put(kick(click=0.12), at_(0, b_), 0.7)
    if b_ % 2:
        drop.put(clap(), at_(0, b_), 0.7, -0.1)
for k in range(8):
    drop.put(hat(0.8 if k % 2 else 0.45), at_(0, k * 0.5 + (0.03 if k % 2 else 0)), 0.6, 0.35)
for b_, m in HOOK["Am"][:3] + [(2, 77), (2.5, 76), (3, 74), (3.5, 72)]:
    drop.put(lead_note(m, BEAT * 0.6), at_(0, b_), 1.0, 0.1)
# end card: long sustained C major add9 chord + rising arpeggiated pluck + one kick/sub hit
ring = BEATS.get("card", 3.2) + 0.3
drop.put(pad([48, 55, 60, 64, 67, 74], ring, att=0.01, rel=1.6, cut=3800), CARD_AT, 0.75)
drop.put(sub(36, 1.6), CARD_AT, 0.9)
drop.put(kick(f0=150, click=0.1), CARD_AT, 0.9)
for k, m in enumerate((72, 76, 79, 84, 88)):
    drop.put(pluck(m, 1.6, 0.8), CARD_AT + 0.05 + k * BEAT / 2, 1.0, -0.5 + 0.25 * k)
# kick sidechain compression during the DROP
duck = np.ones(N)
for b_ in range(4):
    i = ns(at_(0, b_))
    k = np.arange(min(ns(0.25), N - i)) / SR
    duck[i:i + len(k)] = np.minimum(duck[i:i + len(k)], 1 - 0.45 * np.exp(-k / 0.09))
dx = drop.x.copy()
dx[ns(DROP):ns(CARD_AT)] *= duck[ns(DROP):ns(CARD_AT), None]
music = music + dx

# reverb + per-section levels: the opening sits back so app sounds are clear, DROP pushes forward
music = music + reverb(music, 1.8) * 0.28
lvl = np.interp(tm, [0, 0.3, OFF, DROP - 0.01, DROP, CARD_AT, DUR], [0.62, 0.7, 0.72, 0.9, 1.0, 1.0, 1.0])
music *= lvl[:, None]

# ═════════════ 2. TIẾNG APP ═════════════
fx = Bus()
S44 = 44100


def warm_hum(sec):
    """warm neon hum: 120 Hz + lightly saturated low harmonics, very little high sizzle (not harsh), slow wobble"""
    n = ns(sec)
    t = np.arange(n) / SR
    x = sum(a * np.sin(2 * np.pi * 120 * h * t + h * 0.7) for h, a in ((1, 1.0), (2, 0.5), (3, 0.3), (4, 0.12), (5, 0.08)))
    x = np.tanh(x * 0.7) * (1 + 0.05 * np.sin(2 * np.pi * 0.37 * t))
    fizz = band(rng.standard_normal(n), 2200, 4800)
    fizz = fizz / (fizz.std() + 1e-9) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 60 * t))) * 0.035
    return band(x, 70, 1600) * 0.45 + fizz


if lum is not None:
    base = np.percentile(lum[(lum_t > OFF + 0.3) & (lum_t < ON - 0.05)], 50)
    top = np.percentile(lum[(lum_t > DROP + 0.3) & (lum_t < CARD_AT)], 60)
    lv = np.clip((lum - base) / max(1e-3, top - base), 0, 1.25)
    vol = np.interp(tm, lum_t, lv, left=lv[0], right=lv[-1])
else:
    vol = np.ones(N) * ((tm < OFF) | (tm > ON + 0.05))
vol = np.convolve(vol, np.ones(ns(0.004)) / ns(0.004), mode="same")
hum = warm_hum(N / SR + 0.01)[:N] * vol
hum[ns(CARD_AT):] *= np.linspace(1, 0, N - ns(CARD_AT)) ** 2       # end card: hum fades out
fx.put(hum, 0, 0.38)

sw_on, sw_off = resamp(sa.switch(True)), resamp(sa.switch(False))
fx.put(sw_off, OFF - 0.008, 0.85, 0.45)
fx.put(sw_on, ON - 0.008, 0.95, 0.45)


def soft_flick(seed):
    return band(resamp(sa.flick(seed)), 120, 6500)


for i, t_ in enumerate(FLICKS_ON):
    fx.put(soft_flick(i), t_, 0.55 if i else 0.75, float(rng.uniform(-0.25, 0.25)))
for i, t_ in enumerate(FLICKS_HEART):
    fx.put(soft_flick(10 + i), t_, 0.4, 0.15)
fx.put(band(resamp(sa.glitch()), 80, 6500), BROKEN - 0.01, 0.55, -0.1)
fx.put(resamp(sa.freeze()), HEART_END, 0.55, 0.1)
for t_ in COLORS:
    fx.put(resamp(sa.flow()), t_, 0.6)

# light pen while drawing the heart: warm "shhh" sound, pitch gliding with the stroke
n = ns(HEART_END - HEART_AT)
t = np.arange(n) / SR
pen = np.zeros(n)
nz = rng.standard_normal(n)
for i in range(0, n - 1024, 512):
    fc = 900 + 500 * math.sin(i / n * math.pi * 2.2)
    pen[i:i + 1024] += band(nz[i:i + 1024], fc * 0.6, fc * 1.8) * np.hanning(1024)
pen *= np.minimum(t / 0.08, 1) * np.clip((t[-1] - t) / 0.1, 0, 1) * 0.16
fx.put(pen, HEART_AT, 1.0, 0.1)


def tick(f=2600, sec=0.06, g=0.3):
    n = ns(sec)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) * np.exp(-t * 90) + band(rng.standard_normal(n), 2000, 7000) * np.exp(-t * 400) * 0.3) * g


def bloop(sec=0.16):
    n = ns(sec)
    t = np.arange(n) / SR
    f = 520 + 380 * (t / sec)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 22) * np.minimum(t / 0.004, 1) * 0.28


for t_ in TAPS:
    fx.put(tick(2300), t_ - 0.45 + 0.0, 0.8, 0.0)     # tube touch (finger touches at d = −0.45)
    fx.put(bloop(), t_ - 0.45 + 0.03, 0.9, 0.15)     # palette pops up
for t_ in COLORS:
    fx.put(tick(3100, 0.05, 0.28), t_, 0.9, 0.2)     # colour swatch touch

# neon logo on the end card flickers a few beats (promo.py f_logo = card + 0.3)
for k, dt in enumerate((0.3, 0.38, 0.47, 0.58)):
    fx.put(soft_flick(30 + k), CARD_AT + dt, 0.35, -0.3)

# ═════════════ 3. LIGHT RAIN ═════════════
amb = Bus()
rain = band(rng.standard_normal(N), 250, 3800)
rain = rain / (rain.std() + 1e-9)
rain *= 0.055 * (1 + 0.18 * np.sin(2 * np.pi * 0.11 * tm) + 0.1 * np.sin(2 * np.pi * 0.37 * tm + 1))
rain2 = band(rng.standard_normal(N), 250, 3800)
rain2 = rain2 / (rain2.std() + 1e-9) * 0.055 * (1 + 0.18 * np.sin(2 * np.pi * 0.13 * tm + 2))
# slightly heavier rain in the dark gap (rain only)
rl_ = np.interp(tm, [0, OFF, OFF + 0.3, ON - 0.1, ON + 0.6, DUR], [0.85, 0.85, 1.5, 1.5, 0.85, 0.75])
amb.x[:, 0] += rain * rl_
amb.x[:, 1] += rain2 * rl_
t_ = 0.0
while t_ < DUR:
    t_ += float(rng.exponential(0.11))
    n = ns(0.05)
    tt = np.arange(n) / SR
    f = float(rng.uniform(700, 1500))
    drip = np.sin(2 * np.pi * (f + 600 * tt / 0.05) * tt) * np.exp(-tt * 95) * float(rng.uniform(0.006, 0.02))
    amb.put(drip, t_, 1.0, float(rng.uniform(-0.8, 0.8)))

# ═════════════ 4. TRỘN + MASTER ═════════════
mix = music * db(-4) + fx.x * db(-1) + amb.x * db(-3)
# cut below 35 Hz (phone speakers can't play it, it only eats headroom) + slight mid tilt for clarity on small speakers
for ch in range(2):
    mix[:, ch] = band(mix[:, ch], 35, None)
    mix[:, ch] += band(mix[:, ch], 900, 4000) * 0.18
mix[-ns(0.35):] *= np.linspace(1, 0, ns(0.35))[:, None]
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
LUFS, TP = -14.3, -1.0   # linear loudnorm lands ~0.3 LU above target → set −14.3 so ebur128 measures −14.0


def write_wav24(path, x):
    a = np.round(np.clip(x, -1, 1) * 8388607).astype("<i4")
    with wave.open(path, "wb") as w_:
        w_.setnchannels(2)
        w_.setsampwidth(3)
        w_.setframerate(SR)
        w_.writeframes(a.view(np.uint8).reshape(-1, 4)[:, :3].tobytes())


def os_peaks(x, k=4):
    p = np.zeros(len(x))
    for c in range(2):
        y = np.fft.irfft(np.fft.rfft(x[:, c]), k * len(x)) * k
        p = np.maximum(p, np.abs(y).reshape(-1, k).max(1))
    return p


def limiter(x, ceil_db, look=0.002, rel=0.08):
    g = np.minimum(1, db(ceil_db) / np.maximum(os_peaks(x), 1e-9))
    w = ns(look)
    gm = np.lib.stride_tricks.sliding_window_view(np.concatenate([np.ones(w), g, np.ones(w)]), 2 * w + 1).min(1)
    h = w // 2
    box = np.convolve(np.concatenate([np.ones(h), gm, np.ones(h)]), np.ones(2 * h + 1) / (2 * h + 1), "valid")
    B = 48
    nb_ = len(gm) // B
    blk = gm[:nb_ * B].reshape(nb_, B).min(1)
    kr = 1 - math.exp(-B / SR / rel)
    y, out = 1.0, np.empty(nb_)
    for i, v in enumerate(blk):
        y = min(v, y + (1 - y) * kr)
        out[i] = y
    rc = np.interp(np.arange(len(gm)), np.arange(nb_) * B, out)
    gg = np.minimum(box, rc)
    return x * gg[:, None], 20 * np.log10(gg.min())


def loudnorm_measure(path):
    r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", path, "-af",
                        f"loudnorm=I={LUFS}:TP={TP}:LRA=20:print_format=json", "-f", "null", "-"], capture_output=True, text=True)
    return json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1])


os.makedirs(os.path.dirname(OUT), exist_ok=True)
PRE = OUT[:-4] + "_premaster.wav"
write_wav24(PRE, mix * 0.5 / max(1e-6, np.abs(mix).max()))
m1 = loudnorm_measure(PRE)
x = mix * 0.5 / max(1e-6, np.abs(mix).max()) * db(LUFS - float(m1["input_i"]))
x, gr = limiter(x, TP - 0.6)
write_wav24(PRE, x)
m2 = loudnorm_measure(PRE)
subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", PRE, "-af",
                f"loudnorm=I={LUFS}:TP={TP}:LRA=20:measured_I={m2['input_i']}:measured_TP={m2['input_tp']}:"
                f"measured_LRA={m2['input_lra']}:measured_thresh={m2['input_thresh']}:offset={m2['target_offset']}:linear=true:"
                f"print_format=summary", "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s24le", OUT], check=True)
os.remove(PRE)
r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", OUT, "-af", "ebur128=peak=true", "-f", "null", "-"],
                   capture_output=True, text=True).stderr
summ = r[r.rindex("Summary:"):]
I_ = float(re.search(r"I:\s*(-?[\d.]+) LUFS", summ).group(1))
TP_ = float(re.search(r"Peak:\s*(-?[\d.]+) dBFS", summ).group(1))
json.dump({"drop": DROP, "bpm": BPM, "heart_end": HEART_END, "flicks_on": FLICKS_ON, "flicks_heart": FLICKS_HEART,
           "lufs": I_, "true_peak": TP_}, open(OUT[:-4] + ".json", "w"), indent=1)
print(f"MIX limiter GR {-gr:.1f} dB | AUDIO {os.path.relpath(OUT, ROOT)} {DUR:.1f}s | I {I_:.1f} LUFS, true peak {TP_:.1f} dBTP")
