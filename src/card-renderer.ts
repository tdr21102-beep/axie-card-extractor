import { createHash } from "node:crypto";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { CardLayout, CardTextFieldLayout } from "./card-layout.ts";
import type { CardGameMetadata } from "./card-studio.ts";

export interface RenderedCard {
  bytes: Uint8Array;
  sha256: string;
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

function truncateWithEllipsis(context: SKRSContext2D, value: string, width: number): string {
  const ellipsis = "…";
  if (context.measureText(ellipsis).width > width) {
    return "";
  }

  let characters = Array.from(value.trimEnd());
  while (characters.length > 0 && context.measureText(`${characters.join("")}${ellipsis}`).width > width) {
    characters = characters.slice(0, -1);
  }
  return `${characters.join("").trimEnd()}${ellipsis}`;
}

function wrapText(
  context: SKRSContext2D,
  value: string,
  width: number,
  maxLines: number
): string[] {
  const normalized = value.replace(/\r\n?/gu, "\n");
  const allLines = normalized.split("\n").flatMap((paragraph) => wrapParagraph(context, paragraph, width));
  if (allLines.length <= maxLines) {
    return allLines;
  }

  const visible = allLines.slice(0, maxLines);
  visible[maxLines - 1] = truncateWithEllipsis(context, visible[maxLines - 1] ?? "", width);
  return visible;
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
  fontFamily: string
): void {
  if (value === "") {
    return;
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
  context.font = `${field.font_weight} ${field.font_size}px "${fontFamily}"`;
  context.textAlign = field.alignment;
  context.textBaseline = "top";
  context.fillStyle = field.color;
  context.strokeStyle = field.stroke_color;
  context.lineWidth = field.stroke_width;
  context.lineJoin = "round";

  const lines = wrapText(context, value, field.width, field.max_lines);
  const anchor = textAnchor(field);
  const lineHeight = field.font_size * field.line_spacing;
  for (const [index, line] of lines.entries()) {
    const y = field.y + index * lineHeight;
    if (field.stroke_width > 0) {
      context.strokeText(line, anchor, y);
    }
    context.fillText(line, anchor, y);
  }
  context.restore();
}

function renderMetadata(context: SKRSContext2D, metadata: CardGameMetadata, layout: CardLayout): void {
  drawField(context, metadata.cost === null ? "" : String(metadata.cost), layout.cost, layout.default_font_family);
  drawField(context, metadata.value === null ? "" : String(metadata.value), layout.value, layout.default_font_family);
  drawField(context, metadata.name, layout.name, layout.default_font_family);
  drawField(context, metadata.card_type, layout.card_type, layout.default_font_family);
  drawField(context, metadata.description, layout.description, layout.default_font_family);
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
  renderMetadata(context, metadata, layout);
  context.restore();

  const encoded = await canvas.encode("png");
  const bytes = Uint8Array.from(encoded);
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}
