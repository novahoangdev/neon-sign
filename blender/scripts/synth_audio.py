# Neon Sign audio, synthesized with numpy (no copyrighted assets), the goku-vs-frieza way.
#
#   app/assets/audio/   one-shot sounds played in the app (WAV 44.1 kHz mono 16-bit):
#       switch_on / switch_off   metal toggle switch: lever "click" + switch body + spring ring
#       hum                       2 s loop: 120 Hz transformer buzz + harmonics, high-frequency neon gas "sizzle" (seamless loop)
#       flick_0..3                ignition flicker: short electric crackle (4 variants)
#       glitch                    broken tube: power-loss "pop", intermittent buzz, re-ignition
#       flow                      colour change: neon gas flowing along the tube (rising glass-tube whoosh)
#       freeze                    stroke freezing into a tube: soft glass "ting" + clip snap
#   render/audio/mix.wav  48 kHz stereo mix following the demo script (starts at app t = 0, as promo.sh expects).
#       Passing --screen <CFR recording> --film-start <seconds at app t=0> detects the real flicker beats in the recording
#       (sign area brightness per frame) so the crackle matches the picture; otherwise estimated times are used.
#
# Run with Blender's Python (numpy included):
#   Blender -b --factory-startup -P blender/scripts/synth_audio.py -- [--screen render/promo/v2/screen.mp4 --film-start 2.5]
import json, os, subprocess, sys, wave
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
APP_OUT = os.path.join(ROOT, "app", "assets", "audio")
MIX_OUT = arg("--out", os.path.join(ROOT, "render", "audio", "mix.wav"))
os.makedirs(APP_OUT, exist_ok=True)
os.makedirs(os.path.dirname(MIX_OUT), exist_ok=True)
SR = 44100
rng = np.random.default_rng(17)


# ───────────────────────── basic DSP ─────────────────────────
def t_(dur, sr=SR):
    return np.arange(int(dur * sr)) / sr


def band(x, lo, hi, sr=SR):
    """FFT band-pass with soft edges."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / sr)
    m = np.ones_like(f)
    if lo:
        m /= 1 + (lo / np.maximum(f, 1)) ** 4
    if hi:
        m /= 1 + (f / hi) ** 4
    return np.fft.irfft(X * m, len(x))


def env(n, a, d, sr=SR, shape=5.0):
    t = np.arange(n) / sr
    return np.minimum(t / max(a, 1e-5), 1) * np.exp(-np.maximum(t - a, 0) * shape / max(d, 1e-5))


def modes(dur, parts, sr=SR):
    """Sum of decaying oscillators: (frequency, amplitude, decay time)."""
    t = t_(dur, sr)
    out = np.zeros_like(t)
    for f, a, d in parts:
        out += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / d)
    return out


def noise(n):
    return rng.standard_normal(n)


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1
    return x * (peak / m)


def soft(x, k=1.5):
    return np.tanh(x * k) / np.tanh(k)


def save(x, name, sr=SR, folder=APP_OUT):
    x = np.clip(x, -1, 1)
    path = os.path.join(folder, name)
    ch = 1 if x.ndim == 1 else x.shape[1]
    with wave.open(path, "wb") as w:
        w.setnchannels(ch)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    print("SAVE", os.path.relpath(path, ROOT), f"{len(x) / sr:.2f}s")


def place(buf, x, at, sr, gain=1.0, pan=0.0):
    i = int(at * sr)
    if i >= len(buf) or i + len(x) <= 0:
        return
    j0 = max(0, -i)
    x = x[j0:]
    i = max(0, i)
    n = min(len(x), len(buf) - i)
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + n, 0] += x[:n] * gain * l * 1.41
    buf[i:i + n, 1] += x[:n] * gain * r * 1.41


# ───────────────────────── individual sounds ─────────────────────────
def switch(on=True, sr=SR):
    """Toggle switch: lever passes dead centre (sharp click) → switch body + plate knock (metallic thud) → spring ring."""
    dur = 0.32
    n = int(dur * sr)
    out = np.zeros(n)
    # 1. click: very short high-band noise burst + a second "tick" when the contacts close (on) / open (off)
    for at, g, lo, hi in ((0.0, 1.0, 1800, 9000), (0.011 if on else 0.016, 0.55, 2500, 11000)):
        k = int(0.006 * sr)
        c = band(noise(k * 4), lo, hi, sr)[:k] * env(k, 0.0002, 0.0035, sr)
        i = int(at * sr)
        out[i:i + k] += c * g
    # 2. body: decaying oscillation of the metal housing + plate
    base = 1.0 if on else 0.86
    body = modes(dur, [(190 * base, 0.55, 0.035), (430 * base, 0.4, 0.028), (1120 * base, 0.35, 0.02),
                       (2870 * base, 0.2, 0.012)], sr)
    body *= env(n, 0.0008, 0.12, sr, 3)
    out += body
    # 3. spring + nut ring softly (metallic, slightly detuned)
    ring = modes(dur, [(3310 * base, 0.08, 0.09), (4790 * base, 0.06, 0.07), (6240, 0.04, 0.05)], sr)
    out += ring * env(n, 0.002, 0.25, sr, 2)
    # short slapback from the brick wall
    echo = np.zeros(n)
    d = int(0.019 * sr)
    echo[d:] = out[:-d] * 0.18
    out = band(out + band(echo, 200, 3000, sr), 70, 14000, sr)
    return norm(soft(out, 1.3), 0.95)


def hum(dur=2.0, sr=SR):
    """Seamless loop: 120 Hz transformer (magnetostriction) + odd/even harmonics, high-frequency neon gas sizzle, occasional crackles."""
    t = t_(dur, sr)
    n = len(t)
    f0 = 120.0                                      # dur × f0 is an integer → loops without phase drift
    harm = [(1, 1.0), (2, 0.55), (3, 0.42), (4, 0.2), (5, 0.16), (6, 0.08), (7, 0.07), (9, 0.04), (11, 0.025)]
    x = sum(a * np.sin(2 * np.pi * f0 * h * t + h * 0.7) for h, a in harm)
    x = soft(x * 0.6, 2.2)                          # saturated iron-core style distortion
    am = 1 + 0.06 * np.sin(2 * np.pi * 0.5 * t) + 0.03 * np.sin(2 * np.pi * 1.5 * t + 1)
    x *= am
    # sizzle: 2.2–4.8 kHz band noise amplitude-modulated at 120 Hz (plasma), very quiet — warm, not harsh (01/11)
    nz = band(noise(n), 2200, 4800, sr)
    nz /= np.std(nz) + 1e-9
    buzz = nz * (0.55 + 0.45 * np.abs(np.sin(2 * np.pi * 60 * t))) * 0.03
    # small crackles
    crk = np.zeros(n)
    for _ in range(5):
        i = rng.integers(0, n - 400)
        k = rng.integers(60, 300)
        crk[i:i + k] += band(noise(k * 4), 1500, 9000, sr)[:k] * env(k, 0.0001, k / sr * 0.6, sr) * rng.uniform(0.1, 0.25)
    y = band(x, 60, 1600, sr) * 0.5 + buzz + band(crk, 100, 6500, sr)
    # seamless loop: crossfade the tail into the head
    k = int(0.08 * sr)
    w = np.linspace(0, 1, k)
    full = np.concatenate([y, y[:k]])
    full[:k] = y[:k] * w + full[n:n + k] * (1 - w)
    return norm(full[:n], 0.7)


def flick(seed, sr=SR):
    """Ignition flicker: electric crackle — a few pulses + a short 120 Hz buzz."""
    r = np.random.default_rng(100 + seed)
    dur = 0.16
    n = int(dur * sr)
    t = t_(dur, sr)
    zap_len = r.uniform(0.04, 0.1)
    saw = 2 * ((t * 120 * r.choice([1, 2])) % 1) - 1
    zap = band(saw + 0.6 * band(noise(n), 2000, 7000, sr) / 3, 150, 6000, sr) * env(n, 0.001, zap_len, sr, 4)
    out = zap * 0.6
    for _ in range(r.integers(2, 5)):
        i = int(r.uniform(0, zap_len) * sr)
        k = int(r.uniform(0.0008, 0.003) * sr)
        out[i:i + k] += band(noise(k * 4), 2500, 12000, sr)[:k] * r.uniform(0.6, 1.0)
    return norm(out, 0.85)


def glitch(sr=SR):
    """Broken tube: power-loss 'pop' (low) → intermittent buzz → crackling re-ignition."""
    dur = 0.55
    n = int(dur * sr)
    t = t_(dur, sr)
    out = np.zeros(n)
    k = int(0.05 * sr)
    out[:k] += modes(0.05, [(85, 0.8, 0.02), (240, 0.4, 0.012)], sr) + band(noise(k), 400, 3000, sr) * env(k, 0.0005, 0.01, sr) * 0.4
    gate = (np.sin(2 * np.pi * 23 * t) > 0.2).astype(float) * (t > 0.08) * (t < 0.36)
    saw = 2 * ((t * 120) % 1) - 1
    out += band(saw, 120, 4000, sr) * gate * 0.35 * env(n, 0.05, 0.4, sr, 2)
    for at in (0.37, 0.42, 0.47):
        i = int(at * sr)
        out[i:i + int(0.07 * sr)] += flick(int(at * 100), sr)[:int(0.07 * sr)] * 0.6
    return norm(out, 0.85)


def flow(sr=SR):
    """Neon gas flowing along the tube ~0.6 s: rising band-sweep glass whoosh + light shimmer, sizzling tail."""
    dur = 0.9
    n = int(dur * sr)
    t = t_(dur, sr)
    nz = noise(n)
    out = np.zeros(n)
    # sweep: split into chunks, each band-passed at a rising frequency
    seg = 1024
    for i in range(0, n, seg // 2):
        p = min(1, i / (0.6 * sr))
        fc = 500 * (6 ** p)
        chunk = nz[i:i + seg]
        if len(chunk) < seg:
            break
        y = band(chunk, fc * 0.6, fc * 1.6, sr) * np.hanning(seg)
        out[i:i + seg] += y
    out *= env(n, 0.12, 0.5, sr, 3) * (1 + 0.3 * np.sin(2 * np.pi * 9 * t))
    shimmer = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((2093, 0.05), (3136, 0.04), (4186, 0.03))) * env(n, 0.3, 0.5, sr, 4)
    return norm(out + shimmer, 0.6)


def freeze(sr=SR):
    """Stroke freezes into a tube: soft glass 'ting' + a few clip snaps."""
    dur = 0.6
    n = int(dur * sr)
    out = modes(dur, [(2637, 0.3, 0.22), (3951, 0.2, 0.16), (5920, 0.12, 0.1), (7902, 0.06, 0.06)], sr) * env(n, 0.001, 0.5, sr, 3)
    out += band(noise(n), 4000, 12000, sr) * env(n, 0.001, 0.02, sr) * 0.15
    for at in (0.12, 0.2, 0.27):
        i = int(at * sr)
        k = int(0.004 * sr)
        out[i:i + k] += band(noise(k * 4), 3000, 10000, sr)[:k] * env(k, 0.0002, 0.002, sr) * 0.35
    return norm(out, 0.5)


# Run directly (Blender -P) to export the one-shots + the old mix; when imported from mix_v3.py only the sound generators are used.
if __name__ == "__main__":
    # ───────────────────────── export one-shots ─────────────────────────
    sounds = {
        "switch_on.wav": switch(True),
        "switch_off.wav": switch(False),
        "hum.wav": hum(),
        "glitch.wav": glitch(),
        "flow.wav": flow(),
        "freeze.wav": freeze(),
    }
    for i in range(4):
        sounds[f"flick_{i}.wav"] = flick(i)
    for k, v in sounds.items():
        save(v, k)

    # ───────────────────────── mix following the demo script ─────────────────────────
    # times (app seconds) matching src/demo/script.ts: hello 1.5 → ~4.6, heart 5.0 → ~6.0, switch 6.6, colour change 10.0 / 11.0, o breaks 13.25
    MSR = 48000
    DUR = float(arg("--dur", "16.5"))
    mix = np.zeros((int(DUR * MSR), 2))
    rs = lambda x: np.interp(np.arange(int(len(x) * MSR / SR)) / MSR, np.arange(len(x)) / SR, x)
    S = {k: rs(v) for k, v in sounds.items()}
    SWITCH_AT = 6.6
    events = {"freeze": [4.62, 6.02], "flow": [10.0, 11.0], "glitch": [13.25]}

    # light beats: detected in the recording if present, otherwise estimated
    rises, lum_t, lum = [], None, None
    screen, film0 = arg("--screen"), arg("--film-start")
    if screen and film0 is not None:
        film0 = float(film0)
        W, H = 22, 48
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", os.path.join(ROOT, screen) if not os.path.isabs(screen) else screen,
                              "-vf", f"scale={W}:{H},format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
        fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)
        lum = fr[:, int(H * 0.2):int(H * 0.72)].mean(axis=(1, 2))   # sign area (excluding the bottom UI bar)
        lum_t = np.arange(len(lum)) / 60.0 - film0
        d = np.diff(lum, prepend=lum[0])
        thr = max(1.5, np.percentile(np.abs(d), 99) * 0.35)
        last = -1
        for i in range(3, len(lum)):
            tt = lum_t[i]
            if tt < SWITCH_AT or tt > DUR:
                continue
            if any(-0.1 < tt - f < 0.75 for f in events["flow"]):   # colour change brightens, not a flicker
                continue
            if lum[i] - lum[i - 3:i].min() > thr and tt - last > 0.045:
                rises.append(tt)
                last = tt
        print("RISES", len(rises), [round(float(x), 3) for x in rises[:30]])
    else:
        # shared flash at 6.65 + 3–5 beats per cell within ~0.9 s, then fully lit at ~7.5
        rises = [SWITCH_AT + 0.05] + sorted(SWITCH_AT + 0.25 + rng.uniform(0, 0.75, 9))
        rises += [13.32, 13.45]                       # broken o re-ignites

    place(mix, S["switch_on.wav"], SWITCH_AT - 0.012, MSR, 0.9, 0.35)
    for i, at in enumerate(rises):
        place(mix, S[f"flick_{i % 4}.wav"], at, MSR, 0.42 if i else 0.7, rng.uniform(-0.3, 0.3))
    for at in events["freeze"]:
        place(mix, S["freeze.wav"], at, MSR, 0.35)
    for at in events["flow"]:
        place(mix, S["flow.wav"], at, MSR, 0.5, 0.0)
    for at in events["glitch"]:
        place(mix, S["glitch.wav"], at - 0.01, MSR, 0.5, -0.1)

    # transformer buzz: volume follows brightness (recording) or the estimated curve; muted under the recording before the switch
    h = S["hum.wav"]
    reps = int(np.ceil(len(mix) / len(h))) + 1
    hum_long = np.tile(h, reps)[:len(mix)]
    tm = np.arange(len(mix)) / MSR
    if lum is not None:
        base = np.median(lum[(lum_t > 0) & (lum_t < SWITCH_AT - 0.2)])
        top = np.percentile(lum[(lum_t > SWITCH_AT + 1.5) & (lum_t < DUR)], 60)
        lv = np.clip((lum - base) / max(1e-3, top - base), 0, 1.3)
        vol = np.interp(tm, lum_t, lv)
    else:
        vol = np.clip((tm - SWITCH_AT - 0.05) / 0.9, 0, 1) * (tm > SWITCH_AT + 0.05)
        vol *= 1 - 0.9 * ((tm > 13.25) & (tm < 13.32))
    vol = np.convolve(vol, np.ones(240) / 240, mode="same")      # avoid clicks from volume changes
    place(mix, hum_long * vol * 0.16, 0, MSR)

    # night-alley bed: light wind + small water drips into a puddle (very quiet) so it feels less empty
    amb = band(noise(len(mix)), 80, 900, MSR)
    amb = amb / (np.std(amb) + 1e-9) * 0.012 * (1 + 0.3 * np.sin(2 * np.pi * 0.13 * tm))
    place(mix, amb, 0, MSR, 1.0, 0.0)
    for at in np.cumsum(rng.uniform(0.9, 2.4, 20)):
        if at < DUR:
            k = int(0.08 * MSR)
            tt = np.arange(k) / MSR
            f = 1400 + rng.uniform(-300, 600)
            drip = np.sin(2 * np.pi * (f + 900 * tt / 0.08) * tt) * np.exp(-tt * 70) * 0.05
            place(mix, drip, at, MSR, 1.0, rng.uniform(-0.6, 0.6))

    # tail: fade out the last 0.6 s
    k = int(0.6 * MSR)
    mix[-k:] *= np.linspace(1, 0, k)[:, None]
    peak = np.max(np.abs(mix))
    mix *= 0.89 / max(peak, 1e-6)
    save(mix, os.path.basename(MIX_OUT), MSR, os.path.dirname(MIX_OUT))
    print("DONE")
