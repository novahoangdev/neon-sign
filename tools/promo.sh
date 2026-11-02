#!/usr/bin/env bash
# Record the app on the simulator, then build a 4:3 demo clip to post on X (copied and adapted from ../pumpkin-carve/tools/promo.sh).
#   tools/promo.sh [--beats blender/scripts/beats/v1.json] <udid>
#       Release build of the app with EXPO_PUBLIC_DEMO=1, installed on the simulator (bundle dev.hoanghoa.neonsign)
#   tools/promo.sh --beats blender/scripts/beats/v1.json --screen render/promo/v1/screen.mp4 [--film-start 2.36] [--out x.mp4]
#       no recording: rebuild from an existing recording (already CFR 60fps, 1320×2868); no udid needed
#   tools/promo.sh --beats … --screen … --stills 2,8.8,12,15,20
#       render only a few frames (seconds in the promo clip) to render/promo/stills/ for a quick look
# Beat sheet (JSON, one file per recording) holds every timing: app_start/app_end/card, burst (sync point), audio,
#   background colour, glow, background text, camera, phone, punch/shake, frames for sheet.sh. Default: blender/scripts/beats/v1.json
# Environment: PCT=50 (render at half resolution for tests), LABEL=v2 (small bottom-left label),
#   FRAMES=render/promo/frames (frame directory), AUDIO=… (overrides the beat sheet audio), REC_SECS=… (recording length),
#   PAUSE_PATTERN="render_passes.py" (pause heavy processes while recording), BLENDER=...
# Output: render/promo/neon-sign-demo.mp4 (H.264 1920×1440 60fps [+ AAC if an audio file exists])
#     and render/promo/screen.mp4 (CFR screen recording, when recording fresh)
set -eo pipefail
cd "$(dirname "$0")/.."
APP=dev.hoanghoa.neonsign
OUT=render/promo
FRAMES=${FRAMES:-$OUT/frames}   # PNG frame directory (change when running two versions in parallel)
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
BEATS=blender/scripts/beats/v1.json
UDID="" SCREEN="" FILM0="" STILLS="" FINAL="$OUT/neon-sign-demo.mp4"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --beats) BEATS=$2; shift 2 ;;
    --screen) SCREEN=$2; shift 2 ;;
    --film-start) FILM0=$2; shift 2 ;;
    --stills) STILLS=$2; shift 2 ;;
    --out) FINAL=$2; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) UDID=$1; shift ;;
  esac
done
[[ -f "$BEATS" ]] || { echo "beat sheet not found: $BEATS" >&2; exit 1; }
beat() { python3 -c "import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2], sys.argv[3]); print(v)" "$BEATS" "$1" "$2"; }
BURST_T=$(beat burst 6.67)          # app second of the first shared flash after flipping the switch → sync point
APP_START=$(beat app_start 0.7)     # app second matching the first clip frame
AUDIO=${AUDIO:-$(beat audio render/audio/mix.wav)}   # audio starts at app t=0
mkdir -p "$OUT"

if [[ -z "$SCREEN" ]]; then
  [[ -n "$UDID" ]] || { echo "need <udid> (or --screen <file> to build from an existing recording)" >&2; exit 1; }
  # 1. clean ad-style status bar
  xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 \
    --cellularMode active --cellularBars 4 --wifiBars 3 --dataNetwork wifi

  # 2. record: the demo app runs its script by itself; record ~6 s past app_end so the clip isn't short of footage
  #    PAUSE_PATTERN: pause heavy processes (e.g. Blender renders) while recording so the simulator doesn't stutter
  PIDS=""
  #    only pause batch processes (Blender, ffmpeg); do NOT pause shell / claude / node even if their command line contains the pattern
  #    (SIGSTOP on a terminal session makes the shell treat the job as suspended → that session is stuck in the background until you type `fg`)
  if [[ -n "${PAUSE_PATTERN:-}" ]]; then
    for p in $(pgrep -f "$PAUSE_PATTERN" || true); do
      c=$(basename "$(ps -o comm= -p "$p" 2>/dev/null)" 2>/dev/null)
      [[ "$c" == Blender || "$c" == ffmpeg ]] && PIDS="$PIDS $p"
    done
  fi
  resume() { [[ -n "$PIDS" ]] && kill -CONT $PIDS 2>/dev/null || true; }
  trap 'resume; xcrun simctl status_bar "$UDID" clear 2>/dev/null || true' EXIT
  [[ -n "$PIDS" ]] && kill -STOP $PIDS && sleep 2
  xcrun simctl terminate "$UDID" "$APP" 2>/dev/null || true
  rm -f "$OUT/raw.mov"
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$OUT/raw.mov" >/dev/null 2>&1 &
  REC=$!
  sleep 1.5
  xcrun simctl launch "$UDID" "$APP" >/dev/null
  sleep "${REC_SECS:-$(python3 -c "print(round($(beat app_end 14.9) + $(beat card 3.6) + 6))")}"
  kill -INT "$REC"; wait "$REC" 2>/dev/null || true
  resume

  # 3. resample to steady 60fps from the container pts (the simulator records a variable frame rate) — keeps exact 1.0x speed
  ffmpeg -y -loglevel error -i "$OUT/raw.mov" -vf "fps=60,scale=1320:2868:flags=lanczos" \
    -c:v libx264 -crf 14 -pix_fmt yuv420p -an "$OUT/screen.mp4"
  SCREEN="$OUT/screen.mp4"
fi
[[ -f "$SCREEN" ]] || { echo "not found: $SCREEN" >&2; exit 1; }

# 4. detect the first light flash (tools/sync.py): the first jump in mean brightness after the flip
#    → FILM0 = that frame's second − burst = the second in the recording matching app t=0.
#    Only look from second "burst" onward (the light can't flash earlier in the recording) → ignores brightness jumps at app launch.
if [[ -z "$FILM0" ]]; then
  read -r BURST JUMP < <(ffmpeg -loglevel error -i "$SCREEN" \
      -vf "scale=64:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - \
    | awk '/pts_time/{split($0,a,"pts_time:"); t=a[2]+0} /YAVG/{split($0,b,"="); print t, b[2]+0}' \
    | python3 tools/sync.py "$BURST_T")
  FILM0=$(python3 -c "print(round($BURST - $BURST_T, 3))")
  echo "light flashes at ${BURST}s (YAVG +${JUMP}) → app t=0 at ${FILM0}s in the recording"
  python3 -c "import sys; sys.exit(0 if $FILM0 + $APP_START >= 0 else 1)" \
    || { echo "FILM0 negative: recording started too late or the sync point was misdetected — pass --film-start manually" >&2; exit 1; }
fi

# 5. build the 4:3 clip in Blender (all timings from the beat sheet)
PROMO_ARGS=(--beats "$BEATS" --screen "$SCREEN" --film-start "$FILM0" --pct "${PCT:-100}" --label "${LABEL:-}")
if [[ -n "$STILLS" ]]; then
  rm -rf "$OUT/stills"
  "$BLENDER" -b --factory-startup -P blender/scripts/promo.py -- "${PROMO_ARGS[@]}" --out "$OUT/stills" --stills "$STILLS" \
    2>&1 | grep -E "PROMO|Error|Traceback" || true
  ls "$OUT/stills"
  exit 0
fi
rm -rf "$FRAMES"
T0=$(date +%s)
# WORKERS=N (default 3): N parallel Blender processes, each on a contiguous frame range (the GPU is otherwise idle while a
# process reads video frames / writes PNGs). PROMO_FAST=1: 8-sample TAA (the phone is static so no visible difference).
TOTAL=$(python3 -c "import json; b=json.load(open('$BEATS')); print(round((b['app_end'] - b['app_start'] + b.get('card', 3.6)) * 60))")
W=${WORKERS:-3}
PIDS_R=()
for ((i = 0; i < W; i++)); do
  a=$(( TOTAL * i / W )); b=$(( TOTAL * (i + 1) / W - 1 ))
  "$BLENDER" -b --factory-startup -P blender/scripts/promo.py -- "${PROMO_ARGS[@]}" --out "$FRAMES" --range "$a,$b" \
    > "$FRAMES.part$i.log" 2>&1 &
  PIDS_R+=($!)
done
for p in "${PIDS_R[@]}"; do wait "$p" || true; done
grep -hE "Traceback|Error" "$FRAMES".part*.log | head -5 || true
rm -f "$FRAMES".part*.log
NF=$(ls "$FRAMES" | grep -c '\.png$' || true)
[[ "$NF" -gt 0 ]] || { echo "Blender produced no frames" >&2; exit 1; }
DUR=$(python3 -c "print(round($NF / 60, 3))")
echo "rendered $NF frames (${DUR}s) in $(( $(date +%s) - T0 ))s"

# 6. export for X; audio starts at app t=0 → trim the first APP_START seconds to match the picture.
#    the audio fades out by itself at the end (tail plays under the end card) → only add a 0.5 s fade at the very end of the clip to be safe
VENC=(-c:v libx264 -profile:v high -preset slow -crf 17 -pix_fmt yuv420p -r 60 -movflags +faststart)
if [[ -f "$AUDIO" ]]; then
  AF=$(python3 -c "
s, d = $APP_START, $DUR
head = f'atrim=start={s},asetpts=PTS-STARTPTS' if s >= 0 else f'adelay={round(-s*1000)}:all=1'
print(f'{head},apad,atrim=end={d},afade=t=out:st={round(d - 0.5, 2)}:d=0.5')")
  ffmpeg -y -loglevel error -stats -framerate 60 -i "$FRAMES/%04d.png" -i "$AUDIO" \
    -filter_complex "[1:a]$AF[a]" -map 0:v -map "[a]" -t "$DUR" \
    "${VENC[@]}" -c:a aac -b:a 192k -ar 48000 "$FINAL"
else
  echo "no $AUDIO yet → exporting a silent clip"
  ffmpeg -y -loglevel error -stats -framerate 60 -i "$FRAMES/%04d.png" "${VENC[@]}" "$FINAL"
fi
ls -lh "$FINAL"
