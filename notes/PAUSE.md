Main agent, 01/11 11:42 (replaces the 31/10 note).

Done:
- Final cut `render/promo/neon-sign-final.mp4` (= v12, background rain reduced 40 %), sheet `neon-sign-sheet-final.jpg`, caption `caption-final.txt`.
  Beats `v12.json`, recording `render/promo/v12/screen.mp4` (FILM0 2.2), audio `render/audio/mix_v12.wav`; v11 still in `render/promo/v11`.
  Older cuts for comparison: `neon-sign-demo-v{3,4,6,8,10,11}.mp4` (only the v11 and v12 recordings remain).
- Main agent sim "Neon Main 17 Pro Max" `1EC1F0DA-F8DB-424A-A057-352746A3F34C`; Release build (neon heart icon) in DerivedData.
- Pipeline: `tools/embed.sh` (swap JS) → `tools/rec.sh` (TS 0.5) → `tools/sync.py 9.8` (FILM0 = flash second − 9.8) →
  `mix_v3.py --bpm 110` (writes app_end into beats) → `WORKERS=3 PROMO_FAST=1 tools/promo.sh` → `tools/sheet.sh`.
  Full commands: README section "Recording the demo video" and notes/m4.md. Render takes ~17 minutes (3 Blender processes).

In progress: nothing. After v12 POLISH only added the water ring when a drip hits the ground (Drops.tsx, in the app, not yet in the clip); to get it into the clip, record v13 with the pipeline above.
Temp folders: cleaned up (render/embed, frames, raw.mov, scratchpad).
