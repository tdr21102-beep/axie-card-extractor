import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { defaultGameMetadata } from "../src/card-studio.ts";
import { toCatalogCard } from "../src/catalog.ts";
import { sha256 } from "../src/downloader.ts";
import { createCardStudioService } from "../src/studio-service.ts";
import { card } from "./fixtures.ts";

function cleanFixture(background = "#ead6a5"): Uint8Array {
  const canvas = createCanvas(900, 1350);
  const context = canvas.getContext("2d", { alpha: true });
  context.fillStyle = background;
  context.fillRect(45, 45, 810, 1260);
  context.fillStyle = "#27455a";
  context.fillRect(110, 165, 680, 760);
  return Uint8Array.from(canvas.toBuffer("image/png"));
}

test("studio service integrates load, save, clean import, preview and rendered export", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-studio-service-"));
  const source = {
    ...toCatalogCard(card({ title: "Furball", slug: "furball", class: { _id: "beast", title: "Beast" }, part: { _id: "back", title: "Back" } })),
    image_size: null,
    image_sha1: null
  };
  const service = createCardStudioService({ root, layoutPath: resolve("config/card_layout.json"), imageCache: join(root, "cache", "images") });
  const initial = await service.load(source);
  assert.equal(initial.metadataStatus, "default");
  assert.equal(initial.clean.available, false);

  const metadata = { ...defaultGameMetadata(source), cost: 1, value: 40, card_type: "attack", description: "Deal 2 hits." };
  assert.equal((await service.saveMetadata(source, metadata)).metadataStatus, "saved");

  const fixturePath = join(root, "furball-clean.png");
  const clean = cleanFixture();
  await writeFile(fixturePath, clean);
  const imported = await service.importClean(source, fixturePath);
  assert.equal(imported.clean.sha256, sha256(clean));

  const preview40 = await service.render(source, metadata);
  const preview55 = await service.render(source, { ...metadata, value: 55 });
  assert.notEqual(preview40.sha256, preview55.sha256);
  const exported = await service.exportRendered(source, metadata);
  assert.equal(exported.sha256, preview40.sha256);
  assert.equal(exported.cleanSha256, sha256(clean));
  assert.deepEqual(new Uint8Array(await readFile(imported.clean.path)), clean);
  const decoded = await loadImage(await readFile(exported.path));
  assert.deepEqual([decoded.width, decoded.height], [900, 1350]);

  const replacementPath = join(root, "furball-clean-replacement.png");
  await writeFile(replacementPath, cleanFixture("#d7e4ec"));
  await service.importClean(source, replacementPath, true);
  await assert.rejects(readFile(exported.path), (error: NodeJS.ErrnoException) => error.code === "ENOENT");

  const renderedAgain = await service.exportRendered(source, metadata);
  const committedClean = await readFile(imported.clean.path);
  await rm(renderedAgain.path, { force: true });
  await mkdir(renderedAgain.path);
  const blockedReplacementPath = join(root, "furball-clean-blocked-replacement.png");
  await writeFile(blockedReplacementPath, cleanFixture("#f2c8c8"));
  await assert.rejects(service.importClean(source, blockedReplacementPath, true));
  assert.deepEqual(await readFile(imported.clean.path), committedClean, "clean replacement must not commit when rendered invalidation fails");
});

test("studio service exports original placeholder bytes without requiring a clean asset", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-studio-placeholder-"));
  const original = cleanFixture();
  const source = {
    ...toCatalogCard(card({ title: "Furball", slug: "furball", class: { _id: "beast", title: "Beast" }, part: { _id: "back", title: "Back" } })),
    image_size: null,
    image_sha1: null
  };
  const service = createCardStudioService({
    root,
    layoutPath: resolve("config/card_layout.json"),
    imageCache: join(root, "cache", "images"),
    fetchImpl: async () => new Response(Buffer.from(original), { status: 200 })
  });
  const metadata = {
    ...defaultGameMetadata(source),
    cost: 1,
    value: 40,
    card_type: "attack",
    description: "Deal 2 hits.",
    effects: [{ id: "damage_1", type: "damage" as const, target: "selected" as const, amount: 20, hits: 2 }]
  };
  const before = sha256(original);
  const exported = await service.exportGameCard(source, metadata, "original", root);
  assert.equal(exported.visual_source, "original_placeholder");
  assert.deepEqual(new Uint8Array(await readFile(exported.image_path)), original);
  assert.equal(sha256(original), before);
  assert.equal(exported.document.effects[0]?.type, "damage");
});

test("studio service reloads layout from disk and retains the last valid layout after invalid edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-studio-layout-reload-"));
  const layoutPath = join(root, "card_layout.json");
  const originalLayout = JSON.parse(await readFile(resolve("config/card_layout.json"), "utf8")) as { name: { x: number } };
  await writeFile(layoutPath, JSON.stringify(originalLayout));
  const source = {
    ...toCatalogCard(card({ title: "Furball", slug: "furball", class: { _id: "beast", title: "Beast" }, part: { _id: "back", title: "Back" } })),
    image_size: null,
    image_sha1: null
  };
  const clean = cleanFixture();
  const cleanPath = join(root, "furball-clean.png");
  await writeFile(cleanPath, clean);
  const service = createCardStudioService({ root, layoutPath, imageCache: join(root, "cache", "images") });
  const imported = await service.importClean(source, cleanPath);
  const metadata = { ...defaultGameMetadata(source), name: "Reloaded Layout", value: 30 };
  const before = await service.render(source, metadata);

  originalLayout.name.x += 40;
  await writeFile(layoutPath, JSON.stringify(originalLayout));
  const reloaded = service.reloadLayout();
  assert.equal(reloaded.name.x, originalLayout.name.x);
  const after = await service.render(source, metadata);
  assert.notEqual(after.sha256, before.sha256);
  assert.deepEqual(new Uint8Array(await readFile(imported.clean.path)), clean);

  await writeFile(layoutPath, "{ invalid json");
  assert.throws(() => service.reloadLayout(), /Unexpected token|JSON|layout/i);
  const retained = await service.render(source, metadata);
  assert.equal(retained.sha256, after.sha256);
  assert.deepEqual(new Uint8Array(await readFile(imported.clean.path)), clean);
  assert.deepEqual(metadata, { ...defaultGameMetadata(source), name: "Reloaded Layout", value: 30 });
  await rm(root, { recursive: true, force: true });
});
