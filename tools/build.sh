#!/usr/bin/env bash
# Blender pipeline → app/assets/scene: (Codex textures) → build scene → render once → split ambient/albedo/normal/data + layout.json
#   tools/build.sh            final (100 %, 128 samples)
#   PREVIEW=1 tools/build.sh  quick preview (50 %, 24 samples)
#   TEX=1 tools/build.sh      reprocess Codex images in blender/textures/raw first
set -eo pipefail
cd "$(dirname "$0")/.."
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
if [[ "${PREVIEW:-0}" == 1 ]]; then RARGS=(--pct 50 --samples 24); else RARGS=(--pct 100 --samples 128); fi
if [[ "${TEX:-0}" == 1 ]]; then
  "$BLENDER" -b --factory-startup -P blender/scripts/prep_textures.py 2>&1 | grep -E "TEX|Error|Traceback" || true
fi
"$BLENDER" -b --factory-startup -P blender/scripts/build_scene.py 2>&1 | grep -E "SAVED|BRICKS|Error|Traceback|line [0-9]+" || true
"$BLENDER" -b blender/neon.blend -P blender/scripts/render_passes.py -- "${RARGS[@]}" "$@" 2>&1 \
  | grep -E "── render|SAVE|LAYOUT|CHANNELS|Error|Traceback|line [0-9]+" || true
ls -lh app/assets/scene
