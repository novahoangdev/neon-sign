#!/usr/bin/env bash
# JS-only run on the POLISH simulator, no native build: copy the main agent's Release .app, swap in a freshly
# exported bundle (perf Metro config → PerfApp + FPS overlay, or the plain app with PLAIN=1), Hermes-compile it,
# ad-hoc sign, install and launch.
#   tools/perf/embed.sh                 demo + FPS overlay (log → render/perf/perf.log via sink :8103)
#   BENCH=1 tools/perf/embed.sh         GPU layer benchmark
#   PLAIN=1 tools/perf/embed.sh         the app exactly as shipped (no overlay) — for before/after screenshots
# MINIFY=false by default: the minified perf bundle crashes in a worklet (overlay only; the plain minified app is fine).
# Needs the Release app to contain every native module the JS uses (expo-audio is stubbed unless AUDIO_STUB=0).
set -eo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
UDID=${UDID:-56C2D726-BF2E-4533-B86C-CDA80C028906}
SINK_PORT=${SINK_PORT:-8103}
REL=$(ls -d ~/Library/Developer/Xcode/DerivedData/NeonSign-*/Build/Products/Release-iphonesimulator/NeonSign.app | head -1)
# snapshot of the main agent's Release app (it rebuilds in place): refreshed with BASE=1 or when missing
SRC=${BASE_APP:-${TMPDIR:-/tmp}/neon-polish-base/NeonSign.app}
if [[ "${BASE:-0}" == "1" || ! -d "$SRC" ]]; then rm -rf "$SRC" && mkdir -p "$(dirname "$SRC")" && cp -cR "$REL" "$SRC"; fi
WORK=${WORK:-${TMPDIR:-/tmp}/neon-polish-embed}
rm -rf "$WORK" && mkdir -p "$WORK"
cp -cR "$SRC" "$WORK/NeonSign.app"

pgrep -f "tools/perf/sink.py $SINK_PORT" >/dev/null || nohup python3 tools/perf/sink.py "$SINK_PORT" "$ROOT/render/perf/perf.log" >/dev/null 2>&1 &

cd app
ENVV=(EXPO_PUBLIC_DEMO=${DEMO:-1} EXPO_PUBLIC_TIMESCALE=${TIMESCALE:-1})
if [[ "${PLAIN:-0}" == "1" && "${POLISH_SCENE:-0}" == "1" ]]; then
  # plain app (no overlay) but with the POLISH preview scene
  ENVV+=(EXPO_OVERRIDE_METRO_CONFIG="$ROOT/tools/perf/metro.config.js" PERF_ENTRY=0 POLISH_SCENE=1)
elif [[ "${PLAIN:-0}" != "1" ]]; then
  ENVV+=(EXPO_OVERRIDE_METRO_CONFIG="$ROOT/tools/perf/metro.config.js" EXPO_PUBLIC_PERF=1
    EXPO_PUBLIC_PERF_SINK="http://localhost:$SINK_PORT" PERF_AUDIO_STUB=${AUDIO_STUB:-0}
    PERF_OFF="${PERF_OFF:-}" EXPO_PUBLIC_PERF_OFF="${PERF_OFF:-}" PERF_FAST="${PERF_FAST:-}" EXPO_PUBLIC_PERF_BENCH="${BENCH:-0}" POLISH_SCENE="${POLISH_SCENE:-0}")
fi
env "${ENVV[@]}" npx expo export:embed --platform ios --dev false --minify ${MINIFY:-false} --entry-file index.ts \
  --bundle-output "$WORK/main.js" --assets-dest "$WORK/NeonSign.app" ${RESET:+--reset-cache} >"$WORK/export.log" 2>&1 \
  || { tail -30 "$WORK/export.log"; exit 1; }
node_modules/hermes-compiler/hermesc/osx-bin/hermesc -emit-binary -O -out "$WORK/NeonSign.app/main.jsbundle" "$WORK/main.js" -w
codesign -f -s - --deep "$WORK/NeonSign.app" >/dev/null 2>&1
xcrun simctl terminate "$UDID" dev.hoanghoa.neonsign 2>/dev/null || true
xcrun simctl install "$UDID" "$WORK/NeonSign.app"
curl -s -X POST --data "RUN ${LABEL:-embed} off=${PERF_OFF:-none} fast=${PERF_FAST:-none} load=$(sysctl -n vm.loadavg | awk '{print $2}')" "http://localhost:$SINK_PORT" || true
xcrun simctl launch "$UDID" dev.hoanghoa.neonsign >/dev/null
rm -f "$WORK/main.js"
echo "launched on $UDID (work dir $WORK)"
