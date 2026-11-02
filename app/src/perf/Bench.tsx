import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import {
  BlendMode,
  BlurStyle,
  FilterMode,
  MipmapMode,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  processUniforms,
  useImage,
  type SkCanvas,
  type SkImage,
  type SkRuntimeEffect,
  type SkShader,
  type SkSurface,
} from "react-native-skia";
import { wall } from "../shaders/wall";
import { grade, steam } from "../shaders/post";
import { wall as wallFast } from "./variants/wallFast";
import { steam as steamFast } from "./variants/postFast";
import { HORIZON, REFL_K, VIEW } from "../scene/layout";
import { SLOTS, makeTube, type Tube } from "../neon/model";
import { A_K, A_TILE, B_K, B_TILE, renderAtlas } from "../neon/atlas";
import { NEON, NEON_LIN, coreColor } from "../neon/palette";
import { DEMO as SCRIPT } from "../demo/script";

/**
 * GPU micro-benchmark (EXPO_PUBLIC_PERF_BENCH=1): draws each scene layer into a 1320×2868 offscreen surface (same
 * pixels as the iPhone 17 Pro Max canvas, 3× of the 440×956 pt design frame) and times `flush(true)`, which waits for
 * the GPU. Cases run round-robin so background load (other simulators, Blender) hits every case alike; the median per
 * case is what to compare. Results → screen + perf sink ("BENCH" lines).
 */

const SCALE = 3;
const W = Math.round(VIEW.w * SCALE);
const H = Math.round(VIEW.h * SCALE);
const ROUNDS = 6;
const ITERS = 6;

const sceneAssets = {
  ambient: require("../../assets/scene/ambient.jpg"),
  albedo: require("../../assets/scene/albedo.jpg"),
  normal: require("../../assets/scene/normal.png"),
  data: require("../../assets/scene/data.png"),
};

const SINK = process.env.EXPO_PUBLIC_PERF_SINK;
const post = (s: string) => {
  console.log(s);
  if (SINK) fetch(SINK, { method: "POST", body: s }).catch(() => {});
};

const lin = (img: SkImage) => img.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);

type Case = { name: string; draw: (c: SkCanvas) => void };

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** Lit-unit drawing as in Tube.tsx UnitLit: glow σ18, glow σ6, colour layer, core, all `plus`. */
const strokePaint = () => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeCap(StrokeCap.Round);
  p.setStrokeJoin(StrokeJoin.Round);
  return p;
};
const drawUnitLit = (c: SkCanvas, tubes: Tube[], bright: number) => {
  for (const t of tubes) {
    const w = t.width;
    const hex = NEON[t.color].hex;
    for (const u of t.units) {
      const layer = (width: number, alpha: number, sigma: number, col: string) => {
        const p = strokePaint();
        p.setBlendMode(BlendMode.Plus);
        p.setColor(Skia.Color(col));
        p.setAlphaf(alpha * bright);
        p.setStrokeWidth(width);
        if (sigma > 0) p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, true));
        c.drawPath(u.path, p);
      };
      layer(w * 2.4, 0.55, 18, hex);
      layer(w * 1.5, 0.6, 6, hex);
      layer(w * 0.95, 0.7, 0, hex);
      layer(w * 0.3, 1, 0, coreColor(hex));
    }
  }
};

/** Glass + shadow as in Tube.tsx (inner blur on the dark rim, σ2.6 shadow). */
const drawGlass = (c: SkCanvas, tubes: Tube[]) => {
  for (const t of tubes) {
    const w = t.width;
    const sh = strokePaint();
    sh.setColor(Skia.Color("rgba(0,0,0,0.55)"));
    sh.setStrokeWidth(w * 1.1);
    sh.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 2.6, true));
    c.save();
    c.translate(2.2, 3.4);
    c.drawPath(t.path, sh);
    c.restore();
    const body = strokePaint();
    body.setColor(Skia.Color("rgba(150,148,165,0.34)"));
    body.setStrokeWidth(w);
    c.drawPath(t.path, body);
    const rim = strokePaint();
    rim.setColor(Skia.Color("rgba(5,5,10,0.75)"));
    rim.setStrokeWidth(w);
    rim.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Inner, w * 0.22, true));
    c.drawPath(t.path, rim);
    const hl = strokePaint();
    hl.setColor(Skia.Color("rgba(214,228,255,0.62)"));
    hl.setStrokeWidth(w * 0.2);
    c.drawPath(t.path, hl);
  }
};

/**
 * Proposed: glow (σ18 + σ6 layers) of each unit pre-rendered ONCE (white, ½ px density) → per frame one image draw
 * per unit, tinted by a colour filter, alpha = brightness, blend plus. Only the sharp colour layer + core stay paths.
 */
type Cached = { img: SkImage; x: number; y: number; w: number; h: number; hex: string };
const GLOW_K = 1.5; // px per pt of the cached glow (canvas is 3 px/pt)
const cacheGlow = (tubes: Tube[]): Cached[] => {
  const out: Cached[] = [];
  for (const t of tubes) {
    for (const u of t.units) {
      const b = u.path.computeTightBounds();
      const pad = 18 * 3 + t.width * 1.2;
      const x = b.x - pad, y = b.y - pad, w = b.width + pad * 2, h = b.height + pad * 2;
      const s = Skia.Surface.MakeOffscreen(Math.ceil(w * GLOW_K), Math.ceil(h * GLOW_K))!;
      const c = s.getCanvas();
      c.clear(Skia.Color("transparent"));
      c.scale(GLOW_K, GLOW_K);
      c.translate(-x, -y);
      const layer = (width: number, alpha: number, sigma: number) => {
        const p = strokePaint();
        p.setBlendMode(BlendMode.Plus);
        p.setColor(Skia.Color("white"));
        p.setAlphaf(alpha);
        p.setStrokeWidth(width);
        p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, true));
        c.drawPath(u.path, p);
      };
      layer(t.width * 2.4, 0.55, 18);
      layer(t.width * 1.5, 0.6, 6);
      s.flush(true);
      out.push({ img: s.makeImageSnapshot(), x, y, w, h, hex: NEON[t.color].hex });
    }
  }
  return out;
};
const drawGlowCached = (c: SkCanvas, tubes: Tube[], cached: Cached[], bright: number) => {
  const p = Skia.Paint();
  p.setBlendMode(BlendMode.Plus);
  for (const g of cached) {
    p.setColorFilter(Skia.ColorFilter.MakeBlend(Skia.Color(g.hex), BlendMode.SrcIn));
    p.setAlphaf(bright);
    c.drawImageRect(g.img, Skia.XYWHRect(0, 0, g.img.width(), g.img.height()), Skia.XYWHRect(g.x, g.y, g.w, g.h), p);
  }
  // sharp colour layer + core still drawn as paths (cheap: no mask filter)
  const q = strokePaint();
  q.setBlendMode(BlendMode.Plus);
  for (const t of tubes) {
    const hex = NEON[t.color].hex;
    for (const u of t.units) {
      q.setColor(Skia.Color(hex));
      q.setAlphaf(0.7 * bright);
      q.setStrokeWidth(t.width * 0.95);
      c.drawPath(u.path, q);
      q.setColor(Skia.Color(coreColor(hex)));
      q.setAlphaf(bright);
      q.setStrokeWidth(t.width * 0.3);
      c.drawPath(u.path, q);
    }
  }
};

/** Proposed TubeShadow/TubeGlass after the freeze: baked shadow (2 px/pt) + body/rim (3 px/pt) + live highlight. */
const bakeImg = (path: ReturnType<typeof Skia.Path.Make>, pad: number, k: number, draw: (c: SkCanvas) => void) => {
  const b = path.computeTightBounds();
  const r = Skia.XYWHRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
  const s = Skia.Surface.MakeRaster(Math.ceil(r.width * k), Math.ceil(r.height * k))!;
  const c = s.getCanvas();
  c.scale(k, k);
  c.translate(-r.x, -r.y);
  draw(c);
  return { img: s.makeImageSnapshot(), r };
};
const glassBaked = (tubes: Tube[]) => {
  const items = tubes.flatMap((t) => {
    const w = t.width;
    const sh = bakeImg(t.path, 12, 2, (c) => {
      const p = strokePaint();
      p.setColor(Skia.Color("rgba(0,0,0,0.55)"));
      p.setStrokeWidth(w * 1.1);
      p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 2.6, true));
      c.drawPath(t.path, p);
    });
    const gl = bakeImg(t.path, w, 3, (c) => {
      const body = strokePaint();
      body.setColor(Skia.Color("rgba(150,148,165,0.34)"));
      body.setStrokeWidth(w);
      c.drawPath(t.path, body);
      const rim = strokePaint();
      rim.setColor(Skia.Color("rgba(5,5,10,0.75)"));
      rim.setStrokeWidth(w);
      rim.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Inner, w * 0.22, true));
      c.drawPath(t.path, rim);
    });
    return [{ ...sh, dx: 2.2, dy: 3.4, t }, { ...gl, dx: 0, dy: 0, t }];
  });
  const ip = Skia.Paint();
  return (c: SkCanvas) => {
    for (const it of items) {
      c.drawImageRect(it.img, Skia.XYWHRect(0, 0, it.img.width(), it.img.height()), Skia.XYWHRect(it.r.x + it.dx, it.r.y + it.dy, it.r.width, it.r.height), ip);
    }
    for (const t of tubes) {
      const hl = strokePaint();
      hl.setColor(Skia.Color("rgba(214,228,255,0.62)"));
      hl.setStrokeWidth(t.width * 0.2);
      c.drawPath(t.path, hl);
    }
  };
};

/** Live "chalk" trail while writing (NeonScene): blurred stroke + tip vs two plain low-alpha strokes. */
const liveTrail = (path: ReturnType<typeof Skia.Path.Make>, blur: boolean) => (c: SkCanvas) => {
  const a = strokePaint();
  a.setBlendMode(BlendMode.Plus);
  a.setColor(Skia.Color(blur ? "rgba(255,226,244,0.32)" : "rgba(255,226,244,0.12)"));
  a.setStrokeWidth(blur ? 9.1 : 14);
  if (blur) a.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 5, true));
  c.drawPath(path, a);
  if (!blur) {
    a.setColor(Skia.Color("rgba(255,226,244,0.2)"));
    a.setStrokeWidth(7);
    c.drawPath(path, a);
  }
  const t = strokePaint();
  t.setBlendMode(BlendMode.Plus);
  t.setColor(Skia.Color("rgba(255,240,250,0.55)"));
  t.setStrokeWidth(1.6);
  c.drawPath(path, t);
};

/** Full-screen shader pass, optionally at a lower pixel density and upscaled (bilinear) into the canvas. */
const fill = (effect: SkRuntimeEffect, u: Record<string, unknown>, children: SkShader[], blend?: BlendMode) => {
  const uniforms = processUniforms(effect, u as never);
  const shader = effect.makeShaderWithChildren(uniforms, children);
  const p = Skia.Paint();
  p.setShader(shader);
  if (blend !== undefined) p.setBlendMode(blend);
  return (c: SkCanvas) => c.drawPaint(p);
};
const lowRes = (draw: (c: SkCanvas) => void, k: number, blend: BlendMode) => {
  const s = Skia.Surface.MakeOffscreen(Math.ceil(VIEW.w * k), Math.ceil(VIEW.h * k))!;
  const p = Skia.Paint();
  p.setBlendMode(blend);
  return (c: SkCanvas) => {
    const lc = s.getCanvas();
    lc.save();
    lc.scale(k, k);
    draw(lc);
    lc.restore();
    s.flush();
    const img = s.makeImageSnapshot();
    c.drawImageRect(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(0, 0, VIEW.w, VIEW.h), p);
  };
};

export function Bench() {
  const ambient = useImage(sceneAssets.ambient);
  const albedo = useImage(sceneAssets.albedo);
  const normal = useImage(sceneAssets.normal);
  const data = useImage(sceneAssets.data);
  const [lines, setLines] = useState<string[]>(["loading…"]);

  useEffect(() => {
    if (!ambient || !albedo || !normal || !data) return;
    const run = () => {
      const tubes = SCRIPT.strokes
        .map((s) => makeTube(s.pts, s.color, s.width, 0, s.splits, true))
        .filter((t): t is Tube => !!t);
      // recolour as at the end of the demo (tube 1 red, tube 0 cyan)
      tubes[0] = { ...tubes[0], color: 1, prev: 1 };
      if (tubes[1]) tubes[1] = { ...tubes[1], color: 5, prev: 5 };
      const atlas = renderAtlas(tubes);
      const lit = new Array(SLOTS).fill(0);
      const col = new Array(SLOTS * 3).fill(0);
      tubes.forEach((t) =>
        t.units.forEach((u) => {
          lit[u.k] = 1;
          for (let j = 0; j < 3; j++) col[u.k * 3 + j] = NEON_LIN[t.color][j];
        }),
      );
      const off = new Array(SLOTS).fill(0);
      const imgK = ambient.width() / VIEW.w;
      const wallU = (bright: number[]) => ({
        bright, col, view: [VIEW.w, VIEW.h], aTile: A_TILE, aK: A_K, imgK, bTile: B_TILE, bK: B_K,
        horizon: HORIZON, reflK: REFL_K, time: 3.3, gain: 3.2, relief: 0.9, tilt: [0.1, 0.05], bolt: 0,
      });
      const steamU = { bright: lit, col, view: [VIEW.w, VIEW.h], aTile: A_TILE, aK: A_K, horizon: HORIZON, time: 3.3, haze: 0.05, density: 1.0 };
      const wallKids = [lin(ambient), lin(albedo), lin(normal), lin(data), lin(atlas.a), lin(atlas.b)];
      const cached = cacheGlow(tubes);

      const wallLit = fill(wall, wallU(lit), wallKids);
      const wallLitFast = fill(wallFast, wallU(lit), wallKids);
      const wallOff = fill(wall, wallU(off), wallKids);
      const steamP = fill(steam, steamU, [lin(atlas.a)], BlendMode.Plus);
      const steamFastP = fill(steamFast, steamU, [lin(atlas.a)], BlendMode.Plus);
      const gradeP = fill(grade, { view: [VIEW.w, VIEW.h], time: 3.3 }, [], BlendMode.Multiply);
      const steamHalf = lowRes(steamP, 1.5, BlendMode.Plus);
      const steamFastHalf = lowRes(steamFastP, 1.5, BlendMode.Plus);
      const glass = (c: SkCanvas) => drawGlass(c, tubes);
      const glow = (c: SkCanvas) => drawUnitLit(c, tubes, 1);
      const glowC = (c: SkCanvas) => drawGlowCached(c, tubes, cached, 1);
      const glassB = glassBaked(tubes);
      const trailB = liveTrail(tubes[0].path, true);
      const trailP = liveTrail(tubes[0].path, false);

      const cases: Case[] = [
        { name: "clear only", draw: () => {} },
        { name: "wall lit", draw: wallLit },
        { name: "wall lit FAST", draw: wallLitFast },
        { name: "wall off", draw: wallOff },
        { name: "steam", draw: steamP },
        { name: "steam FAST", draw: steamFastP },
        { name: "steam @1.5x", draw: steamHalf },
        { name: "steamFAST @1.5x", draw: steamFastHalf },
        { name: "grade", draw: gradeP },
        { name: "glass+shadow", draw: glass },
        { name: "glow (UnitLit)", draw: glow },
        { name: "glow cached img", draw: glowC },
        { name: "glass baked", draw: glassB },
        { name: "trail blur", draw: trailB },
        { name: "trail plain", draw: trailP },
        {
          name: "FRAME now",
          draw: (c) => (wallLit(c), glass(c), glow(c), steamP(c), gradeP(c)),
        },
        {
          name: "FRAME proposed",
          draw: (c) => (wallLitFast(c), glassB(c), glowC(c), steamFastP(c), gradeP(c)),
        },
      ];

      const surf: SkSurface = Skia.Surface.MakeOffscreen(W, H)!;
      const times: Record<string, number[]> = {};
      const once = (cs: Case) => {
        const c = surf.getCanvas();
        const t0 = performance.now();
        c.clear(Skia.Color("black"));
        c.save();
        c.scale(SCALE, SCALE);
        cs.draw(c);
        c.restore();
        surf.flush(true);
        return performance.now() - t0;
      };
      for (const cs of cases) for (let i = 0; i < 2; i++) once(cs); // warm-up: pipeline compile
      for (let r = 0; r < ROUNDS; r++) {
        for (const cs of cases) {
          for (let i = 0; i < ITERS; i++) (times[cs.name] ??= []).push(once(cs));
        }
      }
      const base = median(times["clear only"]);
      const out = cases.map((cs) => {
        const m = median(times[cs.name]);
        return `BENCH ${cs.name.padEnd(17)} ${m.toFixed(2).padStart(6)} ms  (−clear ${(m - base).toFixed(2).padStart(6)})  min ${Math.min(...times[cs.name]).toFixed(2)}`;
      });
      out.unshift(`BENCH ${W}x${H} rounds=${ROUNDS}x${ITERS} units=${tubes.reduce((n, t) => n + t.units.length, 0)}`);
      out.forEach(post);
      setLines(out);
    };
    // let the first frame paint before blocking the JS thread
    const id = setTimeout(() => {
      try {
        run();
      } catch (e) {
        post(`BENCH error ${String(e)}`);
        setLines([String(e)]);
      }
    }, 800);
    return () => clearTimeout(id);
  }, [ambient, albedo, normal, data]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: 70, paddingHorizontal: 12 }}>
      {lines.map((l, i) => (
        <Text key={i} style={styles.t}>
          {l}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#07060b" },
  t: { color: "#9dff3f", fontFamily: "Menlo", fontSize: 10, marginBottom: 3 },
});
