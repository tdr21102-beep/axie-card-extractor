import { createHash } from "node:crypto";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
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
    const lines = wrapText(context, value, field.width);
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
    field.font_size * field.line_spacing * field.max_lines
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
  for (const [index, line] of lines.entries()) {
    const y = field.y + index * lineHeight;
    if (field.stroke_width > 0) {
      context.strokeText(line, anchor, y);
    }
    context.fillText(line, anchor, y);
  }
  context.restore();
  return fitted.reduced ? `${fieldName} font reduced from ${field.font_size}px to ${fitted.fontSize}px` : null;
}

function renderMetadata(context: SKRSContext2D, metadata: CardGameMetadata, layout: CardLayout): string[] {
  const warnings = [
    drawField(context, metadata.cost === null ? "" : String(metadata.cost), layout.cost, layout.default_font_family, "cost"),
    drawField(context, metadata.value === null ? "" : String(metadata.value), layout.value, layout.default_font_family, "value"),
    drawField(context, metadata.name, layout.name, layout.default_font_family, "name"),
    drawField(context, metadata.card_type, layout.card_type, layout.default_font_family, "card_type"),
    drawField(context, metadata.description, layout.description, layout.default_font_family, "description")
  ];
  return warnings.filter((warning): warning is string => warning !== null);
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
  context.drawImage(cleanImage, 0, 0, cleanImage.width, cleanImage.height);

  context.save();
  context.scale(cleanImage.width / layout.reference_width, cleanImage.height / layout.reference_height);
  const warnings = renderMetadata(context, metadata, layout);
  context.restore();

  const encoded = await canvas.encode("png");
  const bytes = Uint8Array.from(encoded);
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    warnings
  };
}
