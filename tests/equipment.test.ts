import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cardIdentity } from "../src/card-identity.ts";
import { assertValidPng, cardStudioPaths, defaultGameMetadata, importCleanBase } from "../src/card-studio.ts";
import { renderCard } from "../src/card-renderer.ts";
import { loadCardLayout } from "../src/card-layout.ts";
import { acquireCardImage } from "../src/downloader.ts";
import { equipmentAssetPath, loadEquipmentRegistry } from "../src/equipment-registry.ts";
import { gameCardExportPaths } from "../src/game-card-exporter.ts";
import { filterProductionCards } from "../src/production-filters.ts";
import type { ProductionCardState } from "../src/production-contract.ts";

test("Wooden Sword Clean Base preserves source bytes and is renderable despite private PNG metadata", async () => {
  const sourcePath = join(process.cwd(), "assets", "cards", "equipment", "weapon", "wooden_sword_card.png");
  const sourceBytes = new Uint8Array(await readFile(sourcePath));
  const [card] = await loadEquipmentRegistry(process.cwd());
  assert.ok(card);
  await assertValidPng(sourceBytes);

  const root = await mkdtemp(join(tmpdir(), "axie-equipment-clean-"));
  try {
    const imported = await importCleanBase(card, sourcePath, { root });
    assert.deepEqual(new Uint8Array(await readFile(imported.path)), sourceBytes);
    const rendered = await renderCard(sourceBytes, defaultGameMetadata(card), loadCardLayout());
    assert.ok(rendered.bytes.byteLength > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "axie-equipment-"));
  const path = join(root, "assets", "cards", "equipment", "weapon", "wooden_sword_card.png");
  await mkdir(join(root, "assets", "cards", "equipment", "weapon"), { recursive: true });
  await writeFile(path, new Uint8Array([1, 2, 3]));
  const [card] = await loadEquipmentRegistry(root);
  assert.ok(card);
  return { root, path, card };
}

function ready(cardId: string): ProductionCardState {
  return { card_id: cardId, status: "GAME_READY", metadata_exists: true, effect_count: 0, errors: 0, warnings: 0, issues: [], original_available: true, clean_available: false, rendered_available: false, game_ready: true, exportable_visual_sources: ["original"] };
}

test("Wooden Sword registry is conditional on its canonical local source", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-equipment-missing-"));
  assert.deepEqual(await loadEquipmentRegistry(root), []);
  const item = await fixture();
  assert.equal(equipmentAssetPath(item.card, item.root), item.path);
  assert.equal(item.card.slug, "wooden_sword_card");
  assert.equal(item.card.class, null);
  assert.equal(item.card.part, null);
});

test("equipment metadata and paths use an origin/slot namespace", async () => {
  const item = await fixture();
  const metadata = defaultGameMetadata(item.card);
  assert.equal(metadata.card_origin, "equipment");
  assert.equal(metadata.equipment_slot, "weapon");
  assert.equal(metadata.class, undefined);
  assert.deepEqual(cardIdentity(item.card).pathSegments, ["equipment", "weapon", "wooden_sword_card"]);
  assert.match(cardStudioPaths(item.card, item.root).data.replaceAll("\\", "/"), /cards\/data\/equipment\/weapon\/wooden_sword_card\.json$/u);
  assert.match(gameCardExportPaths(item.card, item.root).directory.replaceAll("\\", "/"), /game_export\/equipment\/weapon\/wooden_sword_card$/u);
});

test("equipment filters and source-missing failure remain explicit", async () => {
  const item = await fixture();
  const filtered = filterProductionCards([item.card], new Map([[item.card.id, ready(item.card.id)]]), {
    search: "", scope: "all", setCardIds: [], slotCardIds: [], className: null, part: null, cardOrigin: "equipment", equipmentSlot: "weapon", status: null, hasEffects: false, hasClean: false, gameReady: false
  });
  assert.deepEqual(filtered.map((card) => card.id), [item.card.id]);
  await rm(item.path);
  await assert.rejects(acquireCardImage(item.card, { assetRoot: item.root }), /Equipment source asset is missing: assets\/cards\/equipment\/weapon\/wooden_sword_card\.png/u);
});
