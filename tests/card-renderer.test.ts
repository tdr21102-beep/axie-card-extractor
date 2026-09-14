import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { loadCardLayout, parseCardLayout, type CardLayout } from "../src/card-layout.ts";
import { renderCard } from "../src/card-renderer.ts";
import type { CardGameMetadata } from "../src/card-studio.ts";

const metadata: CardGameMetadata = {
  id: "furball",
  name: "Furball",
  class: "beast",
  part: "back",
  cost: 1,
  value: 40,
  card_type: "attack",
  description: "Deal 2 hits."
};

function cleanPng(width = 900, height = 1350): Uint8Array {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: true });
  context.fillStyle = "#B7D5A3CC";
  context.fillRect(24, 24, width - 48, height - 48);
  return Uint8Array.from(canvas.toBuffer("image/png"));
}

function cloneLayout(layout: CardLayout): CardLayout {
  return structuredClone(layout);
}

test("loads and validates the versioned card layout", async () => {
  const layout = loadCardLayout();
  assert.equal(layout.version, 1);
  assert.equal(layout.reference_width, 900);
  assert.equal(layout.description.max_lines, 4);

  const directory = await mkdtemp(join(tmpdir(), "axie-card-layout-"));
  const invalidPath = join(directory, "invalid.json");
  await writeFile(invalidPath, JSON.stringify({ ...layout, name: { ...layout.name, alignment: "diagonal" } }));
  assert.throws(() => loadCardLayout(invalidPath), /name\.alignment/);

  assert.throws(
    () => parseCardLayout({ ...layout, description: { ...layout.description, width: -1 } }),
    /description\.width/
  );
  assert.throws(() => parseCardLayout({ ...layout, version: 2 }), /layout\.version/);
});

test("renders a deterministic PNG with the clean dimensions without mutating its input", async () => {
  const layout = loadCardLayout();
  const clean = cleanPng(450, 675);
  const originalBytes = Uint8Array.from(clean);
  const originalHash = createHash("sha256").update(clean).digest("hex");

  const first = await renderCard(clean, metadata, layout);
  const second = await renderCard(clean, metadata, layout);

  assert.deepEqual(clean, originalBytes);
  assert.equal(createHash("sha256").update(clean).digest("hex"), originalHash);
  assert.equal(first.sha256, createHash("sha256").update(first.bytes).digest("hex"));
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.bytes, second.bytes);
  assert.notEqual(first.sha256, originalHash);
  assert.deepEqual(Array.from(first.bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);

  const decoded = await loadImage(first.bytes);
  assert.equal(decoded.width, 450);
  assert.equal(decoded.height, 675);

  const pixelCanvas = createCanvas(decoded.width, decoded.height);
  const pixelContext = pixelCanvas.getContext("2d", { alpha: true });
  pixelContext.drawImage(decoded, 0, 0);
  assert.equal(pixelContext.getImageData(0, 0, 1, 1).data[3], 0);
  assert.equal(pixelContext.getImageData(25, 25, 1, 1).data[3], 204);
});

test("each editable field contributes to the rendered output", async () => {
  const layout = loadCardLayout();
  const clean = cleanPng();
  const baseline = await renderCard(clean, metadata, layout);
  const variants: CardGameMetadata[] = [
    { ...metadata, name: "Furball Plus" },
    { ...metadata, cost: 2 },
    { ...metadata, value: 55 },
    { ...metadata, card_type: "skill" },
    { ...metadata, description: "Deal 3 hits." }
  ];

  for (const variant of variants) {
    const rendered = await renderCard(clean, variant, layout);
    assert.notEqual(rendered.sha256, baseline.sha256);
  }
});

test("wraps and clips multiline descriptions at configured bounds", async () => {
  const layout = loadCardLayout();
  const clean = cleanPng();
  const compact = cloneLayout(layout);
  compact.description.width = 220;
  compact.description.max_lines = 2;
  const longDescription = {
    ...metadata,
    description: "Deal two quick hits to the closest enemy, then draw one additional card for the next round."
  };

  const longRender = await renderCard(clean, longDescription, compact);
  const shortRender = await renderCard(clean, { ...metadata, description: "Deal two hits." }, compact);
  const repeated = await renderCard(clean, longDescription, compact);

  assert.notEqual(longRender.sha256, shortRender.sha256);
  assert.equal(longRender.sha256, repeated.sha256);
});

test("rejects clean bytes that are not a decodable image", async () => {
  await assert.rejects(() => renderCard(Uint8Array.of(1, 2, 3), metadata, loadCardLayout()), /decodable image/);
});
