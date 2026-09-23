/**
 * Preview-only coordinate helpers. The renderer remains the sole producer of
 * card pixels; these functions only map pointer motion into its logical space.
 */
import type { CardVisualLayoutField } from "./card-layout-overrides.ts";
import type { CardTextFieldLayout } from "./card-layout.ts";

export const VISUAL_LAYOUT_LOGICAL_SIZE = { width: 1024, height: 1536 } as const;

export interface PreviewBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LayoutSize {
  width: number;
  height: number;
}

export interface LogicalRect extends LayoutSize {
  x: number;
  y: number;
}

export interface DisplayRect extends LogicalRect {}

function validSize(size: LayoutSize, label: string): void {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new Error(`${label} must have a positive finite width and height`);
  }
}

/** Maps one logical layout rectangle into the intrinsic bitmap coordinate space. */
export function logicalRectToBitmapRect(rect: LogicalRect, bitmap: LayoutSize): LogicalRect {
  validSize(bitmap, "bitmap size");
  return {
    x: rect.x * bitmap.width / VISUAL_LAYOUT_LOGICAL_SIZE.width,
    y: rect.y * bitmap.height / VISUAL_LAYOUT_LOGICAL_SIZE.height,
    width: rect.width * bitmap.width / VISUAL_LAYOUT_LOGICAL_SIZE.width,
    height: rect.height * bitmap.height / VISUAL_LAYOUT_LOGICAL_SIZE.height
  };
}

/** Maps an intrinsic bitmap rectangle into the displayed CSS rectangle. */
export function bitmapRectToDisplayRect(rect: LogicalRect, bitmap: LayoutSize, display: PreviewBounds): DisplayRect {
  validSize(bitmap, "bitmap size");
  validBounds(display);
  return {
    x: display.left + rect.x * display.width / bitmap.width,
    y: display.top + rect.y * display.height / bitmap.height,
    width: rect.width * display.width / bitmap.width,
    height: rect.height * display.height / bitmap.height
  };
}

/** Maps logical card coordinates directly to CSS/display coordinates through the bitmap space. */
export function logicalRectToDisplayRect(rect: LogicalRect, display: PreviewBounds, bitmap: LayoutSize = VISUAL_LAYOUT_LOGICAL_SIZE): DisplayRect {
  return bitmapRectToDisplayRect(logicalRectToBitmapRect(rect, bitmap), bitmap, display);
}

export interface PreviewPoint {
  clientX: number;
  clientY: number;
}

export interface VisualLayoutDragPosition {
  x: number;
  y: number;
}

/** Builds the transient DOM ghost state without touching persisted overrides. */
export function visualLayoutGhostPosition(
  fieldName: CardVisualLayoutField,
  position: VisualLayoutDragPosition
): { field: CardVisualLayoutField; x: number; y: number } {
  return { field: fieldName, x: position.x, y: position.y };
}

export interface LogicalPosition {
  x: number;
  y: number;
}

export interface GhostDisplayStyle {
  left: number;
  top: number;
  width: number;
  height: number;
  contentWidth: number;
  contentOffsetX: number;
  fontSize: number;
  lineHeight: number;
  strokeWidth: number;
  textAlign: CardTextFieldLayout["alignment"];
  verticalAlign: CardTextFieldLayout["vertical_alignment"];
}

/**
 * Maps the same logical text box used by the canvas renderer into preview CSS
 * pixels. The renderer uses `textBaseline = "top"` and corrects glyph ascent
 * so `y` is the visible top; the DOM ghost therefore uses the same box top.
 */
export function logicalTextLayoutToDisplayStyle(
  field: CardTextFieldLayout,
  position: LogicalPosition,
  display: LayoutSize
): GhostDisplayStyle {
  validSize(display, "display size");
  const scaleX = display.width / VISUAL_LAYOUT_LOGICAL_SIZE.width;
  const scaleY = display.height / VISUAL_LAYOUT_LOGICAL_SIZE.height;
  const contentWidth = Math.min(field.width, field.max_width ?? field.width);
  const contentOffsetX = field.alignment === "center"
    ? (field.width - contentWidth) / 2
    : field.alignment === "right" ? field.width - contentWidth : 0;
  return {
    left: position.x * scaleX,
    top: position.y * scaleY,
    width: field.width * scaleX,
    height: field.height * scaleY,
    contentWidth: contentWidth * scaleX,
    contentOffsetX: contentOffsetX * scaleX,
    fontSize: field.font_size * scaleY,
    lineHeight: field.font_size * field.line_spacing * scaleY,
    strokeWidth: field.stroke_width * scaleY,
    textAlign: field.alignment,
    verticalAlign: field.vertical_alignment
  };
}

export interface LogicalRect { x: number; y: number; width: number; height: number }
export interface PixelSize { width: number; height: number }

export function logicalRectToPixelRect(rect: LogicalRect, logicalSize: PixelSize, pixelSize: PixelSize): LogicalRect {
  return {
    x: rect.x * pixelSize.width / logicalSize.width,
    y: rect.y * pixelSize.height / logicalSize.height,
    width: rect.width * pixelSize.width / logicalSize.width,
    height: rect.height * pixelSize.height / logicalSize.height
  };
}

function validBounds(bounds: PreviewBounds): void {
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("preview bounds must have a positive finite width and height");
  }
}

/** Converts a CSS pointer location to rounded logical card pixels. */
export function previewPointToLogical(point: PreviewPoint, bounds: PreviewBounds): LogicalPosition {
  validBounds(bounds);
  return {
    x: Math.round((point.clientX - bounds.left) * VISUAL_LAYOUT_LOGICAL_SIZE.width / bounds.width),
    y: Math.round((point.clientY - bounds.top) * VISUAL_LAYOUT_LOGICAL_SIZE.height / bounds.height)
  };
}

/** Converts pointer motion to an absolute, pixel-snapped logical position. */
export function draggedLogicalPosition(
  startingPosition: LogicalPosition,
  startPoint: PreviewPoint,
  currentPoint: PreviewPoint,
  bounds: PreviewBounds
): LogicalPosition {
  const start = previewPointToLogical(startPoint, bounds);
  const current = previewPointToLogical(currentPoint, bounds);
  return { x: startingPosition.x + current.x - start.x, y: startingPosition.y + current.y - start.y };
}

export interface VisualLayoutNudgeKey {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  targetIsEditable: boolean;
}

/** Keeps normal keyboard behavior inside every editable control. */
export function isVisualLayoutNudgeKey(event: VisualLayoutNudgeKey): boolean {
  return !event.targetIsEditable
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
}
