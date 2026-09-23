import type { CardLayout, CardTextFieldLayout } from "./card-layout.ts";

/** A separate, visual-only authoring document. It is deliberately not game metadata. */
export const CARD_VISUAL_LAYOUT_OVERRIDE_SCHEMA_VERSION = 1 as const;

export const CARD_VISUAL_LAYOUT_FIELDS = ["cost", "name", "value", "card_type", "description"] as const;
export type CardVisualLayoutField = (typeof CARD_VISUAL_LAYOUT_FIELDS)[number];

export interface CardVisualLayoutFieldOverride {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  font_size?: number;
  alignment?: CardTextFieldLayout["alignment"];
  color?: string;
  stroke_color?: string;
  stroke_width?: number;
  max_width?: number | null;
  line_spacing?: number;
}

export interface CardVisualLayoutOverrides {
  schema_version: typeof CARD_VISUAL_LAYOUT_OVERRIDE_SCHEMA_VERSION;
  fields: Partial<Record<CardVisualLayoutField, CardVisualLayoutFieldOverride>>;
}

export interface EffectiveVisualLayoutField extends CardTextFieldLayout {
  /** Sparse per-card patches currently affect only these coordinates. */
  inherited_x: boolean;
  inherited_y: boolean;
}

/** Renderer-level layout data required by the editor to faithfully mirror text. */
export interface VisualLayoutRenderingContext {
  default_font_family: string;
  font_asset: string | null;
  card_type_display: Record<string, string>;
}

export type EffectiveVisualLayout = Record<CardVisualLayoutField, EffectiveVisualLayoutField>;

export function visualLayoutRenderingContext(layout: CardLayout): VisualLayoutRenderingContext {
  return {
    default_font_family: layout.default_font_family,
    font_asset: layout.font_asset,
    card_type_display: { ...layout.card_type_display }
  };
}

export const EMPTY_CARD_VISUAL_LAYOUT_OVERRIDES: CardVisualLayoutOverrides = {
  schema_version: CARD_VISUAL_LAYOUT_OVERRIDE_SCHEMA_VERSION,
  fields: {}
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteCoordinate(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

const OVERRIDE_KEYS = ["x", "y", "width", "height", "font_size", "alignment", "color", "stroke_color", "stroke_width", "max_width", "line_spacing"] as const;
type VisualOverrideKey = (typeof OVERRIDE_KEYS)[number];
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;

function parseOverrideValue(key: VisualOverrideKey, value: unknown, label: string): CardVisualLayoutFieldOverride[VisualOverrideKey] {
  if (["alignment"].includes(key)) {
    if (value !== "left" && value !== "center" && value !== "right") throw new Error(`${label} must be left, center, or right`);
    return value;
  }
  if (["color", "stroke_color"].includes(key)) {
    if (typeof value !== "string" || !HEX_COLOR.test(value)) throw new Error(`${label} must be a hex color`);
    return value;
  }
  if (key === "max_width") {
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) throw new Error(`${label} must be null or a finite number > 0`);
    return value;
  }
  if (["width", "height", "font_size", "line_spacing"].includes(key)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a finite number > 0`);
    return value;
  }
  if (key === "stroke_width") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite number >= 0`);
    return value;
  }
  return finiteCoordinate(value, label);
}

export function cloneCardVisualLayoutOverrides(value: CardVisualLayoutOverrides): CardVisualLayoutOverrides {
  return structuredClone(value);
}

/**
 * Parses only sparse x/y patches. Empty elements are normalized away so reset
 * semantics are represented by an actual missing override, never a copied
 * global value.
 */
export function parseCardVisualLayoutOverrides(value: unknown): CardVisualLayoutOverrides {
  if (!isRecord(value)) throw new Error("visual layout overrides must be an object");
  if (value.schema_version !== CARD_VISUAL_LAYOUT_OVERRIDE_SCHEMA_VERSION) {
    throw new Error(`visual layout overrides.schema_version must be ${CARD_VISUAL_LAYOUT_OVERRIDE_SCHEMA_VERSION}`);
  }
  if (!isRecord(value.fields)) throw new Error("visual layout overrides.fields must be an object");
  const fields: CardVisualLayoutOverrides["fields"] = {};
  for (const [fieldName, candidate] of Object.entries(value.fields)) {
    if (!CARD_VISUAL_LAYOUT_FIELDS.includes(fieldName as CardVisualLayoutField)) {
      throw new Error(`visual layout overrides.fields.${fieldName} is not supported`);
    }
    if (!isRecord(candidate)) throw new Error(`visual layout overrides.fields.${fieldName} must be an object`);
    const keys = Object.keys(candidate);
    if (keys.some((key) => !OVERRIDE_KEYS.includes(key as VisualOverrideKey))) {
      throw new Error(`visual layout overrides.fields.${fieldName} contains an unsupported property`);
    }
    const patch: CardVisualLayoutFieldOverride = {};
    for (const key of keys as VisualOverrideKey[]) {
      if (candidate[key] !== undefined) patch[key] = parseOverrideValue(key, candidate[key], `visual layout overrides.fields.${fieldName}.${key}`) as never;
    }
    if (keys.length === 0) throw new Error(`visual layout overrides.fields.${fieldName} must contain a property`);
    fields[fieldName as CardVisualLayoutField] = patch;
  }
  return { schema_version: CARD_VISUAL_LAYOUT_OVERRIDE_SCHEMA_VERSION, fields };
}

export function effectiveVisualLayout(layout: CardLayout, overrides: CardVisualLayoutOverrides): EffectiveVisualLayout {
  const effective = {} as EffectiveVisualLayout;
  for (const fieldName of CARD_VISUAL_LAYOUT_FIELDS) {
    const field = layout[fieldName];
    const patch = overrides.fields[fieldName];
    effective[fieldName] = {
      ...field,
      ...field,
      ...(patch ?? {}),
      inherited_x: patch?.x === undefined,
      inherited_y: patch?.y === undefined
    };
  }
  return effective;
}

/** The renderer receives this fully resolved layout; React never derives it. */
export function applyCardVisualLayoutOverrides(layout: CardLayout, overrides: CardVisualLayoutOverrides): CardLayout {
  const effective = effectiveVisualLayout(layout, overrides);
  const fields = Object.fromEntries(CARD_VISUAL_LAYOUT_FIELDS.map((fieldName) => [
    fieldName,
    { ...layout[fieldName], ...Object.fromEntries(OVERRIDE_KEYS.map((key) => [key, effective[fieldName][key]])) } satisfies CardTextFieldLayout
  ])) as Record<CardVisualLayoutField, CardTextFieldLayout>;
  return { ...layout, ...fields };
}

export function updateVisualLayoutCoordinate(
  overrides: CardVisualLayoutOverrides,
  fieldName: CardVisualLayoutField,
  coordinate: "x" | "y",
  value: number | undefined
): CardVisualLayoutOverrides {
  if (value !== undefined && !Number.isFinite(value)) throw new Error("visual layout coordinate must be finite");
  const fields = cloneCardVisualLayoutOverrides(overrides).fields;
  const patch = { ...(fields[fieldName] ?? {}) };
  if (value === undefined) delete patch[coordinate];
  else patch[coordinate] = value;
  if (patch.x === undefined && patch.y === undefined) delete fields[fieldName];
  else fields[fieldName] = patch;
  return { schema_version: CARD_VISUAL_LAYOUT_OVERRIDE_SCHEMA_VERSION, fields };
}

export function updateVisualLayoutProperty<K extends keyof CardVisualLayoutFieldOverride>(
  overrides: CardVisualLayoutOverrides,
  fieldName: CardVisualLayoutField,
  property: K,
  value: CardVisualLayoutFieldOverride[K] | undefined
): CardVisualLayoutOverrides {
  const fields = cloneCardVisualLayoutOverrides(overrides).fields;
  const patch = { ...(fields[fieldName] ?? {}) };
  if (value === undefined) delete patch[property];
  else patch[property] = value;
  if (Object.keys(patch).length === 0) delete fields[fieldName];
  else fields[fieldName] = patch;
  return { schema_version: CARD_VISUAL_LAYOUT_OVERRIDE_SCHEMA_VERSION, fields };
}

export function resetVisualLayoutElement(
  overrides: CardVisualLayoutOverrides,
  fieldName: CardVisualLayoutField
): CardVisualLayoutOverrides {
  const fields = cloneCardVisualLayoutOverrides(overrides).fields;
  delete fields[fieldName];
  return { schema_version: CARD_VISUAL_LAYOUT_OVERRIDE_SCHEMA_VERSION, fields };
}

/**
 * Resets only the movable position. Today x/y are the complete sparse patch,
 * but composing coordinate resets keeps future visual properties intact.
 */
export function resetVisualLayoutPosition(
  overrides: CardVisualLayoutOverrides,
  fieldName: CardVisualLayoutField
): CardVisualLayoutOverrides {
  return updateVisualLayoutCoordinate(
    updateVisualLayoutCoordinate(overrides, fieldName, "x", undefined),
    fieldName,
    "y",
    undefined
  );
}

export function nudgeVisualLayoutCoordinate(
  overrides: CardVisualLayoutOverrides,
  layout: CardLayout,
  fieldName: CardVisualLayoutField,
  coordinate: "x" | "y",
  delta: number
): CardVisualLayoutOverrides {
  if (!Number.isFinite(delta)) throw new Error("visual layout nudge must be finite");
  const current = overrides.fields[fieldName]?.[coordinate] ?? layout[fieldName][coordinate];
  return updateVisualLayoutCoordinate(overrides, fieldName, coordinate, current + delta);
}
