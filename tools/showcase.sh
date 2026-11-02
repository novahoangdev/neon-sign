#!/usr/bin/env bash
# Save a showcase version (demo mode ~40–50 s) to compare / merge feedback later:
#   tools/showcase.sh v5 "short note"                   embed the current JS into the Release build, record, save
#   SCREEN=…/screen.mp4 tools/showcase.sh v4 "…"        use an existing recording (60 fps CFR, scene time, uncut)
# Recording: current JS embedded into the existing Release build (tools/perf/embed.sh, no native build), EXPO_PUBLIC_TIMESCALE=0.5
#   on a dedicated sim (default "Polish 17 Pro Max"), then time-compressed to 60 fps → 120 real frames per demo second, smooth
#   even when the machine is loaded. Does NOT pause other processes (unlike tools/rec.sh).
# Output in render/showcase/<v>/:
#   screen.mp4    1320×2868 60 fps, starting at t = 0 of the scene clock (first flash detected at SYNC_T = 9.8 s)
#   preview.mp4   quick preview at 540 px 30 fps (+ audio if render/showcase/<v>/mix.wav or MIX=… exists)
#   sheet.jpg     16 evenly spaced frames · src.tgz  copy of app/src · NOTES.md  notes
set -eo pipefail
cd "$(dirname "$0")/.."
V=${1:?version, e.g. v5}; NOTE=${2:-}
UDID=${UDID:-56C2D726-BF2E-4533-B86C-CDA80C028906}
DUR=${DUR:-$(node -e "const j=require('./app/src/demo/timeline.json'); console.log(j.end)" 2>/dev/null || echo 43)}
SYNC_T=${SYNC_T:-9.8}
TS=${TS:-0.33}  # time scale while recording (0.33 default since the night of 01/11: other sims often hog the CPU; fully idle → 0.5)
PRE=${PRE:-0}   # seconds of intro before t = 0 kept in screen.mp4 (app launch screen, src/intro)
LEN=$(python3 -c "print(round($DUR + $PRE, 3))")
OUT=render/showcase/$V
mkdir -p "$OUT"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/neon-showcase.XXXX")
if [[ -z "${SCREEN:-}" ]]; then
  xcrun simctl boot "$UDID" 2>/dev/null || true
  TIMESCALE=$TS PLAIN=1 UDID=$UDID WORK=${TMPDIR:-/tmp}/neon-showcase-embed tools/perf/embed.sh >"$TMP/embed.log" 2>&1 </dev/null \
    || { tail -20 "$TMP/embed.log"; exit 1; }
  pkill -f tools/perf/sink.py 2>/dev/null || true
  xcrun simctl terminate "$UDID" dev.hoanghoa.neonsign 2>/dev/null || true
  sleep 1
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$TMP/raw.mov" 2>"$TMP/rec.log" & REC=$!
  until grep -q "Recording started" "$TMP/rec.log" 2>/dev/null; do sleep 0.2; done
  xcrun simctl launch "$UDID" dev.hoanghoa.neonsign >/dev/null
  REAL=$(python3 -c "print(round(($LEN + 4) / $TS, 1))")
  echo "recording ${REAL}s real time…"
  sleep "$REAL"; kill -INT $REC; wait $REC 2>/dev/null || true
  xcrun simctl terminate "$UDID" dev.hoanghoa.neonsign 2>/dev/null || true
  ffmpeg -y -loglevel error -i "$TMP/raw.mov" -an -vf "setpts=PTS*$TS,fps=60" -r 60 -c:v libx264 -preset fast -crf 14 \
    -pix_fmt yuv420p "$TMP/full.mp4"
  SCREEN=$TMP/full.mp4
fi
# t = 0 sync point: first shared flash when the lights come back on (FIRST_FLASH) at SYNC_T scene seconds
ffmpeg -i "$SCREEN" -vf "scale=66:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - 2>/dev/null \
  | awk -v lim="$(python3 -c "print($SYNC_T + $PRE + 8)")" '/pts_time/{split($0,a,"pts_time:"); t=a[2]} /YAVG/{split($0,b,"="); if (t < lim) print t, b[2]}' >"$TMP/yavg.txt"
# (only look 8 s past SYNC_T: later lightning / cascade switch-ons are even brighter, don't catch them by mistake)
FL=$(python3 tools/sync.py "$(python3 -c "print($SYNC_T)")" <"$TMP/yavg.txt" | awk '{print $1}')
FILM0=$(python3 -c "print(round($FL - $SYNC_T, 3))")
echo "flash at ${FL}s → t = 0 at ${FILM0}s"
python3 -c "import sys; sys.exit(0 if $FILM0 > 0.2 else 1)" || echo "WARNING: no flash detected (t = 0 at ${FILM0}s) — the app may have crashed, check sheet.jpg"
START=$(python3 -c "print(max(0, round($FILM0 - $PRE, 3)))")
python3 -c "import sys; sys.exit(0 if $FILM0 - $PRE >= 0 else 1)" || echo "WARNING: recording starts later than t = −$PRE"
ffmpeg -y -loglevel error -ss "$START" -i "$SCREEN" -t "$LEN" -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p -r 60 \
  -movflags +faststart "$OUT/screen.mp4"
MIX=${MIX:-$OUT/mix.wav}
if [[ -f "$MIX" ]]; then
  ffmpeg -y -loglevel error -i "$OUT/screen.mp4" -i "$MIX" -map 0:v -map 1:a -t "$LEN" -vf "scale=540:-2,fps=30" \
    -c:v libx264 -preset medium -crf 26 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "$OUT/preview.mp4"
else
  ffmpeg -y -loglevel error -i "$OUT/screen.mp4" -vf "scale=540:-2,fps=30" -c:v libx264 -preset medium -crf 26 \
    -pix_fmt yuv420p -movflags +faststart "$OUT/preview.mp4"
fi
ffmpeg -y -loglevel error -i "$OUT/screen.mp4" -vf "fps=16/$LEN,scale=220:-1,tile=8x2" -frames:v 1 -q:v 4 "$OUT/sheet.jpg"
tar -czf "$OUT/src.tgz" -C app src
{
  echo "# Showcase $V — $(date '+%d/%m %H:%M')"
  echo
  echo "${NOTE}"
  echo
  echo "- screen.mp4: 1320×2868 60 fps, ${LEN}s from t = −${PRE} (FILM0 ${FILM0}s in the recording)"
  echo "- preview.mp4: 540 px 30 fps · sheet.jpg: 16 frames · src.tgz: app/src at recording time"
} >"$OUT/NOTES.md"
# smoothness: distinct frames per second (target 60)
ffmpeg -hide_banner -i "$OUT/screen.mp4" -vf "mpdecimate=hi=1:lo=1:frac=0,showinfo" -f null - 2>&1 | grep -o "pts_time:[0-9.]*" \
  | cut -d: -f2 | python3 -c "
import sys
xs=[float(x) for x in sys.stdin.read().split()]
b={}
for x in xs: b[int(x)]=b.get(int(x),0)+1
low=[k for k in range(int(max(xs))) if b.get(k,0)<58]
print('distinct frames / second: min', min(b.get(k,0) for k in range(int(max(xs)))), '· seconds below 58:', low or 'none')" | tee -a "$OUT/NOTES.md"
rm -rf "$TMP"
ls -lh "$OUT"
