# Neon Sign: draw your own neon sign

> **Status (01/11, 12:00) — STOPPED; sim "Neon Main" shut down, no background processes left, temp folders deleted; remaining: record v13 if we want water rings when drops hit the ground (already in the app, not in the clip):** M0–M5 ✅. **Final clip: `render/promo/neon-sign-final.mp4`** (= v12: 16.4 s, 1920×1440 60 fps, phone static at the centre of the frame for the whole clip, one straight cut to the end card, first frame is the "hello" sign already lit; audio −14.1 LUFS / −1.3 dBTP), quick-look image `render/promo/neon-sign-sheet-final.jpg`, caption `render/promo/caption-final.txt`. To rebuild: beats `blender/scripts/beats/v12.json`, recording `render/promo/v12/screen.mp4` (FILM0 2.2), audio `render/audio/mix_v12.wav` (README section "Recording the demo clip (for X), version 3"). Previous versions for comparison: `neon-sign-demo-v{3,4,6,8,10,11}.mp4`. Smoothness: Release TIMESCALE 1 = 60/60 frames/s on the sim (sim is 60 Hz only, 120 Hz on a real device not measured yet); NeonScene allocates nothing per frame.
> **POLISH (12:00, stopped):** items 1–5 done, diffs A–H merged, recordings v8–v12 checked at 60/60 frames. Realistic neon (gas saturating in 5 steps to a white core, red neon vs argon/phosphor: strike, warm-up, afterglow, soft flicker; frosted vs clear glass; shadows with volume; rain water beading/dripping/splashing on the tubes), wall (dark mortar, wet grazing-light sheen, running water, wet wall base), puddle (correct reflection, ripple rings, meniscus edge, splashes; grainy asphalt), LiveTrail chalk trail. Release 58/60 fps on the sim for both demo and steady lit, 0 dropped frames (11:41). Details in `notes/polish.md`. Remaining: measure on a real iPhone 17 Pro Max at 120 Hz (sim is 60 Hz only).
> **File ownership (01/11):** the MAIN agent owns `app/src/scene/`, `app/src/demo/`, `app/src/ui/`, `app/src/fx/`, `App.tsx`, `app.json`, `blender/`, `tools/*.sh`, `tools/*.py`, `PLAN.md`, `README.md`, `render/`; native builds + recording + clip editing. The POLISH agent owns `app/src/neon/`, `app/src/shaders/`, `app/src/perf/`, `tools/perf/`, `notes/polish.md`, `notes/polish/`. To change the other's files: write the diff into `notes/<name>.md` and message via orca.

An iPhone demo of about 15 seconds to post on X. Use a finger to write words or draw shapes on a brick wall at night, and the strokes become glass neon tubes. Flip the switch and the lights flicker a few times, then light up fully, casting neon colour onto the brick wall and the puddle below.

Plan written on 31/10/2026. Skia is the core (paths, glow, wall lighting shader); Reanimated handles gestures, the switch-on sequence, gyro, haptics; Blender makes the brick wall and props.

---

## 0. Summary

**Clip story.** A dark alley, a damp brick wall, a puddle on the ground. A finger writes "hello" in connected handwriting, then draws a heart. On lift, the strokes become unlit glass tubes, with clips holding the tubes and wires running to a transformer box. Flip the switch: a "click", the lights flicker 3–5 irregular times, then light up fully. The brick wall blushes pink, the mortar joints catch the light, the puddle reflects the letters and ripples gently. Tap another colour and the neon gas flows along the tube, changing colour from the electrode end to the other. Tilt the phone and the highlight on the glass slides along, the tube shadows on the wall shift slightly. Now and then a "broken" letter blinks off once like a real sign.

**Architecture.** Everything is real-time 2D in Skia over a wall image pre-rendered by Blender (colour, normal, roughness, AO, plus a wet ground area). No real-time 3D needed.

- **Neon tubes** are multi-layer `SkPath`s: glass body, bright core, blurred glow layers, added with `plus` blending.
- **Light on the wall** is computed by an SkSL runtime shader: light from a large blur of the neon strokes, light direction from that blur's gradient, multiplied with the brick normal map. That way brick edges and mortar joints really catch the light instead of just getting a colour halo.
- **The puddle** is a reflection shader: flip the neon layer, distort it with ripples, blur by distance, composite into the ground area.

### Stack

Same as `../goku-vs-frieza/app/package.json` and `../pumpkin-carve/app` (if available): Expo SDK 58, RN 0.88.1, `react-native-skia` 3.8.x, Reanimated 4.7.1 + worklets 0.13, gesture-handler 3.3, expo-haptics, expo-dev-client. Run a dev build, no Expo Go, no `react-native-webgpu` needed. Blender 5.2.2 at `/Applications/Blender.app`, run headless with `-b -P`. FFmpeg for the promo.

**2D assets: generate freely with Codex, no need to ask** (torn posters on the wall, faded graffiti, brick or mortar textures if needed, end card logo, concept art):

```sh
codex exec --skip-git-repo-check -s workspace-write "Generate <description>, no text. Save it as <name>.png in the current directory and print its absolute path."
```

If Codex can't save the file, take the image from `~/Library/Application Support/orca/codex-accounts/*/home/generated_images/`. Compress images before putting them in `app/assets` or `blender/textures`.

---

## 1. Art direction

- Tone: a city alley at night just after the rain, like night film photography. Deep blacks, neon as the only main light source, plus a very faint cold blue streetlight from the top left.
- Wall: old red bricks of uneven sizes, chipped mortar, damp streaks running down, a few torn posters. A metal drainpipe on the right edge. The ground is wet concrete, with a puddle in the bottom 1/5 of the screen.
- Neon colours (selectable): pink `#ff3fa4`, cyan `#3ff3ff`, amber `#ffb13f`, lime `#9dff3f`, purple `#a35bff`, red `#ff3b3b`, warm white `#fff1d6`. The tube core is always near white; the colour lives in the glow layer.
- Glass tube when off: slightly translucent smoky grey, with a thin white highlight streak and reflections of the streetlight.
- Realistic details: black-painted joins between letters (blockout), metal electrodes at both ends, plastic clips holding the tube ~2cm off the wall, black wires running to a small transformer box hanging below.

## 2. Experience and clip storyboard

| Seconds | Shot | Interaction / effect |
|---|---|---|
| 0–1.5 | Dark brick wall, light drifting steam | Subtle gyro parallax, puddle ripples |
| 1.5–6 | Write "hello" in one stroke, then draw a heart | A faint chalk-like glow trail follows the finger. On lift the stroke "freezes" into a glass tube, clips and wires appear |
| 6–8 | Flip the switch | Click sound, strong haptic. Lights flicker 3–5 times, staggered between letters, a light haptic on each, then full on |
| 8–10 | Wall lights up | Mortar joints catch the light, puddle reflects, bloom |
| 10–12 | Change the heart to red, the text to cyan | Neon gas flows along the tube from the electrode |
| 12–14 | Tilt the phone, the "o" glitches for one beat | Highlight slides along the tube, tube shadow shifts |
| 14–15 | End card (done in the promo) | |

Minimal UI: a row of round colour swatches at the bottom (7 colours), an Undo button, a Clear button, a metal toggle switch in the bottom-right corner. The brush has 2 tube thicknesses (thin / thick). Once the lights are on, the UI dims to 40%.

## 3. Drawing and building tubes

- **Gesture:** Pan runs on the UI thread, smooths points (Catmull-Rom, drops points that are too close), builds an `SkPath`. Each stroke is a tube with its own colour.
- **Linking:** strokes that start < ~1.2s after the previous one and have the same colour are joined by a blockout segment (black-painted tube, drawn faint), like a real sign made of one continuous tube.
- **Tube when off:** 3 stroke layers:
  1. tube body width w, smoky grey, alpha 0.55;
  2. dark rim on both edges (stroke width w, inner shadow via mask blur);
  3. thin 0.18w highlight offset towards the light (moves with the gyro).
  Plus a soft tube shadow on the wall (moves with the gyro, 2cm standoff).
- **Tube when lit:** white core (0.35w), colour layer (w), then 3 levels of blurred glow (σ ≈ 6, 18, 48pt), added with `plus` blending, brightness multiplied by each tube's flicker factor.
- **Clips and electrodes:** small sprites (Blender) placed every ~90pt along the path and at both ends. Sprites are oriented along the path tangent (`getPosTan` from `PathMeasure` / `ContourMeasure`).
- **Colour change:** use the path's `start`/`end` (trim) so a new-colour segment runs from the electrode to the other end in ~600ms while the old colour retracts. The meeting edge is slightly brighter.

## 4. Shaders

- **Wall layer (`wall.ts`):** inputs are `albedo`, `normal`, `roughness`, `ao` (Blender) and `glow` (a large glow image of all tubes, blur σ ~80pt, rendered offscreen at 1/4 resolution, updated only when strokes or brightness change).
  - Light direction `L = normalize(vec3(-∇glow, z))`, diffuse = `albedo * glowColor * max(dot(N, L), 0) * ao`.
  - Subtle specular on damp streaks via `roughness`.
  - Add a very faint cold streetlight and a vignette.
- **Puddle (`puddle.ts`):** within `ground_mask`, sample the neon + wall layers flipped about the wall base line, distort uv with 2 wave layers (slow ripples + random raindrops making circular rings), blur increasing with distance, multiplied by reflectance (simple Fresnel).
- **Flicker (`flicker.ts` or a worklet):** each tube has a state machine:
  - On switch-on: randomly off 30–120ms → on 40–200ms, 3–5 times, then steady (overshoot +15% then back to 100%).
  - When steady: 2% amplitude noise, and every 6–12s a "broken" tube blinks off for 60ms.
  - Each tube's brightness feeds both the glow and the wall lighting, so when a letter blinks the wall area near it blinks too.
- **Post:** bloom (blur of over-bright areas), light film grain, very slight chromatic aberration at the edges, slowly drifting steam (low-alpha fbm) tinted by the neon.

## 5. Blender

Built by scripts so it can be re-run (following `goku-vs-frieza/blender/scripts`):

- `build_scene.py`: wall plane with procedural bricks (brick texture + real displacement, recessed mortar), damp streaks, posters (Codex images), drainpipe, wet concrete ground, puddle (reflective plane). Plus a transformer box and a switch box. Camera faces the wall straight on, 1320×2868 aspect (iPhone 17 Pro Max, 440×956 pt design frame), ground in the bottom 1/5.
- `render_passes.py`, Cycles for quality:
  - `albedo.jpg`, `normal.png` (camera space), `roughness.png`, `ao.png`, `ambient.jpg` (scene lit only by the cold streetlight, dark);
  - `ground_mask.png`, `horizon.json` (y of the wall base line for flipping the reflection).
- `sprites.py`: tube clips, electrodes, wire ends; render several angles or one rotatable sprite.
- Write the layout (drawable area, switch and transformer positions) to `app/assets/scene/layout.json`.

## 6. Folder structure

```
neon-sign/
  PLAN.md  README.md
  blender/scripts/  build_scene.py  render_passes.py  sprites.py  promo.py
  blender/textures/
  tools/            build.sh  promo.sh
  app/
    src/scene/NeonScene.tsx        Canvas, layers, phases
    src/draw/useStrokeGesture.ts   pan, smoothing, blockout joins
    src/neon/Tube.tsx              one tube: body, core, glow, clips, electrodes, colour-change trim
    src/neon/flicker.ts            flicker state machine
    src/shaders/wall.ts  puddle.ts  post.ts  steam.ts
    src/ui/Switch.tsx  Palette.tsx
    src/demo/script.ts             pre-built handwritten strokes + fake tilt
```

## 7. Demo mode and the X clip

- `EXPO_PUBLIC_DEMO=1`: the app runs exactly the storyboard in section 2. The connected handwritten "hello" and the heart are pre-built SVG paths (monoline, nice), played back at human writing speed, with a faint "virtual finger" dot. The switch flips by itself, colours change by themselves. Tilt follows a preset curve since the simulator has no gyro; the dev build supports two-finger drag to fake tilt.
- Promo: copy and adapt `tools/promo.sh` + `blender/scripts/promo.py` from Goku (or from `pumpkin-carve` if it has a newer version). 4:3 frame, 60fps, iPhone mockup with titanium frame, 9:41 status bar. **The camera must move, not stay still:**
  - push in close on the finger while writing, punch-zoom + shake when flipping the switch and when the lights burst on;
  - rotate the phone in 3D in sync with the tilt;
  - neon glow spills out of the phone frame, tinting the promo background;
  - background gradient changes with the current neon colour;
  - big animated text behind: "DRAW" → "SWITCH" → "GLOW", the end card text animates too.
  - Moves are eased, 0.4–1.2s, with holds.
- End card: "Neon Sign" logo built like a real neon sign (drawn with the app itself or with a shader in the promo), tagline "Write it. Flip it. Watch it glow.", credits "Expo · React Native · Skia · Reanimated · Blender", "by Hoa Hoang · @novahoangdev".
- The simulator recording must be conformed to CFR by container pts before editing, keep speed close to 1.0x, no cross-dissolve between two mismatched shots.
- Include a quick-look image (6-frame sheet) and an X caption following the template: "React Native can bend neon ✨", a one-sentence pitch, the lines "Expo @expo / Skia @wcandillon / Reanimated @swmansion", then a "Follow along…" line.

## 8. Order of work (every milestone must be recordable)

| Milestone | Content | Done when |
|---|---|---|
| **M0** | Init the app, Blender builds the wall and renders preview passes, scene displays correctly | Dark brick wall visible on the simulator |
| **M1** | Drawing: gesture, tube off, tube lit (core + glow), switch, flicker, haptics | Write text, flip the switch, text lights up and flickers |
| **M2** | Wall lighting via normal map, puddle reflection, bloom, steam | Wall and puddle look "wow" |
| **M3** | Demo mode, record and edit the animated promo clip, quick-look image, caption | Clip file exists |
| **M4** | Colour change via trim flowing along the tube, blockout, clips, electrodes, wires, transformer, broken tube, high-quality final render, re-record the clip | Clip version 2 |
| **M5** | Sound (switch click, transformer hum, flicker), light rain, performance measurement on a real device | |

## 9. Risks

- **Multi-layer glow on long paths drops FPS:** render the glow offscreen at low resolution and redraw only when the path or brightness changes. Core and body drawn directly.
- **Wall lighting looks flat:** increase normal map depth, use the glow gradient as the light direction, add AO. Compare with photos of real neon before locking in.
- **Ugly handwriting:** demo mode uses pre-built paths; real users get smoothing.
- **Simulator has no gyro:** fake tilt in demo mode.

## 10. Chosen defaults (changeable)

- Display name "Neon Sign", bundle id `dev.hoanghoa.neonsign`.
- Recording device: only the project's own simulator "Neon 17 Pro Max" (iPhone 17 Pro Max, UDID `00D2EDD4-7AB4-43E8-A39E-ABD29B5EFDCA`, iOS 27.0), portrait. Screen 1320×2868 px = 440×956 pt; Blender renders, `layout.json`, demo and promo all use this frame. iOS only.
- Don't create a git repo or push without asking.
