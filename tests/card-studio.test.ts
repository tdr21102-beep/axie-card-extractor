import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import {
  assertMetadataIdentity,
  cardStudioPaths,
  defaultGameMetadata,
  getCleanAssetState,
  importCleanBase,
  loadGameMetadata,
  saveGameMetadata,
  validateGameMetadata
} from "../src/card-studio.ts";
import { toCatalogCard } from "../src/catalog.ts";
import { sha256 } from "../src/downloader.ts";
import { card } from "./fixtures.ts";

const catalogCard = () => toCatalogCard(card());
function pngFixture(fill: string, width = 8, height = 8): Uint8Array {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = fill;
  context.fillRect(0, 0, width, height);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

const png = pngFixture("#126b8c");

test("default game metadata uses safe source fields without persisting", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-studio-default-"));
  const source = catalogCard();
  assert.deepEqual(defaultGameMetadata(source), {
    schema_version: 2,
    id: "teal_shell",
    name: "Teal Shell",
    class: "aqua",
    part: "horn",
    cost: null,
    value: null,
    card_type: "",
    description: "",
    targeting: { mode: "single_enemy" },
    effects: []
  });
  assert.deepEqual(await loadGameMetadata(source, root), {
    metadata: defaultGameMetadata(source),
    status: "default",
    sourceSchemaVersion: null,
    migrated: false
  });
  await assert.rejects(readFile(cardStudioPaths(source, root).data), { code: "ENOENT" });
});

test("metadata save, reload and JSON roundtrip preserve editable values", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-studio-metadata-"));
  const source = catalogCard();
  const metadata = {
    ...defaultGameMetadata(source),
    name: "Teal Shell Fantasy",
    cost: 1,
    value: 55,
    card_type: "attack",
    description: "Deal 2 hits."
  };
  assert.deepEqual(await saveGameMetadata(source, metadata, root), metadata);
  assert.deepEqual(await loadGameMetadata(source, root), { metadata, status: "saved", sourceSchemaVersion: 2, migrated: false });
  assert.deepEqual(JSON.parse(await readFile(cardStudioPaths(source, root).data, "utf8")), metadata);
  const edited = { ...metadata, value: 40, description: "Deal 2 hits twice." };
  assert.deepEqual(await saveGameMetadata(source, edited, root), edited);
  assert.deepEqual(await loadGameMetadata(source, root), { metadata: edited, status: "saved", sourceSchemaVersion: 2, migrated: false });
});

test("loads V1 metadata as V2 in memory without rewriting until explicit save", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-studio-v1-"));
  const source = catalogCard();
  const path = cardStudioPaths(source, root).data;
  const v1 = {
    id: "teal_shell", name: "Teal Shell", class: "aqua", part: "horn",
    cost: 1, value: 40, card_type: "attack", description: "Deal 2 hits."
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(v1, null, 2)}\n`);
  const before = await readFile(path, "utf8");
  const loaded = await loadGameMetadata(source, root);
  assert.equal(loaded.metadata.schema_version, 2);
  assert.equal(loaded.migrated, true);
  assert.equal(loaded.sourceSchemaVersion, 1);
  assert.deepEqual(loaded.metadata.effects, []);
  assert.equal(await readFile(path, "utf8"), before);
  await saveGameMetadata(source, loaded.metadata, root);
  assert.equal(JSON.parse(await readFile(path, "utf8")).schema_version, 2);
});

test("metadata validation rejects malformed fields and returns an independent object", () => {
  const valid = defaultGameMetadata(catalogCard());
  const validated = validateGameMetadata(valid);
  assert.deepEqual(validated, valid);
  assert.notEqual(validated, valid);
  assert.throws(() => validateGameMetadata({ ...valid, ignoredSourceValue: "not gameplay" }), /ignoredSourceValue/);
  assert.throws(() => validateGameMetadata({ ...valid, cost: "1" }), /cost/);
  assert.throws(() => validateGameMetadata({ ...valid, value: Number.NaN }), /value/);
  assert.throws(() => validateGameMetadata({ ...valid, name: null }), /name/);
  assert.throws(() => validateGameMetadata({ ...valid, description: null }), /description/);
});

test("game metadata remains independent from source metadata", () => {
  const source = catalogCard();
  const game = defaultGameMetadata(source);
  game.name = "Edited name";
  game.cost = 2;
  game.description = "Edited description";
  assert.equal(source.name, "Teal Shell");
  assert.equal(source.cost, null);
  assert.equal(source.effect, null);
});

test("studio paths are exact, snake_case and derived only from CatalogCard", () => {
  const source = toCatalogCard(card({ title: "Fancy Name", slug: "Nut Cracker Tail", class: { _id: "beast", title: "My Beast" } }));
  const paths = cardStudioPaths(source, "C:/studio-root");
  assert.match(paths.clean.replace(/\\/g, "/"), /studio-root\/cards\/clean\/my_beast\/nut_cracker_tail\.png$/);
  assert.match(paths.data.replace(/\\/g, "/"), /studio-root\/cards\/data\/my_beast\/nut_cracker_tail\.json$/);
  assert.match(paths.rendered.replace(/\\/g, "/"), /studio-root\/cards\/rendered\/my_beast\/nut_cracker_tail\.png$/);
});

test("missing clean state retains its target path", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-studio-missing-"));
  const source = catalogCard();
  assert.deepEqual(await getCleanAssetState(source, root), {
    available: false,
    path: cardStudioPaths(source, root).clean,
    sha256: null,
    width: null,
    height: null,
    compatibility: null
  });
});

test("clean import preserves bytes and hash and rejects non-PNG input", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-studio-import-"));
  const sourcePath = join(root, "manual-clean.png");
  await writeFile(sourcePath, png);
  const state = await importCleanBase(catalogCard(), sourcePath, { root });
  assert.equal(state.available, true);
  assert.equal(state.sha256, sha256(png));
  assert.equal(state.width, 8);
  assert.equal(state.height, 8);
  assert.equal(state.compatibility, "legacy");
  assert.deepEqual(new Uint8Array(await readFile(state.path)), png);
  assert.deepEqual(await getCleanAssetState(catalogCard(), root), state);
  const invalid = join(root, "invalid.png");
  await writeFile(invalid, new Uint8Array([1, 2, 3]));
  await assert.rejects(importCleanBase(catalogCard(), invalid, { root }), /valid PNG/);
  const truncated = join(root, "truncated.png");
  await writeFile(truncated, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
  await assert.rejects(importCleanBase(catalogCard(), truncated, { root }), /complete PNG|decodable PNG/);
});

test("clean import classifies the 1024x1536 master without changing bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-studio-master-"));
  const sourcePath = join(root, "catfish-clean.png");
  const master = pngFixture("#126b8c", 1024, 1536);
  await writeFile(sourcePath, master);
  const state = await importCleanBase(catalogCard(), sourcePath, { root });
  assert.deepEqual(state, {
    available: true,
    path: cardStudioPaths(catalogCard(), root).clean,
    sha256: sha256(master),
    width: 1024,
    height: 1536,
    compatibility: "master"
  });
  assert.deepEqual(new Uint8Array(await readFile(state.path)), master);
});

test("clean import is conflict-safe and replacement is explicit", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-studio-conflict-"));
  const firstPath = join(root, "first.png");
  const secondPath = join(root, "second.png");
  const differentPng = pngFixture("#8c3b12");
  await writeFile(firstPath, png);
  await writeFile(secondPath, differentPng);
  const first = await importCleanBase(catalogCard(), firstPath, { root });
  assert.deepEqual(await importCleanBase(catalogCard(), firstPath, { root }), first);
  await assert.rejects(importCleanBase(catalogCard(), secondPath, { root }), /conflict/i);
  assert.deepEqual(new Uint8Array(await readFile(first.path)), png);
  const replaced = await importCleanBase(catalogCard(), secondPath, { root, replace: true });
  assert.equal(replaced.sha256, sha256(differentPng));
  assert.deepEqual(new Uint8Array(await readFile(replaced.path)), differentPng);
});

test("metadata identity prevents cross-card saves and corrupted saved data", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-studio-identity-"));
  const source = catalogCard();
  const mismatched = { ...defaultGameMetadata(source), id: "another_card" };
  assert.throws(() => assertMetadataIdentity(mismatched, source), /identity/);
  await assert.rejects(saveGameMetadata(source, mismatched, root), /identity/);
  const dataPath = cardStudioPaths(source, root).data;
  await saveGameMetadata(source, defaultGameMetadata(source), root);
  const stored = JSON.parse(await readFile(dataPath, "utf8"));
  stored.class = "beast";
  await writeFile(dataPath, JSON.stringify(stored));
  await assert.rejects(loadGameMetadata(source, root), /identity/);
});
