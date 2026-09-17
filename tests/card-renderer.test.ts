import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { loadCardLayout, parseCardLayout, type CardLayout } from "../src/card-layout.ts";
import { renderCard, TextOverflowError } from "../src/card-renderer.ts";
import type { CardGameMetadata } from "../src/game-metadata.ts";

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
  assert.equal(layout.version, 2);
  assert.equal(layout.reference_width, 1024);
  assert.equal(layout.reference_height, 1536);
  assert.equal(layout.description.max_lines, 4);
  assert.equal(layout.description.vertical_alignment, "top");
  assert.equal(layout.card_type_display.attack, "Attack");

  const directory = await mkdtemp(join(tmpdir(), "axie-card-layout-"));
  const invalidPath = join(directory, "invalid.json");
  await writeFile(invalidPath, JSON.stringify({ ...layout, name: { ...layout.name, alignment: "diagonal" } }));
  assert.throws(() => loadCardLayout(invalidPath), /name\.alignment/);

  assert.throws(
    () => parseCardLayout({ ...layout, description: { ...layout.description, width: -1 } }),
    /description\.width/
  );
  assert.equal(layout.font_asset, "assets/fonts/minecraft.ttf");
  assert.ok(layout.name.min_font_size < layout.name.font_size);
  assert.throws(() => parseCardLayout({ ...layout, version: 1 }), /layout\.version/);
  assert.throws(() => parseCardLayout({ ...layout, name: { ...layout.name, min_font_size: layout.name.font_size + 1 } }), /min_font_size/);
  for (const font_asset of ["C:\\fonts\\card.ttf", " C:\\fonts\\card.ttf", "../fonts/card.ttf", " ../fonts/card.ttf", "/fonts/card.ttf", "https://example.test/card.ttf", "HTTPS://example.test/card.ttf"]) {
    assert.throws(() => parseCardLayout({ ...layout, font_asset }), /font_asset/);
  }
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

test("card type display mapping is visual-only and deterministic", async () => {
  const layout = loadCardLayout();
  const clean = cleanPng(1024, 1536);
  const baseline = await renderCard(clean, metadata, layout);
  const mapped = await renderCard(clean, metadata, { ...layout, card_type_display: { ...layout.card_type_display, attack: "Strike" } });
  assert.notEqual(mapped.sha256, baseline.sha256);
  assert.equal((await renderCard(clean, metadata, { ...layout, card_type_display: { ...layout.card_type_display, attack: "Strike" } })).sha256, mapped.sha256);
});

test("field height and vertical alignment are honored without changing the clean base", async () => {
  const layout = cloneLayout(loadCardLayout());
  layout.name.height = 180;
  layout.name.vertical_alignment = "bottom";
  const clean = cleanPng(1024, 1536);
  const rendered = await renderCard(clean, metadata, layout);
  assert.notEqual(rendered.sha256, createHash("sha256").update(clean).digest("hex"));
  assert.deepEqual(clean, cleanPng(1024, 1536));
});

test("configured font assets fall back safely when not packaged", async () => {
  const layout = { ...loadCardLayout(), font_asset: "assets/fonts/not-installed.ttf" };
  const rendered = await renderCard(cleanPng(1024, 1536), metadata, layout);
  assert.match(rendered.warnings.join("\n"), /fallback/);
});

test("custom font metrics keep glyph tops inside the configured field", async () => {
  const layout = loadCardLayout();
  assert.ok(layout.font_asset, "the project layout must exercise the custom font path");
  const transparent = createCanvas(1024, 1536);
  const clean = Uint8Array.from(transparent.toBuffer("image/png"));
  const costOnly = { ...metadata, value: null, name: "", card_type: "", description: "" };
  const rendered = await renderCard(clean, costOnly, layout);
  const image = await loadImage(rendered.bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d", { alpha: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(layout.cost.x, layout.cost.y, layout.cost.width, layout.cost.height).data;
  let minY = layout.cost.height;
  let maxY = -1;
  for (let y = 0; y < layout.cost.height; y += 1) {
    for (let x = 0; x < layout.cost.width; x += 1) {
      if (pixels[(y * layout.cost.width + x) * 4 + 3] > 0) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  assert.ok(minY <= 1, "the glyph should start at the field top rather than a clipped lower edge");
  assert.ok(maxY - minY + 1 >= layout.cost.font_size * 0.8, "custom glyph should retain its full vertical extent");
});

test("deterministically shrinks long descriptions instead of clipping them", async () => {
  const layout = loadCardLayout();
  const clean = cleanPng();
  const compact = cloneLayout(layout);
  compact.description.width = 360;
  compact.description.max_lines = 2;
  compact.description.min_font_size = 18;
  const longDescription = {
    ...metadata,
    description: "Deal two quick hits, then draw one card next round."
  };

  const longRender = await renderCard(clean, longDescription, compact);
  const shortRender = await renderCard(clean, { ...metadata, description: "Deal two hits." }, compact);
  const repeated = await renderCard(clean, longDescription, compact);

  assert.notEqual(longRender.sha256, shortRender.sha256);
  assert.equal(longRender.sha256, repeated.sha256);
  assert.deepEqual(longRender.warnings, repeated.warnings);
  assert.match(longRender.warnings.join("\n"), /description font reduced/u);
});

test("shrinks a long name and reports explicit overflow when text cannot fit", async () => {
  const layout = loadCardLayout();
  const clean = cleanPng();
  const narrowName = cloneLayout(layout);
  narrowName.name.width = 400;
  const fitted = await renderCard(clean, { ...metadata, name: "Furball Hyper Combo" }, narrowName);
  assert.match(fitted.warnings.join("\n"), /name font reduced/u);

  const impossible = cloneLayout(layout);
  impossible.description.width = 40;
  impossible.description.max_lines = 1;
  impossible.description.min_font_size = impossible.description.font_size;
  await assert.rejects(
    renderCard(clean, { ...metadata, description: "Important gameplay text must never disappear" }, impossible),
    (error: unknown) => error instanceof TextOverflowError && error.field === "description"
  );
});

test("rejects clean bytes that are not a decodable image", async () => {
  await assert.rejects(() => renderCard(Uint8Array.of(1, 2, 3), metadata, loadCardLayout()), /decodable image/);
});
