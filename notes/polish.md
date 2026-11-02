# POLISH agent (secondary) — 01/11/2026

## Files owned by the POLISH agent (the main agent doesn't edit them; to change them, write a diff into notes/<name>.md and send a message)

- `app/src/neon/` (Tube.tsx, Decor.tsx, atlas.ts, flicker.ts, model.ts, palette.ts, new files in this folder)
- `app/src/shaders/` (wall.ts, post.ts, new shader files)
- `app/src/perf/`, `tools/perf/`
- `notes/polish.md`, `notes/polish/` (before/after images)

Do not touch: `app/src/scene/`, `app/src/demo/`, `App.tsx`, `app/src/ui/`, `app/src/fx/`, `blender/`, `tools/*.sh`, PLAN.md
(except POLISH's status line), README.md, native build. Anything that needs changing in NeonScene.tsx (e.g. the chalk trail): POLISH
writes a component in `app/src/neon/` + a suggested diff in `notes/polish.md`, and the main agent merges it.

Sim: "Polish 17 Pro Max" `892D265C…` (self-created). The Debug build in DerivedData is broken, so new JS runs on a copy of the Release build (`tools/perf/embed.sh`, log sink :8103). No native builds, no recording.

## Summary (updated 01/11 10:35)

**Status:** items (1)–(5) done, the main agent merged diffs A–G; v8 (09:37), v9 (10:00), v10 (10:05, 60/60 frames per second)
correct. The last batch (wall.ts only) was reported "ok to record the final cut" at 10:33.
Final cut v11 recorded at 10:36 includes that batch (60/60 frames from second 2). After v11, app-only: slightly brighter broken-up
reflections, raindrops hitting the tubes (reported to the main side, no re-record needed).

| Item | Result | Images |
|---|---|---|
| (1) FPS | Release + new JS, idle machine: 57.9–58/60 fps in both the demo and steady lit state (60 Hz sim); v8 recording 60/60 frames per second. GPU ≈3.5–4 ms/frame on Mac. No more per-frame allocations in `neon/` (outside the 0.2 s pop window). No more Graphite "non-invertible" log spam. | — |
| (2) Real neon | Saturated gas fills the tube, 5 steps to a hot white core; 2-tier glow + hot glow hugging the tube; neon gas (red) vs argon (the rest): ignition, warm-up, afterglow on switch-off; unlit glass: milky phosphor vs clear glass; shadows with volume + focused caustic slit; rain beading/dripping, raindrops hitting the tubes; cables pick up colour; glass highlight follows gyro | `a8_14`, `b4_8.8`, `b5_14`, `off_34.8`, `drops_14` |
| (3) Wall | 3-gaussian lighting (harsh near the tube, upper wall dark), mortar darkened by AO, wet grazing-light sheen, water running down the wall, wet wall base + contact shadow | `a8_14`, `base1_30` |
| (4) Puddle | Correct reflection of the wall + sharp tubes, concentric rain ripples, puddle edge (meniscus), rain splashes; rough asphalt: reflection broken up by the gravel; fake glow removed | `a7_14`, `b2_14`, `c5_14`, `mf2_22` |
| (5) Chalk trail | `LiveTrail`: 7 soft strokes + chalk-grain shader | `trail_2.2`, `trail_3.4` |
| Bugs fixed | hello stays pink after recolour (remount instead of prop update); washed-out "o" (additive gamma haze); solid black shadow/glass (bake overwrote alpha); black glass when off (BlurMask inner) | `fix_14` |

**Tools** (`tools/perf/`): `embed.sh` (swaps the JS bundle into the Release build, no native build), `polish_shot.sh` (screenshots by
second counted from the first frame with content), `sksl_check.mjs` (offline SkSL compile), `mkscene.py` (NeonScene + POLISH proposals for
preview; `DEBUG_TUBES`, `DROP` for diagnostics), `start.sh`/`measure.sh`/`report.py` (FPS overlay), Bench (`BENCH=1`).

**Hand-drawing mode (DEMO=0):** axe can't send touches to a headless sim, so it's checked with `AUTODRAW=1 DEMO=0 POLISH_SCENE=1
tools/perf/polish_shot.sh …` (`mkscene.py` calls NeonScene's commit/toggle/selectAt/onColor/undo directly on a schedule): wavy
stroke + circle (through thin/relax/Catmull, blockout join), power on, draw more while lit (separate ignition), recolour, short
stroke + undo, off/on — no crash, beads/drips/glass/shadow/cables/electrodes correct with free strokes. Image `int_13.5.jpg`.

## Log

### 01/11 08:00–08:30 — milestone 1: FPS measurement, more realistic neon, wall, puddle, chalk trail

**Tools (no native build):** the Debug build in DerivedData is broken (missing `NeonSign.debug.dylib`), so POLISH runs new JS
on the main agent's Release build by swapping `main.jsbundle`:
- `tools/perf/embed.sh`: snapshots the Release build into its own copy (`BASE=1` to refresh), exports the bundle (perf config → FPS
  overlay, `PLAIN=1` = app exactly as shipped, `BENCH=1` = GPU benchmark, `POLISH_SCENE=1` = NeonScene with POLISH proposals), hermesc,
  ad-hoc signing, installs on the Polish sim. The perf bundle uses `MINIFY=false` (the minified overlay crashes in a worklet; the real app doesn't).
- `tools/perf/polish_shot.sh <label> <seconds…>`: screenshots by second from the first frame with content → `notes/polish/<label>_<s>.jpg`.
- `tools/perf/sksl_check.mjs`: compiles every SkSL in `app/src/shaders` with CanvasKit (node), catching shader errors before building.
- `tools/perf/mkscene.py`: generates `app/src/perf/variants/NeonScenePolish.tsx` = NeonScene + POLISH proposals (preview only).

**(1) FPS.** Release + production JS, 60 Hz sim, low load: demo 57.9 fps, steady lit 57.9 fps (1 dropped frame / 15 s).
An earlier 42 fps run coincided with the main agent recording (SIGSTOP), discarded. Audio causes no hitches (A/B with/without expo-audio).
GPU per layer (Bench, idle machine, 1320×2868): wall 1.1 ms · steam 0.95 · grade 0.37 · baked glow 0.33 · whole frame ≈3.5 ms.
Fix: the clip/electrode/cable-head Atlas used RSXform scale 0 while hidden → Graphite logged "non-invertible transform" to stderr
for every sprite every frame (95 lines/30 s at the start of the demo) → now placed off-screen with scale 1e-3; per-frame RSXform only
during the "pop", then a prebuilt array is returned; `UnitLit` no longer does `new Float32Array` every frame (crossfade of two constant-colour images).
New shaders (items 3–4) cost ~0.2 ms more (Bench under load: 3.3 → 4.1 ms, min 2.07 → 2.17).

**(2) More realistic neon** — `src/neon/Tube.tsx`, `flicker.ts`, `palette.ts`
- Pre-baked 2-tier glow: near σ5 at the true colour + far σ20 more saturated (`deep()`), old→new colour crossfade as the gas flows.
- Gas inside the tube is drawn **over** the glass (srcOver), not added: previously additive stacking blew already-saturated channels out
  to white across the whole tube (cyan became a white plastic tube). Now: saturated body, middle layer 30 % white, core 0.16w near-white, glass wall visible.
- Thin glass highlight at the top left when lit.
- Neon / argon gas (`GAS` in palette: red = neon, the rest = argon + mercury + phosphor): `ignite(u, seed, gas)` —
  neon ignites hard, short, with clear overshoot; argon ignites weaker, with one extra beat, longer to settle, fully on at 65 % then warms up to 100 %
  over ~3 s. **Needs the main agent to pass gas** (diff A below); until then the old behaviour is kept.

**(3) Brick wall** — `src/shaders/wall.ts`, `src/neon/atlas.ts`
- Atlas A = 3 gaussians (σ7/18/60, σ60 tail reduced 0.42 → 0.24) ≈ a line light 2 cm off the wall: harsh near the tube, falls off
  fast, the upper wall stays dark (feedback on the 08:20 image: "upper wall flat pink").
- Mortar (low AO, data.g) receives 22 % of the neon light and has a 28 % darker base → deep black mortar joints.
- Rain-wet: specular with grazing light (L.z 0.2) on low-roughness spots (damp streaks data.r) → glinting brick edges; a few water rivulets
  down the wall (drop head + short wet streak, only visible under neon light). No falling rain (the main agent has `scene/rain.ts`).

**(4) Puddle** — `wall.ts`, atlas B
- Removed the fake glow: atlas B keeps only sharp tubes σ1.4 + small glow σ5 (0.16); the puddle reflects the actual wall surface (base + bricks
  catching light with normals, × 0.65) instead of "neon light × albedo" (previously a red rectangular blob).
- Rain ripples: 6 drops, concentric circular waves spreading out (sine over radius, perspective squash 3.2), distorting the reflection + catching light.
- Rough wet concrete outside the puddle: tube reflection smeared into vertical streaks with 3 per-pixel jittered samples (no more stacked ghosts).

**(5) Chalk trail** — `src/neon/LiveTrail.tsx`, `src/shaders/chalk.ts` (diff B, merged by the main agent)
- 7 stacked strokes of increasing width and low alpha (≈ gaussian profile, no BlurMask), filled with a chalk-grain shader fixed to the wall,
  brighter trail head, soft pen-tip dot. Colour follows the selected colour (`NEON_RGB`).

Images: `notes/polish/before_*.jpg` (before) · `a4_5.jpg`, `a4_14.jpg` (after) · `trail_2.2.jpg`, `trail_3.4.jpg` (chalk trail,
TIMESCALE 0.25).

#### Diff A — `app/src/scene/NeonScene.tsx`: gas type for the ignition pulse

```diff
-import { NEON_LIN } from "../neon/palette";
+import { GAS, NEON_LIN } from "../neon/palette";
@@ frame callback, loop over units
-        v = ignite(t - start, s.k * 7.13 + powerN.value * 3.7 + s.born) * steady(t, s.k);
+        const fl = F[s.tube];
+        v = ignite(t - start, s.k * 7.13 + powerN.value * 3.7 + s.born, GAS[fl ? fl.to : 0]) * steady(t, s.k);
```

#### Diff B — `app/src/scene/NeonScene.tsx`: soft chalk trail

```diff
+import { LiveTrail } from "../neon/LiveTrail";
+import { NEON_RGB } from "../neon/palette";   // merge into the palette import line
@@ inside <Group transform={tubeT}>, after the TubeFreeze elements
-                <Group opacity={liveOp} blendMode="plus">
-                  {/* chalk trail: … */}
-                  <Path path={livePath} … liveW14 … />
-                  <Path path={livePath} … liveW7 … />
-                  <Path path={livePath} … strokeWidth={1.6} … />
-                  <Circle cx={tipX} cy={tipY} r={7} …><BlurMask blur={6} style="normal" /></Circle>
-                </Group>
+                <LiveTrail path={livePath} end={liveEnd} width={brushW} tipX={tipX} tipY={tipY} opacity={liveOp} tint={NEON_RGB[color]} />
```
(`liveW14`, `liveW7` become unused after merging.)

### 01/11 08:30–08:40 — milestone 2: unlit tubes, puddle, vibrancy

- **Unlit tubes** (`TubeGlass`, by `GAS`): phosphor-coated argon tubes → frosted milky glass (cool grey α 0.62), red neon tubes
  → clear glass (α 0.07); thin dark tube wall (inner blur 0.13w), gyro highlight + faint secondary highlight on the opposite side. Before: tubes looked like
  black rubber hoses with grey outlines. Recolouring a tube re-bakes the glass (once). Images: `a2_8.jpg` (before) · `off_9.1.jpg` (after).
- **Puddle:** darker wall reflection (water at night reflects little: surf × 0.45 + base × 0.35), sharper tube reflection in the puddle
  (jitter 0.6 + 2.5·depth pt), stronger ripples catching cool light + tube colour → concentric rings clearly visible; rough concrete:
  darker tube streaks + faint base from atlas A (no more fibrous look). Images: `a6_14.jpg`, `a7_14.jpg`.
- **Vibrancy:** after the realism pass the wall light felt a bit "tame" → atlas A near tier 0.55 → 0.7, middle tier 0.45 → 0.56 (far tail kept
  at 0.24 so the upper wall stays dark); near tube glow 0.6 → 0.72, far 0.5 → 0.6. Images: `a7_14.jpg` (before) · `a8_14.jpg` (after).

#### Diff C — `app/src/scene/NeonScene.tsx`: cables pick up the neon colour (optional, small detail)

```diff
-                <Wires tubes={tubes} time={time} image={parts!} shadow={shadowT} />
+                <Wires tubes={tubes} time={time} image={parts!} shadow={shadowT} bright={bright} />
```
The rubber cable jacket gets a highlight in the colour of the tube it connects to (strongest over the first 60 % of the cable near the electrode),
lit/flickering with the tube. Without passing `bright` it behaves as before. Image: `wire_14.jpg`.

### 01/11 08:40–08:50 — milestone 3: gas cross-section, steam, cables, performance

- **Lit tubes:** gas inside the tube in 5 steps (0.9 → 0.15w, white mix 0 → 0.85) instead of 3 → no more banding, the saturated edge blends smoothly
  into the hot core (`GAS_LAYERS`, Tube.tsx). Glass highlight when lit reduced to α 0.16.
- **Steam** (`post.ts` steam): two tiers of wisps (near fbm5, far fbm3, shared domain warp) taking a narrow band of the noise → thin curling
  wisps rising from the wet ground; scattering mostly from the neon light (L × 2.2), so it's nearly invisible far from the tubes and tinted near them — no more
  "flat smoke slab" at the wall base. Images `a8_5.jpg` (before) · `a11_5.jpg` (after).
- **Cables:** colour highlight only on the 35 % nearest the electrode, fainter (before: the whole cable had a cyan outline). Needs diff C to enable.
- **Ignition pulse** (diff A merged) checked with slow-motion shots at TIMESCALE 0.25: shared flash → red heart (neon) snaps on cleanly, cyan letters (argon)
  flicker weakly then warm up. Images `ign_*.jpg`.
- **Performance:** in-app FPS at 08:42 meaningless (Blender GPU render ~240 % CPU: 8 fps even on the old build). Interleaved Bench (median
  under load / min): new wall 5.7 / 1.81 ms vs old 4.0 / 1.76; new steam 2.7 / 1.48 vs old 2.1 / 1.57 (optimised: steam shares
  the warp, water rivulets only computed where there's neon, removed the second data.png read). On an idle machine the whole frame ≈3.5–4 ms GPU on Mac.

### 01/11 08:52 — rain on the tubes (`src/neon/Drops.tsx`, needs diff D)

A rain scene with dry tubes looks fake. `TubeDrops`: water beads on the underside of horizontal/slanted tube segments (soft dot + glint, baked into
one image per tube), catching the street light when off, adding the tube's neon colour when lit; 1–2 drops fall from the lowest point of a curved
stroke (hang and grow for 1.2 s then fall at g ≈ 2300 pt/s², period 3.5–7.5 s). Water beads up gradually after the tube freezes (1.5 s). No per-frame
allocation. Images `drops_14.jpg` (lit) · `drops_9.2.jpg`.

#### Diff D — `app/src/scene/NeonScene.tsx`

```diff
+import { TubeDrops } from "../neon/Drops";
@@ right before <Electrodes tubes={tubes} … />
+                {tubes.map((t) => (
+                  <TubeDrops key={`d${t.id}`} tube={t} time={time} bright={bright} />
+                ))}
                 <Electrodes tubes={tubes} time={time} image={parts!} />
```

### 01/11 08:55–09:17 — fixing colour bugs after recolour (recording v5: hello stays pink; "o" washed out)

Two overlapping bugs, tracked down with check images (false green/red colours, UI-thread logs via the sink, pixel measurements):

1. **Hello stays pink after switching to cyan (main agent's v5).** The old `UnitLit` changed static props (tN/tO colours, conditionally inserted
   children) when React re-rendered on recolour; RN Skia 3.8 sometimes doesn't apply that update (the mounted node keeps the old colour;
   the bug depends on commit timing so my machine didn't reproduce it, the main agent's recording did). Fix: stop updating props and
   REMOUNT instead — `UnitLit` (shell, holds the baked image + op) → `UnitLitSteady` (static colour, no trim) when stable, `UnitLitFlow`
   (trim + crossfade) during the 0.6 s gas flow (`ms()` timer following TIMESCALE), then remount Steady with the new colour. Same approach (key
   by colour) for the `TubeGlass` glass, clip straps, cables, water drops.
2. **"o" + tail paler/more washed out than the other letters** (present since before v4). Not UnitLit (checked: the segment is drawn in the right colour).
   Culprit: steam's `L·haze` atmospheric glow (`post.ts`) gamma-encoded `pow(L·haze, 1/2.2)` and then ADDED onto the already-gamma image →
   small linear light gets amplified, overlaid on the neon tube itself; the "o" sits next to the red heart so it gets extra red added → washed out. Pixel
   measurement at the tube centre: R 127 ("o") vs 81 ("h"); haze off → 94 vs 101. Fix: haze (and steam wisps) fade to 0 where nearby light is very
   strong (right on the tube), kept on the dark background. After the fix: "o" R 77, the whole sign more saturated. Image `fix_14.jpg`.

### 01/11 09:20–09:40 — 120 Hz, bottom reflection, tube shadows, unlit glass

- **No per-frame allocation** (went through every `useDerivedValue` in `neon/`): `Drops` drops `for…of` (iterator) in the worklet; clips,
  cable heads, electrodes: before the pop return a prebuilt hidden array, after the pop return a prebuilt array, residual angles precomputed (`usePopXf`) — RSXform is only
  created in the ~0.2 s pop window. Suggestion for the main agent: `TubeClipsFront` in NeonScene has `for (const u of tube.units)`
  in a worklet → change it to an index loop.
- **"hello" reflection at the bottom** (wet concrete): shorter vertical streaks (22 → 12 pt), removed the faint atlas A base → letters readable, no more smearing.
- **Alpha bug when baking images** (present since the PERF bake): the `stroke()` helper called `setAlphaf(1)` after `setColor("rgba(…, a)")`
  → wiped alpha → SOLID BLACK tube shadows, unlit glass became black tubes. Now alpha is multiplied. Follow-ups:
  - **Tube shadows with volume:** core shadow (α 0.62, σ1.5) + offset penumbra (α 0.36, σ4.2) + focused caustic slit in the middle of the shadow (a round tube
    gathers light like a lens).
  - **Unlit glass:** dark rim only at the edges (dark stroke then hollowed out with dstOut in its own layer — `BlurMask inner` on a
    narrow stroke darkens the whole tube interior). Hello (phosphor) = frosted milky glass; heart (red neon) = clear glass, wall visible through it.
  Images: `b2_8.8.jpg` (before) · `b4_8.8.jpg` (after, lights off) · `b4_14.jpg`.
- **Hot white glow hugging the tube** (baked white image σ2, α 0.14, additive): tubes "burn bright" like in a photo while staying saturated.

#### Diff E — `app/src/scene/NeonScene.tsx`: tube shadows fade when the tube is lit (optional)

```diff
-                  <TubeShadow key={`s${t.id}`} tube={t} time={time} shadow={shadowT} />
+                  <TubeShadow key={`s${t.id}`} tube={t} time={time} shadow={shadowT} bright={bright} />
```
The shadow comes from the street light; when lit, the tube's own light fills the shadow (strength × (1 − 0.7·brightness)). Without passing it, behaves as before.

#### Diff F — `app/src/scene/NeonScene.tsx`: glass highlight slides with device tilt even when the tube is lit (storyboard 12–14 s)

```diff
-{tubes.map((t) => t.units.map((u, i) => <UnitLit key={`l${t.id}-${i}`} tube={t} unit={u} time={time} bright={bright} />))}
+{tubes.map((t) => t.units.map((u, i) => <UnitLit key={`l${t.id}-${i}`} tube={t} unit={u} time={time} bright={bright} hl={hlT} />))}
```
Before: when lit, the opaque gas layer covered TubeGlass's gyro highlight → tilting the device showed nothing on the tubes. Without passing `hl`, the highlight stays put.

**Clean FPS 09:31** (Release + new JS, idle machine, 60 Hz sim): demo 0–16 s 57.9 fps (1 dropped frame), steady lit 13–18 s
58 fps; dropped to ~31 fps exactly when the Blender worker re-ran the promo render (09:31:25) → caused by the machine, not the code.

#### Diff G — `app/src/scene/NeonScene.tsx`: phosphor afterglow on power-off (`extinguish` in flicker.ts)

```diff
-import { brokenGlitch, ignite, pickBroken, steady } from "../neon/flicker";
+import { brokenGlitch, extinguish, ignite, pickBroken, steady } from "../neon/flicker";
@@ frame callback, power-off branch
-        v = Math.max(0, 1 - (t - offAt.value) / 0.07) * (offAt.value > powerAt.value ? 1 : 0);
+        const fo = F[s.tube];
+        v = extinguish(t - offAt.value, GAS[fo ? fo.to : 0]) * (offAt.value > powerAt.value ? 1 : 0);
```
Red neon goes out in 50 ms; phosphor-coated argon tubes drop to 25 % in 40 ms then fade out with τ 0.12 s (fully gone ~0.6 s) — the letters
fade, the heart snaps off, just like a real sign. Slow-motion shots at TIMESCALE 0.25: `off_34.2…35.2.jpg`. The "click" sound still lands right on the flip.

### 01/11 09:45–10:00 — batch for v9 (POLISH files only, no diff needed)

- **Rain splashes on the wet ground** (`wall.ts` `splash`): each grid cell (16×5 pt, perspective-squashed) gets one drop hitting the ground every 0.8–2.2 s:
  a glint dot + small ring spreading over 0.16 s, borrowing the street light + reflected neon light at that spot. Fits with the main agent's
  falling rain layer. Image `c5_14.jpg`.
- **Reflection on rough concrete:** ripples only apply to the water surface (by specularity), concrete doesn't ripple → the "hello" reflection at the bottom
  is no longer fibrously distorted; vertical streaks 12 → 5 pt. Image `c3_14.jpg`.
- **Puddle edge** (after the v9 message, 09:55): thin bright rim in the reflectivity transition band (water meniscus), mostly lit up
  near reflected neon light — the first version was too obvious, like a cartoon outline, so the cool light was reduced to near 0. Image `c5_14.jpg`.

### 01/11 10:05 — fewer texture reads in the puddle / wet ground (`wall.ts`, for v10)

Texture samples per pixel before the fix: wall ≈ 16 (4 images + 3× `lightAt` × ≤ 4 tiles); puddle ≈ 53 because the reflected wall image
re-called the whole `surf(q)` (light-direction gradient = 3× atlas A + wet sheen), the puddle edge called `lightAt(q)` for **every** ground
pixel (including rough concrete, where the rim = 0), and splashes called it once more.
After: `lightAt(q)` is read once (`Lq`), shared by the reflected wall image, puddle edge and splashes; the reflected wall image only
takes diffuse (albedo · light · AO · mortar), dropping the gradient + wet sheen since the image is distorted/blurred under water anyway. Rough concrete no longer
reads atlas A (except pixels with an active splash). Puddle: −12 samples/pixel; wet concrete: −4 samples/pixel. Images identical (differing only in
rain/ripple timing): `opt0_13.5.jpg` (before) / `opt1_13.5.jpg` (after). `sksl_check` OK.

### 01/11 10:12 — reflection on wet asphalt broken up by the gravel (`wall.ts`, for the final cut)

Before: the "hello" reflection on rough concrete/asphalt was a smooth, uniform blue band lying over the gravel, looking like a paint streak. Reality: the water film
is only mirror-flat on the stone tops, the pits between stones scatter → the reflection breaks up following the gravel. Now the reflected tube image is multiplied by
`0.35 + albedoLin·24` (mean ≈ 1, measured from albedo.jpg: mean linear ground luminance 0.027) only on the rough part (the puddle stays
a mirror). No extra texture reads (albedo is already read in `surf`). Images: `opt1_13.5.jpg` (before) / `mf2_22.jpg` (after).

**Trap found:** first tried with the normal map (micro tilt x/z ±0.06) and the reflection disappeared entirely. A debug image showed
`brk` ≈ 0: Skia converts the colour gamut sRGB → P3 for child images in a runtime effect, (0.5, 1, 0.5) becomes ≈ (0.62, 0.99, 0.55) → n.x off by
+0.24. Wall normals (0.5, 0.5, 1) aren't skewed in x/y so wall lighting is still correct, but don't rely on absolute normal values on
the ground.

### 01/11 10:20 — wet wall base + wall–ground contact shadow (`wall.ts`, for the final cut)

Rain splashing back up from the ground soaks the bottom ~45 pt of the wall: albedo darkened ×0.62 at the ground, roughness ×0.45 (glossier
under neon light), street light ×0.72. The ground right at the wall base gets a thin contact shadow (×0.5, fading over ~4 pt): the corner junction
is no longer a sharp ruled line. A few ops, no extra texture reads. Image `base1_30.jpg`.

**GPU (interleaved Bench 6×6, 10:28, the whole 10:05–10:20 batch vs wall.ts v9):** wall lit mean 2.09 ms / min 1.51 ms vs v9
2.04 / 1.66 ms → no slower (min ~9 % faster) despite adding the gravel breakup + wet wall base.

### 01/11 10:50 — after final cut v11 (app only, no re-record needed)

- v11 (10:36) has the last wall.ts batch: checked 60/60 frames from second 2 (seconds 0–1 are the app launch screen, static frames — not stutter).
- The gravel-broken reflection on asphalt in v11 is slightly darker than v10: linear mean stays ≈ 1 but sparse bright points
  look darker through gamma → `brk = min(0.45 + albL·28, 2.8)` (mean ≈ 1.2). Letters as readable as v10 while still broken up. Image `mf3_22.jpg`.
- **Raindrops hitting lit tubes** (`Drops.tsx` `RainHit`, 10:55): each tube has 2 slots, each slot every 0.45–1.05 s picks
  (hash) a point on the top surface of the tube → a small water splash 0.5 → 1.5 pt shooting up ~3 pt, adding the tube colour mixed with white, gone in 0.11 s;
  only visible when the tube is lit + already wet. 4 mappers per slot, no per-frame allocation; Release minified runs fine (AUTODRAW, no
  crash). Position checked with a debug build HIT = 10 s (splash always visible) — sits right on the top of the tube.
- **Note for screenshots:** since v10, the demo holds at t = 0 until there are 45 consecutive smooth frames (< 25 ms) — while Blender renders, load
  ~36 so the scene stays frozen forever (not a bug). Take screenshots when the machine is idle, or use `DEMO=0` + `AUTODRAW=1 POLISH_SCENE=1`.

#### Diff H — `app/src/scene/NeonScene.tsx`: broken tube (normal mode) keeps the phosphor afterglow (`brokenGlitch` takes a gas parameter)

```diff
-        if (s.k === badK) v *= brokenGlitch(t - start, powerN.value * 5.1);
+        if (s.k === badK) v *= brokenGlitch(t - start, powerN.value * 5.1, GAS[fl ? fl.to : 0]);
```
Phosphor-coated argon tubes losing discharge drop to ~25 % in 40 ms then fade (0.87 → 0.51 → 0.23 → …), a long dropout
still goes down to 0.03 — clearly flickering but soft like a real tube; red neon still snaps to black. The default parameter −1 = old behaviour, so
not merging is fine too. No effect on the demo clip (random broken tubes only run in normal mode / after the script; the broken "o"
at 6.9 in the demo is the script's `broken`). The `dip` function is hoisted to module level (no closure created per frame). Ran 40 s on
Release minified via `AUTODRAW=1 POLISH_SCENE=1 DEMO=0` (mkscene item 2e): no crash.

### 01/11 11:15 — v12 (the final recording, 11:12)

Includes the brighter gravel-broken reflection + raindrops hitting the tubes. 60/60 frames from second 2 (seconds 0–1 are the app launch screen). The "hello"
reflection on asphalt reads more clearly than v11 while still breaking up with the gravel; the water splashes on the tubes are subtle — only glimpsed at the tops of the letter
loops, as intended (light rain). No more recording after v12: further changes go into the app only.
- **Drips from the tubes hitting the ground** (`Drops.tsx` `DripDot`, 11:16, app only): when a drop falls to the wall base it splashes a flat
  water ring (scaleY 0.3 for perspective), radius 1 → 6 pt over 0.14 s, adding the tube colour when lit. Impact time precomputed
  (`GROW_DROP + √(2h/g)`), 2 extra mappers per drop, static transform. Position checked with debug LAND = 10 s: the ring sits right on the ground
  at the wall base. Release minified ran 30 s fine. The main side has merged diff H.

**FPS of the final code (11:26, Release + overlay, machine idle at first, load 9):** demo 0–16 s **58.0 fps, 0 dropped frames**, worst
16.7 ms; no JS hitch > 50 ms. The steady lit section after 18 s measured 43.9 fps but **doesn't count**: the main agent's v12 re-render
(Blender GPU) started exactly at 11:26:32 = when the demo window ended. The demo already includes RainHit + the drip impact rings (running
while the tubes are lit), so the additions after v11 don't drop frames.

**FPS of the final code, re-measured 11:41 (idle machine, load 7, no Blender):** demo 0–16 s 58.2 fps, steady lit 18 s+ **58.0 fps**,
0 dropped frames in both, worst 16.7 ms, 0 JS hitches (sim capped at 60 Hz). The 43.9 fps at 11:26 was due to Blender, confirmed.
Main agent's final cut: `render/promo/neon-sign-final.mp4` (v12, 16.4 s).

## 01/11 12:00 — stopped

**Done:** items (1)–(5) plus the extras (summary table at the top of the file). Diffs A–H merged. The main agent's final cut is
`render/promo/neon-sign-final.mp4` (v12).
**Files to look at:**
- Code: `app/src/neon/` (Tube, Decor, Drops, LiveTrail, flicker), `app/src/shaders/` (wall, post, chalk)
- Before/after images: `notes/polish/`
- Tools: `tools/perf/`

**Remaining work:**
- Measure FPS on a real device at 120 Hz (the sim is 60 Hz only).
- Bench on the iPhone GPU: wall shader ≈1.5–2 ms on Mac.
- (optional) Load `normal.png`/`data.png` without gamut conversion. If done, the thresholds in wall.ts must be re-tuned.

**Shut down:** sink :8103 (Metro :8102 not running). Sim "Polish 17 Pro Max" shut down (not deleted). Temp folder
`$TMPDIR/neon-polish-*` deleted.
