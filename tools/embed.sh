#!/bin/bash
# embed.sh: copy the built Release app, replace main.jsbundle with the current JS bundle (no native build), install on the sim.
#   UDID=<sim> [TS=0.5] [DEMO=1] tools/embed.sh
# Use when only JS/TS/SkSL changed. Native changes (app.json, new modules) need a rebuild with expo run:ios --configuration Release.
set -euo pipefail
cd "$(dirname "$0")/../app"
UDID=${UDID:?set UDID}
SRC=${SRC:-$(ls -d ~/Library/Developer/Xcode/DerivedData/NeonSign-*/Build/Products/Release-iphonesimulator/NeonSign.app | head -1)}
WORK=${WORK:-$(cd .. && pwd)/render/embed}
rm -rf "$WORK"; mkdir -p "$WORK"; cp -R "$SRC" "$WORK/"
APPD="$WORK/NeonSign.app"
EXPO_PUBLIC_DEMO=${DEMO:-1} EXPO_PUBLIC_TIMESCALE=${TS:-0.5} npx expo export:embed --platform ios --dev false --minify true \
  --entry-file index.ts --bundle-output "$APPD/main.jsbundle" --assets-dest "$APPD" >/dev/null
xcrun simctl install "$UDID" "$APPD"
echo "installed $APPD (DEMO=${DEMO:-1} TS=${TS:-0.5})"
