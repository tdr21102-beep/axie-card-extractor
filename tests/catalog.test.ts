import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalog, findCard, summarizeCatalog } from "../src/catalog.ts";
import { parseSanityCards } from "../src/source.ts";
import { card } from "./fixtures.ts";

test("catalog parsing rejects malformed data", () => {
  assert.throws(() => parseSanityCards({ result: [{ title: "missing id" }] }), /invalid card/);
  assert.equal(parseSanityCards({ result: [card()] }).length, 1);
});

test("catalog maps class, paths and structured body", () => {
  const [mapped] = buildCatalog([card({ body: [
    { _type: "block", children: [{ _type: "span", text: "Mana: 1" }] },
    { _type: "block", children: [{ _type: "span", text: "Deal 60 damage" }] }
  ] })]);
  assert.equal(mapped.class, "Aqua");
  assert.equal(mapped.local_name, "teal_shell");
  assert.equal(mapped.cost, 1);
  assert.equal(mapped.effect, "Deal 60 damage");
});

test("summary counts by class", () => {
  const catalog = buildCatalog([card(), card({ _id: "id-2", title: "Cactus", slug: "cactus", class: { _id: "plant", title: "Plant" } })]);
  assert.deepEqual(summarizeCatalog(catalog).by_class, { Aqua: 1, Plant: 1 });
});

test("lookup uses exact canonical slug when display names repeat", () => {
  const catalog = buildCatalog([
    card({ _id: "mouth", title: "Nut Cracker", slug: "nut-cracker" }),
    card({ _id: "tail", title: "Nut Cracker", slug: "nut-cracker-tail" })
  ]);
  assert.equal(findCard(catalog, "Nut Cracker").id, "mouth");
  assert.equal(findCard(catalog, "nut-cracker-tail").id, "tail");
  assert.throws(() => findCard(catalog, "missing"), /not found/);
});
