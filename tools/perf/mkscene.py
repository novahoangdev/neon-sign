#!/usr/bin/env python3
"""POLISH preview only: copy app/src/scene/NeonScene.tsx (main agent) → app/src/perf/variants/NeonScenePolish.tsx with
POLISH's proposed edits (notes/polish.md), so they can be seen on the sim without touching the shared file.
Picked up by tools/perf/metro.config.js when POLISH_SCENE=1. Re-run after every change to NeonScene.tsx."""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parents[2] / "app/src"
src = (root / "scene/NeonScene.tsx").read_text()
# imports: file moves from src/scene → src/perf/variants
src = re.sub(r'from "\.\./', 'from "../../', src)
src = re.sub(r'from "\./', 'from "../../scene/', src)
src = src.replace('require("../../assets', 'require("../../../assets')
# 1. live chalk trail → <LiveTrail>
m = re.search(r'\n(\s*)<Group opacity=\{liveOp\} blendMode="plus">.*?</Group>\n', src, re.S)
if m:  # (merged by the main agent 01/11 08:40 — kept for older copies)
    ind = m.group(1)
    src = src[:m.start()] + f'\n{ind}<LiveTrail path={{livePath}} end={{liveEnd}} width={{brushW}} tipX={{tipX}} tipY={{tipY}} opacity={{liveOp}} />\n' + src[m.end():]
    src = src.replace('import { TubeFreeze', 'import { LiveTrail } from "../../neon/LiveTrail";\nimport { TubeFreeze', 1)
# 2. wires catch neon light (diff C)
src = src.replace('<Wires tubes={tubes} time={time} image={parts!} shadow={shadowT} />', '<Wires tubes={tubes} time={time} image={parts!} shadow={shadowT} bright={bright} />')
# 2b. tube shadow fades while lit (diff E)
src = src.replace('<TubeShadow key={`s${t.id}`} tube={t} time={time} shadow={shadowT} />', '<TubeShadow key={`s${t.id}`} tube={t} time={time} shadow={shadowT} bright={bright} />')
# 2c. lit glass glint follows tilt (diff F)
src = src.replace('<UnitLit key={`l${t.id}-${i}`} tube={t} unit={u} time={time} bright={bright} />', '<UnitLit key={`l${t.id}-${i}`} tube={t} unit={u} time={time} bright={bright} hl={hlT} />')
# 2d. phosphor afterglow on switch-off (diff G)
src = src.replace("v = Math.max(0, 1 - (t - offAt.value) / 0.07) * (offAt.value > powerAt.value ? 1 : 0);",
                  "const fo = F[s.tube];\n        v = extinguish(t - offAt.value, GAS[fo ? fo.to : 0]) * (offAt.value > powerAt.value ? 1 : 0);")
src = src.replace("import { brokenGlitch, ignite,", "import { brokenGlitch, extinguish, ignite,", 1)
# 2e. broken tube flicker keeps phosphor afterglow (diff H)
src = src.replace("if (s.k === badK) v *= brokenGlitch(t - start, powerN.value * 5.1);",
                  "if (s.k === badK) v *= brokenGlitch(t - start, powerN.value * 5.1, GAS[fl ? fl.to : 0]);")
# 3. rain drops on the tubes (diff D)
m = re.search(r'(\n(\s*)<Electrodes tubes=\{tubes\})', src)
if m and "TubeDrops" not in src:
    ind = m.group(2)
    src = src[:m.start()] + f"\n{ind}{{tubes.map((t) => (\n{ind}  <TubeDrops key={{`d${{t.id}}`}} tube={{t}} time={{time}} bright={{bright}} />\n{ind}))}}" + src[m.start():]
    src = src.replace('import { TubeFreeze', 'import { TubeDrops } from "../../neon/Drops";\nimport { TubeFreeze', 1)
# 4. DEBUG_TUBES=1: post tube/slot info + per-slot brightness to the perf sink (:8103) — diagnosis only
import os
if os.environ.get("DEBUG_TUBES") in ("1", "2"):
    dbg = (
        '\n  useEffect(() => { fetch("http://localhost:8103", { method: "POST", body: "TUBES " + JSON.stringify(tubes.map((t) => ({ id: t.id, len: Math.round(t.len), flowAt: t.flowAt, prev: t.prev, color: t.color, born: t.born, units: t.units.map((u) => [u.k, Math.round(u.a), Math.round(u.b)]) }))) }).catch(() => {}); }, [tubes]);'
        '\n  useEffect(() => { const id = setInterval(() => { fetch("http://localhost:8103", { method: "POST", body: "BRIGHT t=" + time.get().toFixed(2) + " " + bright.get().map((v) => v.toFixed(2)).join(",") }).catch(() => {}); }, 700); return () => clearInterval(id); }, []);'
    )
    if os.environ.get("DEBUG_TUBES") == "2":  # tubes only (no JS reads of shared values)
        dbg = dbg.split("\n  useEffect(() => { const id")[0]
    anchor = re.search(r"\n  const bright = useSharedValue[^\n]*\n", src)
    src = src[:anchor.end()] + dbg + "\n" + src[anchor.end():]
# 5. DROP=TubeGlass,TubeDrops,…: remove those per-tube elements (diagnosis only)
for comp in filter(None, os.environ.get("DROP", "").split(",")):
    src = re.sub(r"\{tubes\.map\(\(t\) => \(\s*<" + comp + r" [^>]*/>\s*\)\)\}", "{null}", src)
    src = re.sub(r"<" + comp + r" [^>]*/>", "{null}", src)
# 6. AUTODRAW=1 (with DEMO=0): scripted "hand" strokes through the real interactive callbacks (QA without touch input)
if os.environ.get("AUTODRAW") == "1":
    m = re.search(r"\n  const selectAt = useCallback\(.*?\n  \}, \[\]\);\n", src, re.S)
    auto = """
  useEffect(() => {
    if (DEMO) return;
    // wobbly hand-drawn strokes in design pt (pre-thin/relax/Catmull like the pan gesture)
    const wob = (x0: number, y0: number, x1: number, y1: number, amp: number, n = 40, ph = 0) => {
      const p: number[] = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        p.push(x0 + (x1 - x0) * u + Math.sin(u * 9 + ph) * amp * 0.3, y0 + (y1 - y0) * u + Math.sin(u * 7.3 + ph) * amp);
      }
      return p;
    };
    const loop = (cx: number, cy: number, r: number, n = 50) => {
      const p: number[] = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2.2;
        p.push(cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r);
      }
      return p;
    };
    const T = (s: number, f: () => void) => setTimeout(f, ms(s * 1000));
    const ids = [
      T(0.6, () => commit(wob(60, 260, 380, 300, 22), { startedAt: time.get() - 0.8 })),
      T(1.2, () => commit(loop(150, 420, 50), { startedAt: time.get() - 0.6 })), // < 1.2 s, same colour → blockout link
      T(2.4, () => toggle()),
      T(4.4, () => commit(wob(250, 520, 400, 610, 14, 30, 1.3), { color: 3, startedAt: time.get() - 0.5 })), // lit → born delay ignition
      T(6.2, () => selectAt(150, 470)),
      T(6.5, () => onColor(1)),
      T(8.4, () => commit(wob(40, 650, 120, 560, 6, 6), { startedAt: time.get() - 0.2 })), // short stroke
      T(9.4, () => undo()),
      T(10.4, () => toggle()),
      T(11.4, () => toggle()),
    ];
    return () => ids.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
"""
    src = src[:m.end()] + auto + src[m.end():]
out = root / "perf/variants/NeonScenePolish.tsx"
out.write_text("// GENERATED by tools/perf/mkscene.py — do not edit\n" + src)
print(out)
