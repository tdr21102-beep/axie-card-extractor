import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { isDeepStrictEqual } from "node:util";
import { cardStudioPaths, defaultGameMetadata } from "../src/card-studio.ts";
import { buildCatalog, findCard } from "../src/catalog.ts";
import { acquireCardImage, sha256 } from "../src/downloader.ts";
import { fetchCards } from "../src/source.ts";
import { createCardStudioService } from "../src/studio-service.ts";

const root = resolve("output/acceptance/card_studio");
const source = await fetchCards();
const catalog = buildCatalog(source.cards);
const furball = findCard(catalog, "Furball");
if (furball.class !== "Beast" || furball.part !== "Back") throw new Error("Furball source metadata mismatch");
const sourceBefore = JSON.stringify(furball);

const raw = await acquireCardImage(furball, { cacheDir: resolve("cache/images") });
const rawPath = resolve(root, "raw", "beast", "furball.png");
await mkdir(dirname(rawPath), { recursive: true });
await writeFile(rawPath, raw.bytes);
const rawHashBefore = sha256(await readFile(rawPath));

const fixtureCanvas = createCanvas(900, 1350);
const context = fixtureCanvas.getContext("2d", { alpha: true });
context.fillStyle = "#ead6a5";
context.fillRect(42, 42, 816, 1266);
context.fillStyle = "#7b3f2d";
context.fillRect(105, 150, 690, 810);
context.fillStyle = "#f3e8cb";
context.fillRect(120, 980, 660, 300);
const fixturePath = resolve(root, "fixtures", "furball_clean_test.png");
await mkdir(dirname(fixturePath), { recursive: true });
await writeFile(fixturePath, fixtureCanvas.toBuffer("image/png"));

const serviceOptions = { root, layoutPath: resolve("config/card_layout.json") };
const studio = createCardStudioService(serviceOptions);
const initial = await studio.load(furball);
const metadata = {
  ...defaultGameMetadata(furball),
  cost: 1,
  value: 40,
  card_type: "attack",
  description: "Deal 2 hits."
};
if (initial.metadataStatus !== "default" && !isDeepStrictEqual(initial.metadata, metadata)) {
  throw new Error("Unexpected pre-existing Furball metadata in isolated acceptance root");
}

const clean = await studio.importClean(furball, fixturePath, true);
await studio.saveMetadata(furball, metadata);
const reopened = await createCardStudioService(serviceOptions).load(furball);
if (reopened.metadataStatus !== "saved" || !isDeepStrictEqual(reopened.metadata, metadata)) {
  throw new Error("Saved metadata did not survive service restart");
}

const preview40 = await studio.render(furball, metadata);
const preview55 = await studio.render(furball, { ...metadata, value: 55 });
const previewDescription = await studio.render(furball, { ...metadata, description: "Deal 3 hits across two attacks." });
const fieldVariants = await Promise.all([
  studio.render(furball, { ...metadata, name: "Furball Prime" }),
  studio.render(furball, { ...metadata, cost: 2 }),
  preview55,
  studio.render(furball, { ...metadata, card_type: "skill" }),
  previewDescription
]);
const everyGameFieldChangesPreview = fieldVariants.every((preview) => preview.sha256 !== preview40.sha256);
if (!everyGameFieldChangesPreview) throw new Error("At least one gameplay field did not affect the preview");
if (preview40.sha256 === preview55.sha256) throw new Error("Changing value did not update the preview");
if (preview40.sha256 === previewDescription.sha256) throw new Error("Changing description did not update the preview");

const exported = await studio.exportRendered(furball, metadata);
const cleanHashAfter = sha256(await readFile(clean.clean.path));
const rawHashAfter = sha256(await readFile(rawPath));
if (clean.clean.sha256 !== cleanHashAfter) throw new Error("Clean PNG changed during rendering");
if (rawHashBefore !== rawHashAfter) throw new Error("RAW PNG changed during Card Studio acceptance");
if (exported.sha256 === cleanHashAfter) throw new Error("Rendered PNG must differ from the clean base");
if (JSON.stringify(furball) !== sourceBefore) throw new Error("Source metadata changed during Card Studio acceptance");

const report = {
  card: { sanity_id: furball.id, id: metadata.id, name: metadata.name, class: metadata.class, part: metadata.part },
  metadata: reopened.metadata,
  checks: {
    every_game_field_changes_preview: everyGameFieldChangesPreview,
    metadata_saved_and_reloaded: true,
    value_40_to_55_changes_preview: preview40.sha256 !== preview55.sha256,
    description_changes_preview: preview40.sha256 !== previewDescription.sha256,
    clean_hash_unchanged: clean.clean.sha256 === cleanHashAfter,
    rendered_differs_from_clean: exported.sha256 !== cleanHashAfter,
    raw_hash_unchanged: rawHashBefore === rawHashAfter,
    source_metadata_unchanged: JSON.stringify(furball) === sourceBefore
  },
  paths: { raw: rawPath, clean: clean.clean.path, metadata: cardStudioPaths(furball, root).data, rendered: exported.path },
  hashes: { raw: rawHashAfter, clean: cleanHashAfter, rendered: exported.sha256, preview_value_55: preview55.sha256, preview_description_changed: previewDescription.sha256 }
};
const reportPath = resolve(root, "acceptance_report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, report_path: reportPath }, null, 2));
