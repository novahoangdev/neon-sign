/** Neon colours (PLAN section 1). The tube core is always near-white; the colour lives in the glow layer. */
export const NEON = [
  { name: "pink", hex: "#ff3fa4" },
  { name: "cyan", hex: "#3fe8ff" },
  { name: "amber", hex: "#ffb13f" },
  { name: "lime", hex: "#9dff3f" },
  { name: "violet", hex: "#a35bff" },
  { name: "red", hex: "#ff3b3b" },
  { name: "warm", hex: "#fff1d6" },
] as const;

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** Linear colours (for the lighting shader). */
export const NEON_LIN: [number, number, number][] = NEON.map(({ hex }) => {
  const n = parseInt(hex.slice(1), 16);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
});

/**
 * Gas type by colour (as on real signs): red/orange = pure neon gas (clear tube, red-orange light, "snappy" strike and fully on at once);
 * the other colours = argon + mercury vapour, coloured by the phosphor powder coating inside the tube → weak strike, longer
 * flicker, then warming up over a few seconds as the mercury vaporises. 0 = neon, 1 = argon.
 */
export const GAS: number[] = NEON.map((n) => (n.name === "red" ? 0 : 1));

/** Core colour: white mixed with a touch of the neon colour. */
export const coreColor = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const mixc = (c: number) => Math.round(255 * 0.7 + c * 0.3);
  return `rgb(${mixc((n >> 16) & 255)}, ${mixc((n >> 8) & 255)}, ${mixc(n & 255)})`;
};

/** sRGB colour 0..1 (for the LiveTrail chalk trail in the selected colour). */
export const NEON_RGB: [number, number, number][] = NEON.map(({ hex }) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
});
