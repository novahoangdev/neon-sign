#!/usr/bin/env python3
"""Summarise the last run (or the run with the given label) of render/perf/perf.log.
   python3 tools/perf/report.py render/perf/perf.log [label]"""
import re, sys
lines = open(sys.argv[1]).read().splitlines()
label = sys.argv[2] if len(sys.argv) > 2 else None
starts = [i for i, l in enumerate(lines) if " RUN " in l and (label is None or f"RUN {label} " in l)]
i0 = starts[-1] if starts else 0
nxt = [i for i, l in enumerate(lines) if " RUN " in l and i > i0]
run = lines[i0:(nxt[0] if nxt else len(lines))]
# keep only the last app launch inside the run
st = [i for i, l in enumerate(run) if " START " in l]
head = run[0] if run and " RUN " in run[0] else ""
run = run[st[-1]:] if st else run
def win(a, b):
    f, d, mx = [], 0, 0.0
    for l in run:
        m = re.search(r"PERF t=([\d.]+)s ui=([\d.]+)fps max=([\d.]+)ms drops=(\d+)", l)
        if m and a <= float(m[1]) < b:
            f.append(float(m[2])); d += int(m[4]); mx = max(mx, float(m[3]))
    return (sum(f) / len(f) if f else 0, min(f) if f else 0, d, mx, len(f))
hitch = [l for l in run if "JSHITCH" in l]
print(head.split(" ", 1)[-1] if head else "(no RUN marker)")
for name, a, b in (("demo  0-16s", 0, 16), ("steady 18s+", 18, 1e9)):
    avg, lo, d, mx, n = win(a, b)
    print(f"  {name}: avg {avg:5.1f} fps  min {lo:5.1f}  drops {d:3d}  worst {mx:5.1f} ms  ({n} s)")
worst = max((int(re.search(r"dt=(\d+)", h)[1]) for h in hitch), default=0)
print(f"  JS hitches >50ms: {len(hitch)}  worst {worst} ms")
