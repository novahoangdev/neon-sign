#!/bin/bash
# rec.sh: record the simulator while the app runs slowed down (EXPO_PUBLIC_TIMESCALE = TS, default 0.5), then compress time back to 60 fps CFR.
# 60 Hz sim + TS 0.5 → 120 real frames per demo second, so the 60 fps output always has a new frame (no repeated frames when the machine is a bit loaded).
#
#   UDID=<sim> TS=0.5 SECS=14 OUT=render/promo/v3 tools/rec.sh       # terminate + launch the app (Release, built with the same TS)
#   TS=0.5 OUT=… RAW=raw.mov tools/rec.sh                             # only process an existing recording
# While recording: pause (SIGSTOP) the app on other sims, ffmpeg, Blender (like pumpkin pauseall.sh), then resume them.
# Output: $OUT/raw.mov (can be deleted after checking), $OUT/screen.mp4 (1320×2868, 60 fps CFR, demo time), $OUT/check.txt
#     (distinct frames per second of screen.mp4, target 60).
set -euo pipefail
cd "$(dirname "$0")/.."
TS=${TS:-0.5}; OUT=${OUT:?set OUT}; SECS=${SECS:-14}; PRE=${PRE:-6}; APP=${APP:-dev.hoanghoa.neonsign}
mkdir -p "$OUT"
RAW=${RAW:-}
if [[ -z "$RAW" ]]; then
  UDID=${UDID:?set UDID}
  RAW="$OUT/raw.mov"
  REAL=$(python3 -c "print(round($SECS / $TS + $PRE, 1))")
  df -g / | awk 'NR==2 && $4 < 15 {print "disk has " $4 " GB free < 15 GB, stopping"; exit 1}'
  PIDS=$(ps ax -o pid=,command= | grep -E 'CoreSimulator/Devices/[^/]+/data/Containers/Bundle/Application/.*\.app/|(^|/| )ffmpeg |Blender' \
    | grep -v "$UDID" | grep -v grep | awk '{print $1}' | tr '\n' ' ' || true)
  resume() { [[ -n "$PIDS" ]] && kill -CONT $PIDS 2>/dev/null; true; }
  trap resume EXIT
  [[ -n "$PIDS" ]] && { echo "pausing $(echo $PIDS | wc -w) processes"; kill -STOP $PIDS 2>/dev/null || true; sleep 1; }
  xcrun simctl terminate "$UDID" "$APP" 2>/dev/null || true
  rm -f "$RAW"
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$RAW" 2>"$OUT/rec.log" & REC=$!
  until grep -q "Recording started" "$OUT/rec.log" 2>/dev/null; do sleep 0.2; done
  xcrun simctl launch "$UDID" "$APP" >/dev/null
  echo "recording $REAL s real time (TS=$TS)…"
  sleep "$REAL"; kill -INT $REC; wait $REC 2>/dev/null || true
  resume; trap - EXIT
fi
ffmpeg -y -loglevel error -i "$RAW" -an -vf "setpts=PTS*$TS,fps=60,scale=1320:2868:flags=lanczos" -r 60 \
  -c:v libx264 -preset slow -crf 13 -pix_fmt yuv420p -movflags +faststart "$OUT/screen.mp4"
ffmpeg -hide_banner -i "$OUT/screen.mp4" -vf "mpdecimate=hi=1:lo=1:frac=0,showinfo" -f null - 2>&1 \
  | grep -o "pts_time:[0-9.]*" | cut -d: -f2 \
  | python3 -c "
import sys
b={}
for x in sys.stdin.read().split(): b[int(float(x))]=b.get(int(float(x)),0)+1
print('distinct frames per second (target 60): ' + ' '.join(f'{k}:{b.get(k,0)}' for k in range(max(b)+1)))" | tee "$OUT/check.txt"
echo "→ $OUT/screen.mp4"
