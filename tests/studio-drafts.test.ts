import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { toCatalogCard } from "../src/catalog.ts";
import { cardStudioPaths, defaultGameMetadata, saveGameMetadata } from "../src/card-studio.ts";
import {
  discardStudioDraft,
  loadStudioDraft,
  saveStudioDraft,
  studioDraftPath,
  STUDIO_DRAFT_MAX_BYTES
} from "../src/studio-drafts.ts";
import { card } from "./fixtures.ts";

const source = () => toCatalogCard(card({ _id: "sanity-card-id" }));

test("draft recovery stores invalid metadata separately and restores it", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-draft-"));
  const catalogCard = source();
  const confirmed = { ...defaultGameMetadata(catalogCard), name: "Confirmed", cost: 1, value: 40, card_type: "attack" };
  await saveGameMetadata(catalogCard, confirmed, root);
  const before = await readFile(cardStudioPaths(catalogCard, root).data, "utf8");
  const invalidDraft = { ...confirmed, name: null, effects: [{ type: "invalid" }] };
  const saved = await saveStudioDraft(catalogCard, invalidDraft, root);
  assert.equal(saved.available, true);
  assert.equal(saved.draft?.card_id, catalogCard.id);
  assert.deepEqual(saved.draft?.metadata, invalidDraft);
  assert.deepEqual(await loadStudioDraft(catalogCard, root), saved);
  assert.equal(await readFile(cardStudioPaths(catalogCard, root).data, "utf8"), before);
  assert.match(studioDraftPath(catalogCard, root).replaceAll("\\", "/"), /cards\/drafts\/aqua\/teal_shell\.json$/u);
});

test("discard removes only the draft and leaves confirmed metadata untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-draft-discard-"));
  const catalogCard = source();
  const confirmed = defaultGameMetadata(catalogCard);
  await saveGameMetadata(catalogCard, confirmed, root);
  await saveStudioDraft(catalogCard, { ...confirmed, description: "Unsaved" }, root);
  const before = await readFile(cardStudioPaths(catalogCard, root).data, "utf8");
  await discardStudioDraft(catalogCard, root);
  assert.deepEqual(await loadStudioDraft(catalogCard, root), { available: false, draft: null });
  assert.equal(await readFile(cardStudioPaths(catalogCard, root).data, "utf8"), before);
});

test("draft recovery keeps visual layout authoring separate from gameplay metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-draft-visual-layout-"));
  const catalogCard = source();
  const metadata = defaultGameMetadata(catalogCard);
  const visualLayoutOverrides = { schema_version: 1 as const, fields: { name: { x: 501 } } };
  const saved = await saveStudioDraft(catalogCard, metadata, root, visualLayoutOverrides);
  assert.deepEqual(saved.draft?.metadata, metadata);
  assert.deepEqual(saved.draft?.visual_layout, visualLayoutOverrides);
  assert.deepEqual((await loadStudioDraft(catalogCard, root)).draft?.visual_layout, visualLayoutOverrides);
});

test("drafts enforce source identity, JSON serialization and a size bound", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-draft-validation-"));
  const catalogCard = source();
  const metadata = defaultGameMetadata(catalogCard);
  await assert.rejects(saveStudioDraft(catalogCard, { ...metadata, id: "other" }, root), /identity/i);
  await assert.rejects(saveStudioDraft(catalogCard, { ...metadata, invalid: BigInt(1) }, root), /serializable/i);
  const circular: Record<string, unknown> = { ...metadata };
  circular.self = circular;
  await assert.rejects(saveStudioDraft(catalogCard, circular, root), /circular/i);
  await assert.rejects(
    saveStudioDraft(catalogCard, { ...metadata, description: "x".repeat(STUDIO_DRAFT_MAX_BYTES) }, root),
    /exceeds/i
  );
});

test("corrupt stored drafts are surfaced and never promoted", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-draft-corrupt-"));
  const catalogCard = source();
  await saveStudioDraft(catalogCard, defaultGameMetadata(catalogCard), root);
  await writeFile(studioDraftPath(catalogCard, root), "{broken");
  await assert.rejects(loadStudioDraft(catalogCard, root), /JSON|position|property/i);
  await assert.rejects(readFile(cardStudioPaths(catalogCard, root).data), { code: "ENOENT" });
});
