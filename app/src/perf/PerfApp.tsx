import React from "react";
import { View } from "react-native";
// The real App (resolved by path, so the Metro redirect of "./App" in tools/perf/metro.config.js does not loop).
import App from "../../App";
import { PerfOverlay } from "./PerfOverlay";
import { Bench } from "./Bench";

/**
 * Root used only by the perf Metro (tools/perf/metro.config.js): the app plus the FPS overlay on top,
 * or the GPU layer benchmark with EXPO_PUBLIC_PERF_BENCH=1.
 */
export default function PerfApp() {
  if (process.env.EXPO_PUBLIC_PERF_BENCH === "1") return <Bench />;
  return (
    <View style={{ flex: 1 }}>
      <App />
      <PerfOverlay />
    </View>
  );
}
