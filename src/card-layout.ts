import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const CARD_LAYOUT_VERSION = 2 as const;

export type CardTextAlignment = "left" | "center" | "right";
export type CardTextVerticalAlignment = "top" | "middle" | "bottom";
export type CardFontWeight = "normal" | "bold" | `${100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900}`;

export interface CardTextFieldLayout {
  x: number;
  y: number;
  width: number;
  /** Optional text box height. Legacy layouts default to their fitted line box. */
  height: number;
  font_size: number;
  min_font_size: number;
  alignment: CardTextAlignment;
  vertical_alignment: CardTextVerticalAlignment;
  /** Optional cap for text measurement/wrapping, independent of the box width. */
  max_width: number | null;
  max_lines: number;
  line_spacing: number;
  color: string;
  stroke_color: string;
  stroke_width: number;
  font_weight: CardFontWeight;
}

export interface CardLayout {
  version: typeof CARD_LAYOUT_VERSION;
  reference_width: number;
  reference_height: number;
  default_font_family: string;
  font_asset: string | null;
  /** Display labels for gameplay card_type values; unmapped values are shown as-is. */
  card_type_display: Record<string, string>;
  cost: CardTextFieldLayout;
  value: CardTextFieldLayout;
  name: CardTextFieldLayout;
  card_type: CardTextFieldLayout;
  description: CardTextFieldLayout;
}

const DEFAULT_LAYOUT_PATH = resolve("config/card_layout.json");
const FIELD_NAMES = ["cost", "value", "name", "card_type", "description"] as const;
const ALIGNMENTS = new Set<CardTextAlignment>(["left", "center", "right"]);
const VERTICAL_ALIGNMENTS = new Set<CardTextVerticalAlignment>(["top", "middle", "bottom"]);
const FONT_WEIGHTS = new Set<CardFontWeight>([
  "normal",
  "bold",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900"
]);
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  label: string,
  minimum: number,
  integer = false
): number {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    (integer && !Number.isInteger(value))
  ) {
    const qualification = integer ? "an integer" : "a finite number";
    throw new Error(`${label}.${key} must be ${qualification} >= ${minimum}`);
  }
  return value;
}

function requireColor(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw new Error(`${label}.${key} must be a hex color (#RGB, #RGBA, #RRGGBB, or #RRGGBBAA)`);
  }
  return value;
}

function parseField(value: unknown, label: string): CardTextFieldLayout {
  const field = requireRecord(value, label);
  const alignment = field.alignment;
  const fontWeight = field.font_weight;
  const verticalAlignment = field.vertical_alignment ?? "top";
  const height = field.height ?? undefined;
  const maxWidth = field.max_width ?? null;

  if (typeof alignment !== "string" || !ALIGNMENTS.has(alignment as CardTextAlignment)) {
    throw new Error(`${label}.alignment must be left, center, or right`);
  }
  if (typeof fontWeight !== "string" || !FONT_WEIGHTS.has(fontWeight as CardFontWeight)) {
    throw new Error(`${label}.font_weight must be normal, bold, or a weight from 100 to 900`);
  }
  if (typeof verticalAlignment !== "string" || !VERTICAL_ALIGNMENTS.has(verticalAlignment as CardTextVerticalAlignment)) {
    throw new Error(`${label}.vertical_alignment must be top, middle, or bottom`);
  }
  if (height !== undefined && (typeof height !== "number" || !Number.isFinite(height) || height < Number.EPSILON)) {
    throw new Error(`${label}.height must be a finite number > 0`);
  }
  if (maxWidth !== null && (typeof maxWidth !== "number" || !Number.isFinite(maxWidth) || maxWidth < Number.EPSILON)) {
    throw new Error(`${label}.max_width must be null or a finite number > 0`);
  }

  const fontSize = requireFiniteNumber(field, "font_size", label, Number.EPSILON);
  const lineSpacing = requireFiniteNumber(field, "line_spacing", label, Number.EPSILON);
  const maxLines = requireFiniteNumber(field, "max_lines", label, 1, true);

  return {
    x: requireFiniteNumber(field, "x", label, 0),
    y: requireFiniteNumber(field, "y", label, 0),
    width: requireFiniteNumber(field, "width", label, Number.EPSILON),
    height: height ?? fontSize * lineSpacing * maxLines,
    font_size: fontSize,
    min_font_size: requireFiniteNumber(field, "min_font_size", label, Number.EPSILON),
    alignment: alignment as CardTextAlignment,
    vertical_alignment: verticalAlignment as CardTextVerticalAlignment,
    max_width: maxWidth,
    max_lines: maxLines,
    line_spacing: lineSpacing,
    color: requireColor(field, "color", label),
    stroke_color: requireColor(field, "stroke_color", label),
    stroke_width: requireFiniteNumber(field, "stroke_width", label, 0),
    font_weight: fontWeight as CardFontWeight
  };
}

export function parseCardLayout(value: unknown): CardLayout {
  const root = requireRecord(value, "layout");
  if (root.version !== CARD_LAYOUT_VERSION) {
    throw new Error(`layout.version must be ${CARD_LAYOUT_VERSION}`);
  }

  const referenceWidth = requireFiniteNumber(root, "reference_width", "layout", 1, true);
  const referenceHeight = requireFiniteNumber(root, "reference_height", "layout", 1, true);
  const defaultFontFamily = root.default_font_family;
  if (
    typeof defaultFontFamily !== "string" ||
    defaultFontFamily.trim().length === 0 ||
    defaultFontFamily.length > 100 ||
    /[\u0000-\u001f"';\\]/u.test(defaultFontFamily)
  ) {
    throw new Error("layout.default_font_family must be a safe, non-empty font family");
  }
  const fontAsset = root.font_asset;
  const normalizedFontAsset = typeof fontAsset === "string" ? fontAsset.trim() : null;
  if (fontAsset !== null && (typeof fontAsset !== "string" || normalizedFontAsset?.length === 0 || normalizedFontAsset === null || normalizedFontAsset.length > 260 || /[\u0000-\u001f]/u.test(fontAsset))) {
    throw new Error("layout.font_asset must be null or a safe relative asset reference");
  }
  if (normalizedFontAsset !== null && (/^(?:[a-z]+:|[\\/]|[a-z]:)/iu.test(normalizedFontAsset) || normalizedFontAsset.split(/[\\/]/u).includes(".."))) {
    throw new Error("layout.font_asset must stay within packaged assets");
  }

  const cardTypeDisplayValue = root.card_type_display ?? {};
  if (!isRecord(cardTypeDisplayValue)) throw new Error("layout.card_type_display must be an object");
  const cardTypeDisplay: Record<string, string> = {};
  for (const [key, label] of Object.entries(cardTypeDisplayValue)) {
    if (!/^[a-z][a-z0-9_]*$/u.test(key)) throw new Error(`layout.card_type_display.${key} must be a snake_case key`);
    if (typeof label !== "string" || label.trim().length === 0 || label.length > 100 || /[\u0000-\u001f]/u.test(label)) {
      throw new Error(`layout.card_type_display.${key} must be a safe non-empty label`);
    }
    cardTypeDisplay[key] = label.trim();
  }

  const fields = Object.fromEntries(
    FIELD_NAMES.map((fieldName) => [fieldName, parseField(root[fieldName], `layout.${fieldName}`)])
  ) as Record<(typeof FIELD_NAMES)[number], CardTextFieldLayout>;

  for (const fieldName of FIELD_NAMES) {
    const field = fields[fieldName];
    if (field.min_font_size > field.font_size) {
      throw new Error(`layout.${fieldName}.min_font_size must not exceed font_size`);
    }
    if (field.x + field.width > referenceWidth) {
      throw new Error(`layout.${fieldName} exceeds reference_width`);
    }
    if (field.max_width !== null && field.max_width > field.width) {
      throw new Error(`layout.${fieldName}.max_width must not exceed width`);
    }
    const fieldBottom = field.y + field.height;
    if (fieldBottom > referenceHeight) {
      throw new Error(`layout.${fieldName} exceeds reference_height`);
    }
  }

  return {
    version: CARD_LAYOUT_VERSION,
    reference_width: referenceWidth,
    reference_height: referenceHeight,
    default_font_family: defaultFontFamily.trim(),
    font_asset: normalizedFontAsset,
    card_type_display: cardTypeDisplay,
    ...fields
  };
}

export function loadCardLayout(path = DEFAULT_LAYOUT_PATH): CardLayout {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read card layout at ${path}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in card layout at ${path}`, { cause: error });
  }

  try {
    return parseCardLayout(parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid card layout at ${path}: ${detail}`, { cause: error });
  }
}
