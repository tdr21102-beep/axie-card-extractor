import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogCard } from "../src/catalog.ts";
import { filterProductionCards, type ProductionCardFilters } from "../src/production-filters.ts";
import type { ProductionCardState } from "../src/production-contract.ts";

function card(id: string, name: string, cardClass: string, part: string): CatalogCard {
  return { id, name, slug: name.toLowerCase(), local_name: name.toLowerCase(), class: cardClass, part } as CatalogCard;
}

function state(cardId: string, status: ProductionCardState["status"], effects: number, clean: boolean, ready: boolean): ProductionCardState {
  return { card_id: cardId, status, metadata_exists: status !== "UNCONFIGURED", effect_count: effects, errors: 0, warnings: 0, issues: [], original_available: true, clean_available: clean, rendered_available: clean, game_ready: ready, exportable_visual_sources: ["original"] };
}

const cards = [card("a", "Alpha", "Beast", "Back"), card("b", "Beta", "Bird", "Tail"), card("c", "Gamma", "Beast", "Tail")];
const states = new Map([
  ["a", state("a", "GAME_READY", 1, true, true)],
  ["b", state("b", "VALID", 0, false, false)],
  ["c", state("c", "DRAFT", 2, false, false)]
]);
const base: ProductionCardFilters = { search: "", scope: "all", setCardIds: [], slotCardIds: [], className: null, part: null, status: null, hasEffects: false, hasClean: false, gameReady: false };

test("production filters support set, slot and individual status flags", () => {
  assert.deepEqual(filterProductionCards(cards, states, { ...base, scope: "set", setCardIds: ["a", "b"] }).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(filterProductionCards(cards, states, { ...base, scope: "slot", slotCardIds: ["b"] }).map((item) => item.id), ["b"]);
  assert.deepEqual(filterProductionCards(cards, states, { ...base, status: "DRAFT" }).map((item) => item.id), ["c"]);
  assert.deepEqual(filterProductionCards(cards, states, { ...base, hasEffects: true }).map((item) => item.id), ["a", "c"]);
  assert.deepEqual(filterProductionCards(cards, states, { ...base, hasClean: true }).map((item) => item.id), ["a"]);
  assert.deepEqual(filterProductionCards(cards, states, { ...base, gameReady: true }).map((item) => item.id), ["a"]);
});

test("production filters combine scope, class, part, status, effects, clean, ready and search", () => {
  const result = filterProductionCards(cards, states, {
    ...base,
    search: "alp",
    scope: "set",
    setCardIds: ["a", "b", "c"],
    className: "Beast",
    part: "Back",
    status: "GAME_READY",
    hasEffects: true,
    hasClean: true,
    gameReady: true
  });
  assert.deepEqual(result.map((item) => item.id), ["a"]);
});
