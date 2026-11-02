#!/usr/bin/env bash
# One measured demo run on the perf simulator: tools/perf/measure.sh <label> [seconds=70]
#   PERF_OFF=steam,wall,… to swap layers out (see tools/perf/metro.config.js); other env passes to start.sh.
# Appends "RUN <label>" to render/perf/perf.log, runs the demo, then prints fps for the demo (t<16 s) and the
# steady lit sign (t>18 s) from the overlay's PERF lines (tools/perf/report.py).
set -eo pipefail
cd "$(dirname "$0")/../.."
LABEL=${1:-run}
SECS=${2:-70}
PORT=${PORT:-8102}
curl -s -X POST --data "RUN $LABEL off=${PERF_OFF:-none} load=$(sysctl -n vm.loadavg | awk '{print $2}')" "http://localhost:$((PORT + 1))" || true
tools/perf/start.sh >/dev/null
sleep "$SECS"
python3 tools/perf/report.py render/perf/perf.log "$LABEL"
