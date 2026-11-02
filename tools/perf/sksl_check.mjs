// Compile every SkSL runtime effect of app/src/shaders with CanvasKit (no device needed):
//   node tools/perf/sksl_check.mjs   → "ok <name>" or the compiler error with line numbers.
// The .ts files are evaluated with a tiny shim: `Skia.RuntimeEffect.Make(src)` records the source instead.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const here = path.dirname(new URL(import.meta.url).pathname);
const app = path.resolve(here, "../../app");
const require = createRequire(path.join(app, "package.json"));
const CanvasKitInit = require("canvaskit-wasm/bin/full/canvaskit.js");
const CK = await CanvasKitInit({ locateFile: (f) => path.join(app, "node_modules/canvaskit-wasm/bin/full", f) });
const ts = require("typescript");
const mods = {};
const load = (rel) => {
  if (mods[rel]) return mods[rel];
  const file = path.join(app, "src/shaders", rel + ".ts");
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: 99 } }).outputText;
  const exp = {};
  const effects = [];
  const fakeReq = (m) => {
    if (m === "react-native-skia") return { Skia: { RuntimeEffect: { Make: (src) => (effects.push(src), { src }) } } };
    if (m.startsWith("./")) return load(m.slice(2));
    throw new Error("unexpected import " + m);
  };
  new Function("exports", "require", js)(exp, fakeReq);
  mods[rel] = exp;
  return exp;
};
let bad = 0;
for (const f of fs.readdirSync(path.join(app, "src/shaders")).filter((f) => f.endsWith(".ts"))) {
  const exp = load(f.replace(/\.ts$/, ""));
  for (const [name, v] of Object.entries(exp)) {
    if (!v || typeof v.src !== "string") continue;
    let err = "";
    const fx = CK.RuntimeEffect.Make(v.src, (e) => (err = e));
    if (fx) console.log(`ok   ${f}:${name}`);
    else {
      bad++;
      console.log(`FAIL ${f}:${name}\n${err}`);
    }
  }
}
process.exit(bad ? 1 : 0);
