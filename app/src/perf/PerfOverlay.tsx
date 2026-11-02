import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { useAnimatedProps, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

/**
 * FPS / frame-time overlay, enabled with EXPO_PUBLIC_PERF=1 (see tools/perf/README in notes/perf.md).
 *  - UI thread: Reanimated frame callback deltas (this is the thread that drives Skia redraws), fps over 0.5 s,
 *    worst frame, dropped-frame count (> 1.5 × the display interval).
 *  - JS thread: requestAnimationFrame deltas (React commits, atlas re-render, image decode land here).
 *  - Logs to Metro: one `PERF` line per second + one `HITCH` line per long frame, plus a cumulative summary every
 *    5 s (p50/p95/p99, drop %), so a whole demo run can be read back from the Metro log without screenshots.
 * Text is driven by animatedProps on a TextInput, so the overlay itself never re-renders React on the UI path.
 */

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

type Acc = {
  t0: number; // first frame timestamp (ms)
  winStart: number;
  n: number;
  worst: number;
  drops: number;
  interval: number; // estimated display interval (ms)
  hist: number[]; // cumulative frame-time histogram, 0.5 ms buckets up to 100 ms
  total: number;
  totalDrops: number;
  lastLog: number;
  lastSummary: number;
  minSeen: number;
};

const BUCKETS = 200;

const pct = (hist: number[], total: number, p: number) => {
  "worklet";
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= total * p) return i * 0.5;
  }
  return 100;
};

/** EXPO_PUBLIC_PERF_SINK (e.g. http://localhost:8097): production bundles don't forward console.log to Metro,
 *  so lines are also batched and POSTed to tools/perf/sink.py once a second. */
const SINK = process.env.EXPO_PUBLIC_PERF_SINK;
let pending: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const flush = () => {
  flushTimer = null;
  if (!SINK || !pending.length) return;
  const body = pending.join("\n");
  pending = [];
  fetch(SINK, { method: "POST", body }).catch(() => {});
};
const logLine = (s: string) => {
  console.log(s);
  if (!SINK) return;
  pending.push(s);
  if (!flushTimer) flushTimer = setTimeout(flush, 1000);
};

export function PerfOverlay() {
  const acc = useSharedValue<Acc>({
    t0: -1,
    winStart: -1,
    n: 0,
    worst: 0,
    drops: 0,
    interval: 16.67,
    hist: new Array(BUCKETS).fill(0),
    total: 0,
    totalDrops: 0,
    lastLog: 0,
    lastSummary: 0,
    minSeen: 1000,
  });
  const label = useSharedValue("UI --");
  const [js, setJs] = useState({ fps: 0, worst: 0 });
  useEffect(() => logLine(`START ${new Date().toISOString()}`), []);

  useFrameCallback(({ timestamp, timeSincePreviousFrame }) => {
    "worklet";
    const a = acc.value;
    if (a.t0 < 0) {
      a.t0 = timestamp;
      a.winStart = timestamp;
      a.lastLog = timestamp;
      a.lastSummary = timestamp;
      return;
    }
    const dt = timeSincePreviousFrame ?? 0;
    if (dt <= 0) return;
    // display interval: smallest delta seen (sim ≈ 16.7 ms at 60 Hz, ProMotion ≈ 8.3 ms)
    if (dt < a.minSeen && dt > 4) {
      a.minSeen = dt;
      a.interval = dt < 11 ? 8.33 : 16.67;
    }
    a.n++;
    a.total++;
    if (dt > a.worst) a.worst = dt;
    const dropped = dt > a.interval * 1.5;
    if (dropped) {
      a.drops++;
      a.totalDrops += Math.round(dt / a.interval) - 1;
    }
    a.hist[Math.min(BUCKETS - 1, Math.floor(dt * 2))]++;
    const since = (timestamp - a.t0) / 1000;
    if (dt > a.interval * 2.5) scheduleOnRN(logLine, `HITCH t=${since.toFixed(2)}s dt=${dt.toFixed(1)}ms`);

    if (timestamp - a.winStart >= 500) {
      const fps = (a.n * 1000) / (timestamp - a.winStart);
      label.value = `UI ${fps.toFixed(0)}fps  max ${a.worst.toFixed(1)}ms  drop ${a.drops}  t ${since.toFixed(1)}`;
      if (timestamp - a.lastLog >= 1000) {
        a.lastLog = timestamp;
        scheduleOnRN(logLine, `PERF t=${since.toFixed(1)}s ui=${fps.toFixed(1)}fps max=${a.worst.toFixed(1)}ms drops=${a.drops}`);
      }
      a.winStart = timestamp;
      a.n = 0;
      a.worst = 0;
      a.drops = 0;
    }
    if (timestamp - a.lastSummary >= 5000) {
      a.lastSummary = timestamp;
      const expected = Math.round((timestamp - a.t0) / a.interval);
      scheduleOnRN(
        logLine,
        `SUMMARY t=${since.toFixed(1)}s frames=${a.total}/${expected} p50=${pct(a.hist, a.total, 0.5)} p95=${pct(a.hist, a.total, 0.95)} p99=${pct(a.hist, a.total, 0.99)}ms missed=${a.totalDrops} (${((a.totalDrops / Math.max(1, expected)) * 100).toFixed(1)}%) hz=${(1000 / a.interval).toFixed(0)}`,
      );
    }
  });

  // JS thread: rAF loop
  useEffect(() => {
    let raf = 0, last = 0, start = 0, n = 0, worst = 0;
    const loop = (ts: number) => {
      if (last > 0) {
        const dt = ts - last;
        n++;
        if (dt > worst) worst = dt;
        if (dt > 50) logLine(`JSHITCH dt=${dt.toFixed(0)}ms`);
        if (ts - start >= 1000) {
          const fps = (n * 1000) / (ts - start);
          setJs({ fps, worst });
          logLine(`PERFJS fps=${fps.toFixed(1)} max=${worst.toFixed(1)}ms`);
          start = ts;
          n = 0;
          worst = 0;
        }
      } else start = ts;
      last = ts;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const props = useAnimatedProps(() => ({ text: label.value, defaultValue: label.value }) as object);

  return (
    <View pointerEvents="none" style={styles.box}>
      <AnimatedInput editable={false} underlineColorAndroid="transparent" style={styles.text} animatedProps={props} />
      <Text style={styles.text}>{`JS ${js.fps.toFixed(0)}fps  max ${js.worst.toFixed(1)}ms`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: "absolute",
    top: 64,
    left: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  text: { color: "#9dff3f", fontSize: 11, fontFamily: "Menlo", padding: 0, margin: 0 },
});
