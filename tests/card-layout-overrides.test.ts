import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { loadCardLayout } from "../src/card-layout.ts";
import {
  EMPTY_CARD_VISUAL_LAYOUT_OVERRIDES,
  applyCardVisualLayoutOverrides,
  effectiveVisualLayout,
  nudgeVisualLayoutCoordinate,
  parseCardVisualLayoutOverrides,
  resetVisualLayoutElement,
  resetVisualLayoutPosition,
  updateVisualLayoutCoordinate,
  updateVisualLayoutProperty
} from "../src/card-layout-overrides.ts";
import {
  draggedLogicalPosition,
  isVisualLayoutNudgeKey,
  previewPointToLogical,
  visualLayoutGhostPosition,
  logicalRectToPixelRect,
  logicalTextLayoutToDisplayStyle
} from "../src/visual-layout-editor.ts";

function layout() {
  return loadCardLayout(resolve("config/card_layout.json"));
}

test("visual layout overrides leave a card without patches identical to global layout", () => {
  const global = layout();
  assert.deepEqual(applyCardVisualLayoutOverrides(global, EMPTY_CARD_VISUAL_LAYOUT_OVERRIDES), global);
  assert.equal(effectiveVisualLayout(global, EMPTY_CARD_VISUAL_LAYOUT_OVERRIDES).name.x, global.name.x);
  assert.equal(effectiveVisualLayout(global, EMPTY_CARD_VISUAL_LAYOUT_OVERRIDES).name.inherited_x, true);
});

test("a sparse name x override changes only that position and reset removes the patch", () => {
  const global = layout();
  const overrides = parseCardVisualLayoutOverrides({ schema_version: 1, fields: { name: { x: global.name.x - 7 } } });
  const effective = applyCardVisualLayoutOverrides(global, overrides);
  assert.equal(effective.name.x, global.name.x - 7);
  assert.equal(effective.name.y, global.name.y);
  assert.deepEqual(effective.cost, global.cost);

  const resetX = updateVisualLayoutCoordinate(overrides, "name", "x", undefined);
  assert.equal(resetX.fields.name, undefined);
  assert.equal(applyCardVisualLayoutOverrides(global, resetX).name.x, global.name.x);

  const both = updateVisualLayoutCoordinate(overrides, "name", "y", global.name.y + 3);
  const resetElement = resetVisualLayoutElement(both, "name");
  assert.equal(resetElement.fields.name, undefined);
  assert.deepEqual(applyCardVisualLayoutOverrides(global, resetElement).name, global.name);
});

test("visual layout keyboard nudges use logical pixels and leave other cards unpatched", () => {
  const global = layout();
  const one = nudgeVisualLayoutCoordinate(EMPTY_CARD_VISUAL_LAYOUT_OVERRIDES, global, "description", "x", 1);
  const ten = nudgeVisualLayoutCoordinate(one, global, "description", "y", -10);
  assert.equal(ten.fields.description?.x, global.description.x + 1);
  assert.equal(ten.fields.description?.y, global.description.y - 10);
  assert.deepEqual(EMPTY_CARD_VISUAL_LAYOUT_OVERRIDES.fields, {});
});

test("preview drag translates CSS pixels into rounded 1024x1536 logical positions", () => {
  const bounds = { left: 100, top: 50, width: 512, height: 768 };
  assert.deepEqual(previewPointToLogical({ clientX: 356, clientY: 434 }, bounds), { x: 512, y: 768 });
  assert.deepEqual(
    draggedLogicalPosition({ x: 300, y: 400 }, { clientX: 200, clientY: 150 }, { clientX: 225, clientY: 175 }, bounds),
    { x: 350, y: 450 }
  );
});

test("visual layout drag keeps reset sparse and nudge shortcuts out of editable controls", () => {
  const global = layout();
  const positioned = updateVisualLayoutCoordinate(
    updateVisualLayoutCoordinate(EMPTY_CARD_VISUAL_LAYOUT_OVERRIDES, "name", "x", 90),
    "name",
    "y",
    120
  );
  const reset = resetVisualLayoutPosition(positioned, "name");
  assert.deepEqual(reset.fields, {});
  assert.deepEqual(applyCardVisualLayoutOverrides(global, reset).name, global.name);
  assert.equal(isVisualLayoutNudgeKey({ key: "ArrowLeft", altKey: false, ctrlKey: false, metaKey: false, targetIsEditable: false }), true);
  assert.equal(isVisualLayoutNudgeKey({ key: "ArrowLeft", altKey: false, ctrlKey: false, metaKey: false, targetIsEditable: true }), false);
  assert.equal(isVisualLayoutNudgeKey({ key: "ArrowLeft", altKey: false, ctrlKey: true, metaKey: false, targetIsEditable: false }), false);
});

test("visual layout ghost position stays transient and does not mutate persisted overrides", () => {
  const original = parseCardVisualLayoutOverrides({ schema_version: 1, fields: { name: { x: 40 }, cost: { y: 12 } } });
  const ghost = visualLayoutGhostPosition("name", { x: 120, y: 240 });
  assert.deepEqual(original.fields, { name: { x: 40 }, cost: { y: 12 } });
  assert.deepEqual(ghost, { field: "name", x: 120, y: 240 });
});

test("editor geometry scales logical selection rectangles without distortion", () => {
  const rect = logicalRectToPixelRect({ x: 128, y: 256, width: 200, height: 100 }, { width: 1024, height: 1536 }, { width: 2048, height: 3072 });
  assert.deepEqual(rect, { x: 256, y: 512, width: 400, height: 200 });
  const reduced = logicalRectToPixelRect({ x: 128, y: 256, width: 200, height: 100 }, { width: 1024, height: 1536 }, { width: 512, height: 768 });
  assert.deepEqual(reduced, { x: 64, y: 128, width: 100, height: 50 });
});

test("visual layout parser rejects non-sparse or non-finite authoring documents", () => {
  assert.throws(() => parseCardVisualLayoutOverrides({ schema_version: 1, fields: { name: {} } }), /property/);
  assert.throws(() => parseCardVisualLayoutOverrides({ schema_version: 1, fields: { artwork: { x: 2 } } }), /not supported/);
  assert.throws(() => parseCardVisualLayoutOverrides({ schema_version: 1, fields: { name: { x: "2" } } }), /finite/);
  assert.equal(JSON.parse(readFileSync(resolve("config/card_layout.json"), "utf8")).version, 2);
});

test("visual layout overrides preserve typography and appearance sparsely", () => {
  const global = layout();
  const overrides = parseCardVisualLayoutOverrides({
    schema_version: 1,
    fields: { name: { font_size: 48, alignment: "right", color: "#FFD966", stroke_width: 3, max_width: 420, line_spacing: 1.2 } }
  });
  const effective = effectiveVisualLayout(global, overrides).name;
  assert.equal(effective.font_size, 48);
  assert.equal(effective.alignment, "right");
  assert.equal(effective.color, "#FFD966");
  assert.equal(effective.stroke_width, 3);
  assert.equal(effective.max_width, 420);
  assert.equal(effective.line_spacing, 1.2);
  assert.equal(effective.inherited_x, true);
  const reset = updateVisualLayoutProperty(overrides, "name", "color", undefined);
  assert.equal(reset.fields.name?.font_size, 48);
  assert.equal(reset.fields.name?.color, undefined);
});


test("ghost display style scales renderer text geometry and preserves alignment anchors", () => {
  const global = layout();
  const name = logicalTextLayoutToDisplayStyle(global.name, { x: global.name.x, y: global.name.y }, { width: 512, height: 768 });
  assert.equal(name.left, 72.5);
  assert.equal(name.top, 490);
  assert.equal(name.width, 358.5);
  assert.equal(name.height, 30.5);
  assert.equal(name.fontSize, 30.5);
  assert.equal(name.strokeWidth, 2.5);
  assert.equal(name.lineHeight, 30.5);
  assert.equal(name.textAlign, "center");

  const description = logicalTextLayoutToDisplayStyle(global.description, { x: 180, y: 1210 }, { width: 512, height: 768 });
  assert.equal(description.left, 90);
  assert.equal(description.top, 605);
  assert.equal(description.fontSize, 20.5);
  assert.equal(description.lineHeight, 25.625);
  assert.equal(description.contentWidth, 347);

  const right = logicalTextLayoutToDisplayStyle({ ...global.name, alignment: "right", max_width: 500 }, { x: 100, y: 200 }, { width: 512, height: 768 });
  assert.equal(right.contentOffsetX, (global.name.width - 500) / 2);
  assert.equal(right.textAlign, "right");
});

test("ghost display position uses per-card effective coordinates without changing typography", () => {
  const global = layout();
  const overrides = parseCardVisualLayoutOverrides({ schema_version: 1, fields: { name: { x: 220, y: 960 } } });
  const effective = applyCardVisualLayoutOverrides(global, overrides);
  const initial = logicalTextLayoutToDisplayStyle(effective.name, { x: effective.name.x, y: effective.name.y }, { width: 1024, height: 1536 });
  const moved = logicalTextLayoutToDisplayStyle(effective.name, { x: 221, y: 970 }, { width: 1024, height: 1536 });
  assert.equal(initial.left, 220);
  assert.equal(initial.top, 960);
  assert.equal(moved.left, 221);
  assert.equal(moved.top, 970);
  assert.equal(moved.fontSize, initial.fontSize);
  assert.equal(moved.width, initial.width);
  assert.equal(moved.height, initial.height);
});
