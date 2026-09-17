import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addCardToSet,
  assignCardToAxieSlot,
  cardSetsDirectory,
  createAxieSlot,
  createCardSet,
  deleteAxieSlot,
  deleteCardSet,
  getCardSet,
  listCardSets,
  removeCardFromAxieSlot,
  removeCardFromSet,
  renameAxieSlot,
  renameCardSet
} from "../src/card-sets.ts";

test("card sets create deterministic stable IDs, rename, list and delete", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-sets-"));
  const first = await createCardSet(root, "First Battle Set");
  const duplicate = await createCardSet(root, "First Battle Set");
  const numeric = await createCardSet(root, "123 Demo");
  assert.equal(first.id, "first_battle_set");
  assert.equal(duplicate.id, "first_battle_set_2");
  assert.equal(numeric.id, "set_123_demo");
  const renamed = await renameCardSet(root, first.id, "Launch Set");
  assert.equal(renamed.id, first.id);
  assert.equal(renamed.name, "Launch Set");
  assert.deepEqual((await listCardSets(root)).map((set) => set.id), ["first_battle_set", "first_battle_set_2", "set_123_demo"]);
  await deleteCardSet(root, duplicate.id);
  assert.deepEqual((await listCardSets(root)).map((set) => set.id), ["first_battle_set", "set_123_demo"]);
  await assert.rejects(getCardSet(root, duplicate.id), /not found/i);
});

test("cards remain unique and sorted and may belong to multiple sets", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-set-cards-"));
  const first = await createCardSet(root, "First");
  const second = await createCardSet(root, "Second");
  await addCardToSet(root, first.id, "sanity-z");
  await addCardToSet(root, first.id, "sanity-a");
  await addCardToSet(root, first.id, "sanity-a");
  await addCardToSet(root, second.id, "sanity-a");
  assert.deepEqual((await getCardSet(root, first.id)).cards, ["sanity-a", "sanity-z"]);
  assert.deepEqual((await getCardSet(root, second.id)).cards, ["sanity-a"]);
  await removeCardFromSet(root, first.id, "sanity-a");
  assert.deepEqual((await getCardSet(root, first.id)).cards, ["sanity-z"]);
  assert.deepEqual((await getCardSet(root, second.id)).cards, ["sanity-a"]);
});

test("Axie slots support arbitrary counts, renaming and moving assignments", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-slots-"));
  const set = await createCardSet(root, "Slots");
  for (let index = 0; index < 8; index += 1) await createAxieSlot(root, set.id);
  await renameAxieSlot(root, set.id, "axie_01", "Starter Bird");
  await assignCardToAxieSlot(root, set.id, "axie_01", "sanity-card-1");
  let stored = await assignCardToAxieSlot(root, set.id, "axie_02", "sanity-card-1");
  assert.equal(stored.axies.length, 8);
  assert.equal(stored.axies[0]?.name, "Starter Bird");
  assert.deepEqual(stored.cards, ["sanity-card-1"]);
  assert.deepEqual(stored.axies[0]?.cards, []);
  assert.deepEqual(stored.axies[1]?.cards, ["sanity-card-1"]);
  stored = await removeCardFromAxieSlot(root, set.id, "axie_02", "sanity-card-1");
  assert.deepEqual(stored.cards, ["sanity-card-1"]);
  assert.deepEqual(stored.axies[1]?.cards, []);
  stored = await deleteAxieSlot(root, set.id, "axie_08");
  assert.equal(stored.axies.length, 7);
});

test("set persistence is versioned and leaves no temporary files after atomic updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-set-atomic-"));
  const set = await createCardSet(root, "Atomic Set");
  await addCardToSet(root, set.id, "card-uuid");
  const files = await readdir(cardSetsDirectory(root));
  assert.deepEqual(files, ["atomic_set.json"]);
  const stored = JSON.parse(await readFile(join(cardSetsDirectory(root), "atomic_set.json"), "utf8"));
  assert.equal(stored.schema_version, 1);
  assert.deepEqual(stored.cards, ["card-uuid"]);
});

test("removing a card from a set also removes its slot assignment", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-set-remove-"));
  const set = await createCardSet(root, "Remove");
  await createAxieSlot(root, set.id);
  await assignCardToAxieSlot(root, set.id, "axie_01", "catalog-id");
  const stored = await removeCardFromSet(root, set.id, "catalog-id");
  assert.deepEqual(stored.cards, []);
  assert.deepEqual(stored.axies[0]?.cards, []);
});
