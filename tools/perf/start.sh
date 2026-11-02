#!/usr/bin/env bash
# Perf Metro (port 8102, sink 8103; sim "Polish 17 Pro Max") + launch the Debug dev client on the perf simulator with the FPS overlay.
#   tools/perf/start.sh            demo mode (EXPO_PUBLIC_DEMO=1), production JS (--no-dev --minify)
#   DEV=1 tools/perf/start.sh      dev JS (slower: __DEV__ checks, worklet debug) — only to compare
#   DEMO=0 tools/perf/start.sh     interactive mode
# Metro log (PERF / HITCH / SUMMARY lines) → render/perf/metro.log
set -eo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
UDID=${UDID:-56C2D726-BF2E-4533-B86C-CDA80C028906}
PORT=${PORT:-8102}
LOG=${LOG:-$ROOT/render/perf/metro.log}
mkdir -p "$(dirname "$LOG")"
FLAGS="--no-dev --minify"
[[ "${DEV:-0}" == "1" ]] && FLAGS=""

pkill -f "expo start.*--port $PORT" 2>/dev/null || true
# log sink for production bundles (render/perf/perf.log)
SINK_PORT=$((PORT + 1))
pgrep -f "tools/perf/sink.py $SINK_PORT" >/dev/null || nohup python3 tools/perf/sink.py "$SINK_PORT" "$ROOT/render/perf/perf.log" >/dev/null 2>&1 &
cd app
EXPO_OVERRIDE_METRO_CONFIG="$ROOT/tools/perf/metro.config.js" EXPO_PUBLIC_PERF=1 EXPO_PUBLIC_DEMO=${DEMO:-1} \
  EXPO_PUBLIC_PERF_SINK="http://localhost:$SINK_PORT" PERF_AUDIO_STUB=${AUDIO_STUB:-1} \
  PERF_OFF="${PERF_OFF:-}" EXPO_PUBLIC_PERF_OFF="${PERF_OFF:-}" PERF_FAST="${PERF_FAST:-}" EXPO_PUBLIC_PERF_BENCH="${BENCH:-0}" \
  nohup npx expo start --dev-client --port "$PORT" --clear $FLAGS >"$LOG" 2>&1 &
for _ in $(seq 60); do curl -sf "http://localhost:$PORT/status" >/dev/null && break; sleep 1; done
echo "metro :$PORT up, log $LOG"
xcrun simctl terminate "$UDID" dev.hoanghoa.neonsign 2>/dev/null || true
# --initialUrl: expo-dev-launcher loads the bundle directly (no "Open in Neon Sign?" prompt from openurl)
xcrun simctl launch "$UDID" dev.hoanghoa.neonsign --initialUrl "http://localhost:$PORT"
