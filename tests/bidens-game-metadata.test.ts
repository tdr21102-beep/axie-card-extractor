import assert from "node:assert/strict";
import test from "node:test";
import { defaultGameMetadata } from "../src/card-studio.ts";
import { toCatalogCard } from "../src/catalog.ts";
import { parseGameMetadataV2, validateGameMetadataForGameReady, validateGameMetadataV2 } from "../src/game-metadata.ts";
import { card } from "./fixtures.ts";

// Catalog identity is fixture-only: no Clean Base, rendered card, or saved gameplay is implied.
const bidens = toCatalogCard(card({
  _id: "9e45c3b9-79b5-4042-affd-a72ba7d7266e",
  title: "Bidens",
  slug: "bidens",
  class: { _id: "plant", title: "Plant" },
  part: { _id: "back", title: "Back" }
}));

test("Bidens starts as valid V2 draft without invented gameplay or a persisted visual", () => {
  const metadata = defaultGameMetadata(bidens);
  assert.deepEqual({ id: metadata.id, class: metadata.class, part: metadata.part }, {
    id: "bidens", class: "plant", part: "back"
  });
  assert.equal(metadata.name, "Bidens");
  assert.equal(metadata.cost, null);
  assert.equal(metadata.value, null);
  assert.equal(metadata.card_type, "");
  assert.equal(metadata.description, "");
  assert.deepEqual(metadata.effects, []);
  assert.equal(validateGameMetadataV2(metadata).status, "warnings");
  assert.equal(validateGameMetadataForGameReady(metadata).status, "warnings");
});

test("Bidens expresses one team heal and per-target cleanse stacks without synthetic repetitions", () => {
  const metadata = {
    ...defaultGameMetadata(bidens),
    name: "Bidens",
    cost: 1,
    value: 40,
    card_type: "skill",
    description: "Heal allies and cleanse debuffs.",
    targeting: { mode: "all_allies" as const },
    effects: [
      { id: "heal_1", type: "heal" as const, target: "all_allies" as const, amount: 40 },
      { id: "cleanse_1", type: "cleanse" as const, target: "all_allies" as const, count: 3 }
    ]
  };
  const parsed = parseGameMetadataV2(metadata);
  assert.deepEqual(parsed.effects, metadata.effects);
  assert.equal(validateGameMetadataV2(parsed).status, "valid");
  assert.equal(validateGameMetadataForGameReady(parsed).status, "valid");
  const roundTrip = parseGameMetadataV2(JSON.parse(JSON.stringify(parsed)));
  assert.deepEqual(roundTrip.effects, parsed.effects);
  assert.equal("hits" in roundTrip.effects[0]!, false);
  assert.equal("repetitions" in roundTrip.effects[1]!, false);
  assert.equal((roundTrip.effects[1] as { count: number }).count, 3);
});
