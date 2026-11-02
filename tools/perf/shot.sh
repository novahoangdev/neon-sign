#!/usr/bin/env bash
# Launch the demo through the perf Metro and screenshot the perf sim at given seconds after the overlay START line.
#   PERF_FAST=tube tools/perf/shot.sh <label> 8 12 25      → render/perf/shots/<label>_<s>.png
set -eo pipefail
cd "$(dirname "$0")/../.."
LABEL=$1; shift
UDID=${UDID:-56C2D726-BF2E-4533-B86C-CDA80C028906}
mkdir -p render/perf/shots
N0=$(grep -c " START " render/perf/perf.log 2>/dev/null || echo 0)
curl -s -X POST --data "RUN $LABEL off=${PERF_OFF:-none} fast=${PERF_FAST:-none}" "http://localhost:$(( ${PORT:-8102} + 1 ))" || true
tools/perf/start.sh >/dev/null
until [[ $(grep -c " START " render/perf/perf.log) -gt $N0 ]]; do sleep 0.5; done
T0=$(python3 -c "import time; print(time.time())")
for s in "$@"; do
  python3 -c "import time; time.sleep(max(0, $T0 + $s - time.time()))"
  xcrun simctl io "$UDID" screenshot "render/perf/shots/${LABEL}_$s.png" >/dev/null 2>&1
done
echo "shots: render/perf/shots/${LABEL}_*.png"
python3 tools/perf/report.py render/perf/perf.log "$LABEL"
