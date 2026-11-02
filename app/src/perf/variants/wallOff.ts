import { Skia } from "react-native-skia";
export { ATLAS_SKSL, atlasFn } from "../../shaders/wall";
/** PERF_OFF=wall: same children, ambient image only (measures the cost of the lit wall + puddle shader). */
export const wall = Skia.RuntimeEffect.Make(`
uniform shader ambient; uniform shader albedo; uniform shader normalMap; uniform shader dataMap; uniform shader lightA; uniform shader lightB;
uniform float imgK;
half4 main(float2 p) { return half4(ambient.eval(p * imgK).rgb, 1.0); }`)!;
