import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NEON } from "../neon/palette";

export const PALETTE = { left: 16, bottom: 44, size: 28, gap: 8 };
/** Centre of swatch i on screen (for the demo's virtual finger). */
export const swatchCenter = (i: number, screenH: number) => {
  "worklet";
  return {
    x: PALETTE.left + i * (PALETTE.size + PALETTE.gap) + PALETTE.size / 2,
    y: screenH - PALETTE.bottom - PALETTE.size / 2,
  };
};

type Props = {
  color: number;
  thick: boolean;
  onColor: (i: number) => void;
  onThick: () => void;
  onUndo: () => void;
  onClear: () => void;
};

/** Round colour bar (7 neon colours) + tube thickness + Undo / Clear. */
export function Palette({
  color,
  thick,
  onColor,
  onThick,
  onUndo,
  onClear,
}: Props) {
  return (
    <>
      <View style={styles.row} pointerEvents="box-none">
        {NEON.map((c, i) => (
          <Pressable key={c.name} onPress={() => onColor(i)} hitSlop={4}>
            <View
              style={[
                styles.ring,
                i === color && {
                  borderColor: c.hex,
                  shadowColor: c.hex,
                  shadowOpacity: 0.9,
                },
              ]}
            >
              <View
                style={[
                  styles.dot,
                  { backgroundColor: c.hex, shadowColor: c.hex },
                ]}
              />
            </View>
          </Pressable>
        ))}
      </View>
      <View style={styles.tools} pointerEvents="box-none">
        <Pressable onPress={onThick} style={styles.btn} hitSlop={6}>
          <View style={[styles.bar, { height: thick ? 6 : 3 }]} />
        </Pressable>
        <Pressable onPress={onUndo} style={styles.btn} hitSlop={6}>
          <Text style={styles.txt}>Undo</Text>
        </Pressable>
        <Pressable onPress={onClear} style={styles.btn} hitSlop={6}>
          <Text style={styles.txt}>Clear</Text>
        </Pressable>
      </View>
    </>
  );
}

const S = PALETTE.size;
const styles = StyleSheet.create({
  row: {
    position: "absolute",
    left: PALETTE.left,
    bottom: PALETTE.bottom,
    flexDirection: "row",
    gap: PALETTE.gap,
  },
  ring: {
    width: S,
    height: S,
    borderRadius: S / 2,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
  },
  dot: {
    width: S - 10,
    height: S - 10,
    borderRadius: (S - 10) / 2,
    shadowRadius: 5,
    shadowOpacity: 0.8,
    shadowOffset: { width: 0, height: 0 },
  },
  tools: {
    position: "absolute",
    left: PALETTE.left,
    bottom: PALETTE.bottom + S + 12,
    flexDirection: "row",
    gap: 8,
  },
  btn: {
    height: 28,
    minWidth: 44,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "rgba(20,18,26,0.55)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  bar: {
    width: 22,
    borderRadius: 3,
    backgroundColor: "rgba(235,235,245,0.85)",
  },
  txt: {
    color: "rgba(235,235,245,0.85)",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
});
