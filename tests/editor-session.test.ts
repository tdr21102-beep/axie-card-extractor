import assert from "node:assert/strict";
import test from "node:test";
import type { CardGameMetadata } from "../src/game-metadata.ts";
import {
  adjacentCardId,
  copyGameplay,
  createEditorHistory,
  pasteGameplay,
  pushEditorHistory,
  redoEditorHistory,
  undoEditorHistory
} from "../src/editor-session.ts";

const metadata = (id: string, name: string, hits: number): CardGameMetadata => ({
  schema_version: 2,
  id,
  name,
  class: "Beast",
  part: "Back",
  cost: 1,
  value: 20,
  card_type: "attack",
  description: `${name} description`,
  targeting: { mode: "selected" },
  effects: [{ id: "damage_1", type: "damage", target: "selected", amount: 20, hits }]
});

test("editor history supports field changes, effect operations, undo and redo", () => {
  const original = metadata("card_a", "A", 1);
  const changed = { ...original, name: "Changed" };
  const reordered = { ...changed, effects: [
    { id: "heal_1", type: "heal" as const, target: "self" as const, amount: 5 },
    ...changed.effects
  ] };
  const history = pushEditorHistory(pushEditorHistory(createEditorHistory(original), changed), reordered);
  const once = undoEditorHistory(history);
  assert.equal(once.present.name, "Changed");
  assert.equal(once.present.effects.length, 1);
  const twice = undoEditorHistory(once);
  assert.equal(twice.present.name, "A");
  const redone = redoEditorHistory(twice);
  assert.equal(redone.present.name, "Changed");
  assert.equal(redone.future.length, 1);
});

test("an accepted Advanced JSON document is one undo step", () => {
  const original = metadata("card_a", "A", 1);
  const advanced = {
    ...original,
    name: "Advanced",
    targeting: { mode: "all_enemies" as const },
    effects: [{ id: "shield_1", type: "shield" as const, target: "self" as const, amount: 12 }]
  };
  const applied = pushEditorHistory(createEditorHistory(original), advanced);
  assert.deepEqual(applied.present, advanced);
  const undone = undoEditorHistory(applied);
  assert.deepEqual(undone.present, original);
  assert.equal(undone.past.length, 0);
  assert.deepEqual(redoEditorHistory(undone).present, advanced);
});

test("copy/paste gameplay preserves destination identity and visual metadata", () => {
  const source = metadata("source", "Source", 3);
  const destination = metadata("destination", "Destination", 1);
  destination.class = "Bird";
  destination.part = "Tail";
  destination.cost = 2;
  destination.value = 99;
  destination.description = "Keep this";
  const pasted = pasteGameplay(destination, copyGameplay(source));
  assert.deepEqual(pasted.targeting, source.targeting);
  assert.deepEqual(pasted.effects, source.effects);
  assert.equal(pasted.id, "destination");
  assert.equal(pasted.name, "Destination");
  assert.equal(pasted.class, "Bird");
  assert.equal(pasted.part, "Tail");
  assert.equal(pasted.cost, 2);
  assert.equal(pasted.value, 99);
  assert.equal(pasted.description, "Keep this");
});

test("filtered card navigation returns adjacent IDs without wrapping", () => {
  const cardIds = ["alpha", "beta", "gamma"];
  assert.equal(adjacentCardId(cardIds, "beta", "previous"), "alpha");
  assert.equal(adjacentCardId(cardIds, "beta", "next"), "gamma");
  assert.equal(adjacentCardId(cardIds, "alpha", "previous"), null);
  assert.equal(adjacentCardId(cardIds, "gamma", "next"), null);
  assert.equal(adjacentCardId(cardIds, "outside", "next"), null);
  assert.equal(adjacentCardId(cardIds, null, "next"), null);
});
