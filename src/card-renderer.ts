import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { CardLayout, CardTextFieldLayout } from "./card-layout.ts";
import type { CardGameMetadata } from "./card-studio.ts";

export interface RenderedCard {
  bytes: Uint8Array;
  sha256: string;
  warnings: string[];
}

export class TextOverflowError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(`${field} does not fit within the configured minimum font size and maximum lines`);
    this.name = "TextOverflowError";
    this.field = field;
  }
}

function splitLongToken(context: SKRSContext2D, token: string, width: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const character of Array.from(token)) {
    const candidate = current + character;
    if (current !== "" && context.measureText(candidate).width > width) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }

  if (current !== "") {
    chunks.push(current);
  }
  return chunks;
}

function wrapParagraph(context: SKRSContext2D, paragraph: string, width: number): string[] {
  if (paragraph.trim() === "") {
    return [""];
  }

  const lines: string[] = [];
  let current = "";
  for (const token of paragraph.trim().split(/\s+/u)) {
    const tokenChunks =
      context.measureText(token).width > width ? splitLongToken(context, token, width) : [token];

    for (const chunk of tokenChunks) {
      const candidate = current === "" ? chunk : `${current} ${chunk}`;
      if (current === "" || context.measureText(candidate).width <= width) {
        current = candidate;
      } else {
        lines.push(current);
        current = chunk;
      }
    }
  }

  if (current !== "") {
    lines.push(current);
  }
  return lines;
}

function textWidth(field: CardTextFieldLayout): number {
  return field.max_width === null ? field.width : Math.min(field.width, field.max_width);
}

function wrapText(
  context: SKRSContext2D,
  value: string,
  width: number
): string[] {
  const normalized = value.replace(/\r\n?/gu, "\n");
  return normalized.split("\n").flatMap((paragraph) => wrapParagraph(context, paragraph, width));
}

export interface TextFitResult {
  lines: string[];
  fontSize: number;
  reduced: boolean;
}

export function fitText(
  context: SKRSContext2D,
  value: string,
  field: CardTextFieldLayout,
  fontFamily: string,
  fieldName = "text"
): TextFitResult {
  if (value === "") return { lines: [], fontSize: field.font_size, reduced: false };
  for (let fontSize = field.font_size; fontSize >= field.min_font_size; fontSize -= 1) {
    context.font = `${field.font_weight} ${fontSize}px "${fontFamily}"`;
    const lines = wrapText(context, value, textWidth(field));
    if (lines.length <= field.max_lines) {
      return { lines, fontSize, reduced: fontSize !== field.font_size };
    }
  }
  throw new TextOverflowError(fieldName);
}

function textAnchor(field: CardTextFieldLayout): number {
  if (field.alignment === "center") {
    return field.x + field.width / 2;
  }
  if (field.alignment === "right") {
    return field.x + field.width;
  }
  return field.x;
}

/**
 * `top` is defined against the font em box, but custom fonts can contain
 * glyphs whose actual ascent extends above that box. Keep those pixels inside
 * the field clip without changing any layout coordinates.
 */
function topBaselineCorrection(context: SKRSContext2D, line: string, strokeWidth: number): number {
  const metrics = context.measureText(line);
  const actualAscent = metrics.actualBoundingBoxAscent + strokeWidth / 2;
  if (!Number.isFinite(actualAscent)) {
    return 0;
  }
  // With `textBaseline = "top"`, canvas positions the em box at y while
  // actual glyph pixels may extend above that anchor. Move the baseline by
  // the complete measured ascent so the glyph (including its stroke) starts
  // at the configured field top instead of being clipped there.
  return Math.max(0, actualAscent);
}

function drawField(
  context: SKRSContext2D,
  value: string,
  field: CardTextFieldLayout,
  fontFamily: string,
  fieldName: string
): string | null {
  if (value === "") {
    return null;
  }

  context.save();
  context.beginPath();
  context.rect(
    field.x,
    field.y,
    field.width,
    field.height
  );
  context.clip();
  const fitted = fitText(context, value, field, fontFamily, fieldName);
  context.font = `${field.font_weight} ${fitted.fontSize}px "${fontFamily}"`;
  context.textAlign = field.alignment;
  context.textBaseline = "top";
  context.fillStyle = field.color;
  context.strokeStyle = field.stroke_color;
  context.lineWidth = field.stroke_width;
  context.lineJoin = "round";

  const lines = fitted.lines;
  const anchor = textAnchor(field);
  const lineHeight = fitted.fontSize * field.line_spacing;
  const textHeight = lines.length * lineHeight;
  const verticalOffset = field.vertical_alignment === "middle"
    ? Math.max(0, (field.height - textHeight) / 2)
    : field.vertical_alignment === "bottom"
      ? Math.max(0, field.height - textHeight)
      : 0;
  for (const [index, line] of lines.entries()) {
    const y = field.y + verticalOffset + index * lineHeight + topBaselineCorrection(context, line, field.stroke_width);
    if (field.stroke_width > 0) {
      context.strokeText(line, anchor, y);
    }
    context.fillText(line, anchor, y);
  }
  context.restore();
  return fitted.reduced ? `${fieldName} font reduced from ${field.font_size}px to ${fitted.fontSize}px` : null;
}

function renderMetadata(context: SKRSContext2D, metadata: CardGameMetadata, layout: CardLayout, fontFamily: string): string[] {
  const warnings = [
    drawField(context, metadata.cost === null ? "" : String(metadata.cost), layout.cost, fontFamily, "cost"),
    drawField(context, metadata.value === null ? "" : String(metadata.value), layout.value, fontFamily, "value"),
    drawField(context, metadata.name, layout.name, fontFamily, "name"),
    drawField(context, layout.card_type_display[metadata.card_type.trim().toLowerCase()] ?? metadata.card_type, layout.card_type, fontFamily, "card_type"),
    drawField(context, metadata.description, layout.description, fontFamily, "description")
  ];
  return warnings.filter((warning): warning is string => warning !== null);
}

function resolveFont(layout: CardLayout): { family: string; warning: string | null } {
  if (layout.font_asset === null) return { family: layout.default_font_family, warning: null };
  const fontPath = resolve(process.cwd(), layout.font_asset);
  if (!existsSync(fontPath)) {
    return { family: layout.default_font_family, warning: `font_asset unavailable; using ${layout.default_font_family} fallback` };
  }
  try {
    const registered = GlobalFonts.registerFromPath(fontPath, layout.default_font_family);
    if (registered === null) throw new Error("font registration failed");
    return { family: layout.default_font_family, warning: null };
  } catch {
    return { family: layout.default_font_family, warning: `font_asset unavailable; using ${layout.default_font_family} fallback` };
  }
}

export async function renderCard(
  cleanBytes: Uint8Array,
  metadata: CardGameMetadata,
  layout: CardLayout
): Promise<RenderedCard> {
  const cleanCopy = Uint8Array.from(cleanBytes);
  let cleanImage;
  try {
    cleanImage = await loadImage(cleanCopy);
  } catch (error) {
    throw new Error("Clean visual must be a decodable image", { cause: error });
  }

  if (!Number.isInteger(cleanImage.width) || !Number.isInteger(cleanImage.height) || cleanImage.width <= 0 || cleanImage.height <= 0) {
    throw new Error("Clean visual has invalid dimensions");
  }

  const canvas = createCanvas(cleanImage.width, cleanImage.height);
  const context = canvas.getContext("2d", { alpha: true, colorSpace: "srgb" });
  // Clean Base artwork is pixel art: never introduce bilinear filtering when
  // the master is previewed or a legacy asset is rendered at another size.
  context.imageSmoothingEnabled = false;
  context.drawImage(cleanImage, 0, 0, cleanImage.width, cleanImage.height);

  context.save();
  context.scale(cleanImage.width / layout.reference_width, cleanImage.height / layout.reference_height);
  const font = resolveFont(layout);
  const warnings = renderMetadata(context, metadata, layout, font.family);
  context.restore();

  const encoded = await canvas.encode("png");
  const bytes = Uint8Array.from(encoded);
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    warnings: font.warning ? [font.warning, ...warnings] : warnings
  };
}
