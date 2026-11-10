/**
 * Shared stroke styles for the programmatic drawings. Every drawing uses ink
 * outlines plus at most two accent colors from this list (asserted in tests).
 */
import type { HexColor } from "@pictionary/protocol";
import type { Style } from "./shapes.js";

export const INK_HEX: HexColor = "#1f2430";
export const YELLOW_HEX: HexColor = "#e0a800";
export const RED_HEX: HexColor = "#c0392b";
export const BLUE_HEX: HexColor = "#2b6cb0";
export const GREEN_HEX: HexColor = "#2f855a";
export const BROWN_HEX: HexColor = "#8b5a2b";
export const ORANGE_HEX: HexColor = "#e67e22";
export const GREY_HEX: HexColor = "#8a94a6";
export const PINK_HEX: HexColor = "#d6679b";
export const PURPLE_HEX: HexColor = "#6b46c1";
export const WHITE_HEX: HexColor = "#ffffff";

export const THICK: Style = { width: 8 };
export const THIN: Style = { width: 2 };
export const HAIR: Style = { width: 1 };
export const YELLOW: Style = { color: YELLOW_HEX };
export const RED: Style = { color: RED_HEX };
export const BLUE: Style = { color: BLUE_HEX };
export const GREEN: Style = { color: GREEN_HEX };
export const BROWN: Style = { color: BROWN_HEX };
export const ORANGE: Style = { color: ORANGE_HEX };
export const GREY: Style = { color: GREY_HEX };
export const PINK: Style = { color: PINK_HEX };
export const PURPLE: Style = { color: PURPLE_HEX };

/** Solid ink fill (eyes, silhouettes). */
export const FILL_INK: Style = { fill: INK_HEX };
export const FILL_YELLOW: Style = { ...YELLOW, fill: YELLOW_HEX };
export const FILL_RED: Style = { ...RED, fill: RED_HEX };
export const FILL_BLUE: Style = { ...BLUE, fill: BLUE_HEX };
export const FILL_GREEN: Style = { ...GREEN, fill: GREEN_HEX };
export const FILL_BROWN: Style = { ...BROWN, fill: BROWN_HEX };
export const FILL_ORANGE: Style = { ...ORANGE, fill: ORANGE_HEX };
export const FILL_GREY: Style = { ...GREY, fill: GREY_HEX };
export const FILL_PINK: Style = { ...PINK, fill: PINK_HEX };
/** White fill with ink outline: paints over earlier strokes (belly, teeth). */
export const FILL_WHITE: Style = { fill: WHITE_HEX };

export const PI = Math.PI;
