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
  updateVisualLayoutCoordinate
} from "../src/card-layout-overrides.ts";

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

test("visual layout parser rejects non-sparse or non-finite authoring documents", () => {
  assert.throws(() => parseCardVisualLayoutOverrides({ schema_version: 1, fields: { name: {} } }), /x or y/);
  assert.throws(() => parseCardVisualLayoutOverrides({ schema_version: 1, fields: { artwork: { x: 2 } } }), /not supported/);
  assert.throws(() => parseCardVisualLayoutOverrides({ schema_version: 1, fields: { name: { x: "2" } } }), /finite/);
  assert.equal(JSON.parse(readFileSync(resolve("config/card_layout.json"), "utf8")).version, 2);
});
