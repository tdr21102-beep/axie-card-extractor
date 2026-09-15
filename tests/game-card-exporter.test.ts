import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { toCatalogCard } from "../src/catalog.ts";
import { sha256 } from "../src/downloader.ts";
import { exportGameCardPackage, exportGameCardsBatch, gameCardExportPaths, validateGameCardDocument } from "../src/game-card-exporter.ts";
import type { CardGameMetadata } from "../src/game-metadata.ts";
import { card } from "./fixtures.ts";

const source = () => toCatalogCard(card({ title: "Furball", slug: "furball", class: { _id: "beast", title: "Beast" }, part: { _id: "back", title: "Back" } }));
const metadata: CardGameMetadata = {
  schema_version: 2,
  id: "furball",
  name: "Furball",
  class: "beast",
  part: "back",
  cost: 1,
  value: 40,
  card_type: "attack",
  description: "Deal 2 hits.",
  targeting: { mode: "single_enemy" },
  effects: [{ id: "damage_1", type: "damage", target: "selected", amount: 20, hits: 2 }]
};

function png(color = "#88442f"): Uint8Array {
  const canvas = createCanvas(24, 36);
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, 24, 36);
  return Uint8Array.from(canvas.toBuffer("image/png"));
}

test("exports a deterministic byte-identical original placeholder package on Windows-safe paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-export-"));
  const original = png();
  const first = await exportGameCardPackage({ card: source(), metadata, visualSource: "original", imageBytes: original, exportRoot: root });
  assert.equal(first.status, "success");
  assert.equal(first.visual_source, "original_placeholder");
  assert.deepEqual(new Uint8Array(await readFile(first.image_path)), original);
  assert.equal(first.image_sha256, sha256(original));
  assert.match(first.image_path.replace(/\\/gu, "/"), /game_export\/beast\/furball\/card\.png$/u);
  const stored = validateGameCardDocument(JSON.parse(await readFile(first.metadata_path, "utf8")));
  assert.equal(stored.schema_version, 2);
  assert.equal(stored.visual.sha256, sha256(original));
  assert.equal(stored.effects[0]?.type, "damage");
  const repeated = await exportGameCardPackage({ card: source(), metadata, visualSource: "original", imageBytes: original, exportRoot: root });
  assert.equal(repeated.status, "skipped");
});

test("preflights conflicts and never overwrites a different game card", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-conflict-"));
  const original = png();
  const paths = gameCardExportPaths(source(), root);
  await exportGameCardPackage({ card: source(), metadata, visualSource: "original", imageBytes: original, exportRoot: root });
  await assert.rejects(
    exportGameCardPackage({ card: source(), metadata, visualSource: "original", imageBytes: png("#225577"), exportRoot: root }),
    /conflict/i
  );
  assert.deepEqual(new Uint8Array(await readFile(paths.image)), original);
});

test("batch game export isolates individual failures and preserves order", async () => {
  const results = await exportGameCardsBatch(
    ["first", "broken", "third"],
    async (item) => {
      if (item === "broken") throw new Error("invalid metadata");
      return {
        status: "success" as const,
        directory: item,
        image_path: item,
        metadata_path: item,
        image_sha256: "a".repeat(64),
        visual_source: "rendered" as const,
        document: { ...metadata, package_schema_version: 1, visual: { source: "rendered" as const, file: "card.png" as const, sha256: "a".repeat(64), warning: null } }
      };
    },
    (item) => item
  );
  assert.deepEqual(results.map((result) => result.status), ["success", "failed", "success"]);
  assert.equal(results[1]?.error, "invalid metadata");
});
