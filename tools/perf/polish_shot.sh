#!/usr/bin/env bash
# Before/after stills for the POLISH agent: build the plain app (JS swap into the Release .app, tools/perf/embed.sh),
# launch it and screenshot at the given seconds after launch → notes/polish/<label>_<s>.jpg (JPEG q80, full res).
#   tools/perf/polish_shot.sh before 3 7 9.9 11 15
# Seconds count from the first drawn frame (scene clock t ≈ 0), so the same seconds give the same moments between runs.
set -eo pipefail
cd "$(dirname "$0")/../.."
LABEL=$1; shift
UDID=${UDID:-56C2D726-BF2E-4533-B86C-CDA80C028906}
OUT=notes/polish
mkdir -p "$OUT"
[[ "${NOBUILD:-0}" == "1" ]] || PLAIN=1 WORK=${WORK:-${TMPDIR:-/tmp}/neon-polish-plain} tools/perf/embed.sh >/dev/null
xcrun simctl terminate "$UDID" dev.hoanghoa.neonsign 2>/dev/null || true
xcrun simctl launch "$UDID" dev.hoanghoa.neonsign >/dev/null
# T0 = first frame where the scene is drawn (mean luma > 12), not the launch: a fresh install decodes images slower
for _ in $(seq 60); do
  xcrun simctl io "$UDID" screenshot --type=jpeg "$OUT/.probe.jpg" >/dev/null 2>&1
  Y=$(ffmpeg -i "$OUT/.probe.jpg" -vf "scale=64:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - 2>/dev/null | sed -n 's/.*YAVG=//p' | head -1)
  python3 -c "import sys; sys.exit(0 if float('${Y:-0}') > 12 else 1)" && break
done
rm -f "$OUT/.probe.jpg"
T0=$(python3 -c "import time; print(time.time() - ${PROBE_LAG:-0.3})")
for s in "$@"; do
  python3 -c "import time; time.sleep(max(0, $T0 + $s - time.time()))"
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/.tmp_$s.png" >/dev/null 2>&1
done
for s in "$@"; do
  sips -s format jpeg -s formatOptions 80 "$OUT/.tmp_$s.png" --out "$OUT/${LABEL}_$s.jpg" >/dev/null && rm -f "$OUT/.tmp_$s.png"
done
echo "$OUT/${LABEL}_*.jpg"
