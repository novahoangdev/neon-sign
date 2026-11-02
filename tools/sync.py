#!/usr/bin/env python3
"""Find the frame where the neon first flashes after flipping the switch: read "t y" (seconds, mean brightness) from stdin, print "t jump".
On the flip every tube flashes together for one short beat (app: FIRST_FLASH in flicker.ts) → brightness jumps relative to just before.
Take the FIRST frame (from second t0 on) whose jump is ≥ 55 % of the largest jump, so it isn't confused with the full light-up later."""
import sys
t0 = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
rows = [tuple(map(float, l.split())) for l in sys.stdin if l.strip()]
ts = [r[0] for r in rows]; ys = [r[1] for r in rows]
jumps = []
for i in range(3, len(rows)):
    if ts[i] < t0:
        continue
    jumps.append((ts[i], ys[i] - min(ys[i - 3:i])))
if not jumps:
    print("0 0"); sys.exit(0)
top = max(j for _, j in jumps)
for t, j in jumps:
    if j >= 0.55 * top:
        print(f"{t:.3f} {j:.1f}")
        break
