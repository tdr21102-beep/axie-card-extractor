import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const CARD_LAYOUT_VERSION = 1 as const;

export type CardTextAlignment = "left" | "center" | "right";
export type CardFontWeight = "normal" | "bold" | `${100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900}`;

export interface CardTextFieldLayout {
  x: number;
  y: number;
  width: number;
  font_size: number;
  alignment: CardTextAlignment;
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
  cost: CardTextFieldLayout;
  value: CardTextFieldLayout;
  name: CardTextFieldLayout;
  card_type: CardTextFieldLayout;
  description: CardTextFieldLayout;
}

const DEFAULT_LAYOUT_PATH = resolve("config/card_layout.json");
const FIELD_NAMES = ["cost", "value", "name", "card_type", "description"] as const;
const ALIGNMENTS = new Set<CardTextAlignment>(["left", "center", "right"]);
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

  if (typeof alignment !== "string" || !ALIGNMENTS.has(alignment as CardTextAlignment)) {
    throw new Error(`${label}.alignment must be left, center, or right`);
  }
  if (typeof fontWeight !== "string" || !FONT_WEIGHTS.has(fontWeight as CardFontWeight)) {
    throw new Error(`${label}.font_weight must be normal, bold, or a weight from 100 to 900`);
  }

  return {
    x: requireFiniteNumber(field, "x", label, 0),
    y: requireFiniteNumber(field, "y", label, 0),
    width: requireFiniteNumber(field, "width", label, Number.EPSILON),
    font_size: requireFiniteNumber(field, "font_size", label, Number.EPSILON),
    alignment: alignment as CardTextAlignment,
    max_lines: requireFiniteNumber(field, "max_lines", label, 1, true),
    line_spacing: requireFiniteNumber(field, "line_spacing", label, Number.EPSILON),
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

  const fields = Object.fromEntries(
    FIELD_NAMES.map((fieldName) => [fieldName, parseField(root[fieldName], `layout.${fieldName}`)])
  ) as Record<(typeof FIELD_NAMES)[number], CardTextFieldLayout>;

  for (const fieldName of FIELD_NAMES) {
    const field = fields[fieldName];
    if (field.x + field.width > referenceWidth) {
      throw new Error(`layout.${fieldName} exceeds reference_width`);
    }
    const fieldBottom = field.y + field.font_size * field.line_spacing * field.max_lines;
    if (fieldBottom > referenceHeight) {
      throw new Error(`layout.${fieldName} exceeds reference_height`);
    }
  }

  return {
    version: CARD_LAYOUT_VERSION,
    reference_width: referenceWidth,
    reference_height: referenceHeight,
    default_font_family: defaultFontFamily.trim(),
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
