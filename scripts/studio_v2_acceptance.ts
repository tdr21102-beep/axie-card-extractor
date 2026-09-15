import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { isDeepStrictEqual } from "node:util";
import { cardStudioPaths, defaultGameMetadata } from "../src/card-studio.ts";
import { buildCatalog, findCard } from "../src/catalog.ts";
import { acquireCardImage, sha256 } from "../src/downloader.ts";
import { validateGameCardDocument } from "../src/game-card-exporter.ts";
import { validateGameMetadataDocument } from "../src/game-metadata.ts";
import { fetchCards } from "../src/source.ts";
import { createCardStudioService } from "../src/studio-service.ts";

const root = resolve("output/acceptance/card_studio_v2");
const source = await fetchCards();
const furball = findCard(buildCatalog(source.cards), "Furball");
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

const paths = cardStudioPaths(furball, root);
const v1 = {
  id: "furball", name: "Furball", class: "beast", part: "back",
  cost: 1, value: 40, card_type: "attack", description: "Deal 2 hits."
};
await mkdir(dirname(paths.data), { recursive: true });
const v1Text = `${JSON.stringify(v1, null, 2)}\n`;
await writeFile(paths.data, v1Text);

const serviceOptions = { root, layoutPath: resolve("config/card_layout.json"), imageCache: resolve("cache/images") };
const studio = createCardStudioService(serviceOptions);
const migrated = await studio.load(furball);
if (!migrated.metadataMigrated || migrated.metadataSourceSchemaVersion !== 1 || migrated.metadata.schema_version !== 2) {
  throw new Error("V1 metadata was not represented as V2 in memory");
}
if (await readFile(paths.data, "utf8") !== v1Text) throw new Error("Loading V1 rewrote the user file");

const metadata = {
  ...defaultGameMetadata(furball),
  cost: 1,
  value: 40,
  card_type: "attack",
  description: "Deal 2 hits.",
  targeting: { mode: "single_enemy" as const },
  effects: [{ id: "damage_1", type: "damage" as const, target: "selected" as const, amount: 20, hits: 2 }]
};
if (validateGameMetadataDocument(metadata).status !== "valid") throw new Error("Furball V2 metadata is not valid");

const clean = await studio.importClean(furball, fixturePath, true);
await studio.saveMetadata(furball, metadata);
const reopened = await createCardStudioService(serviceOptions).load(furball);
if (reopened.metadataSourceSchemaVersion !== 2 || reopened.metadataMigrated || !isDeepStrictEqual(reopened.metadata, metadata)) {
  throw new Error("Saved V2 metadata did not survive service restart");
}

const preview40 = await studio.render(furball, metadata);
const preview55 = await studio.render(furball, { ...metadata, value: 55 });
const previewDescription = await studio.render(furball, { ...metadata, description: "Deal 3 hits across two attacks." });
const hitsThree = { ...metadata, effects: [{ ...metadata.effects[0]!, hits: 3 }] };
if (hitsThree.effects[0]?.hits !== 3 || validateGameMetadataDocument(hitsThree).status !== "valid") {
  throw new Error("Changing Damage hits from 2 to 3 did not produce valid structured state");
}
if (preview40.sha256 === preview55.sha256) throw new Error("Changing value did not update the visual preview");
if (preview40.sha256 === previewDescription.sha256) throw new Error("Changing description did not update the visual preview");
const previewHitsThree = await studio.render(furball, hitsThree);
if (previewHitsThree.sha256 !== preview40.sha256) throw new Error("Renderer must remain decoupled from effects");

const rendered = await studio.exportRendered(furball, metadata);
const gameExport = await studio.exportGameCard(furball, metadata, "original", root);
const exportedOriginal = new Uint8Array(await readFile(gameExport.image_path));
const exportedDocument = validateGameCardDocument(JSON.parse(await readFile(gameExport.metadata_path, "utf8")));
const cleanHashAfter = sha256(await readFile(clean.clean.path));
const rawHashAfter = sha256(await readFile(rawPath));
if (clean.clean.sha256 !== cleanHashAfter) throw new Error("Clean PNG changed during rendering");
if (rawHashBefore !== rawHashAfter) throw new Error("RAW PNG changed during Card Studio acceptance");
if (!Buffer.from(exportedOriginal).equals(Buffer.from(raw.bytes))) throw new Error("Placeholder export is not byte-identical to original");
if (exportedDocument.visual.source !== "original_placeholder") throw new Error("Placeholder visual source was not recorded");
if (rendered.sha256 === cleanHashAfter) throw new Error("Rendered PNG must differ from the clean base");
if (JSON.stringify(furball) !== sourceBefore) throw new Error("Source metadata changed during Card Studio acceptance");

const report = {
  card: { sanity_id: furball.id, id: metadata.id, name: metadata.name, class: metadata.class, part: metadata.part },
  metadata: reopened.metadata,
  checks: {
    v1_loaded_without_rewrite: true,
    v1_represented_as_v2: true,
    v2_saved_and_reloaded: true,
    damage_amount_20: reopened.metadata.effects[0]?.type === "damage" && reopened.metadata.effects[0].amount === 20,
    damage_hits_2: reopened.metadata.effects[0]?.type === "damage" && reopened.metadata.effects[0].hits === 2,
    hits_2_to_3_updates_structured_state: hitsThree.effects[0]?.hits === 3,
    renderer_ignores_effects: previewHitsThree.sha256 === preview40.sha256,
    value_changes_preview: preview40.sha256 !== preview55.sha256,
    description_changes_preview: preview40.sha256 !== previewDescription.sha256,
    raw_hash_unchanged: rawHashBefore === rawHashAfter,
    clean_hash_unchanged: clean.clean.sha256 === cleanHashAfter,
    placeholder_byte_identical: Buffer.from(exportedOriginal).equals(Buffer.from(raw.bytes)),
    game_json_schema_valid: exportedDocument.schema_version === 2,
    source_metadata_unchanged: JSON.stringify(furball) === sourceBefore
  },
  paths: {
    raw: rawPath,
    clean: clean.clean.path,
    metadata: paths.data,
    rendered: rendered.path,
    game_card_png: gameExport.image_path,
    game_card_json: gameExport.metadata_path
  },
  hashes: { raw: rawHashAfter, clean: cleanHashAfter, rendered: rendered.sha256, placeholder: gameExport.image_sha256 }
};
const reportPath = resolve(root, "acceptance_report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, report_path: reportPath }, null, 2));
