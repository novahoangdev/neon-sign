import { Skia } from "react-native-skia";
import * as real from "../../shaders/post";
const off = process.env.EXPO_PUBLIC_PERF_OFF ?? "";
/** PERF_OFF=steam / grade: trivial shaders with the same children (measures the full-screen post passes). */
export const steam = off.includes("steam")
  ? Skia.RuntimeEffect.Make(`uniform shader lightA; half4 main(float2 p) { return half4(0.0, 0.0, 0.0, 1.0); }`)!
  : real.steam;
export const grade = off.includes("grade") ? Skia.RuntimeEffect.Make(`half4 main(float2 p) { return half4(1.0); }`)! : real.grade;
