import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildCatalog, findCard } from "../src/catalog.ts";
import { cardStudioPaths, defaultGameMetadata, getCleanAssetState } from "../src/card-studio.ts";
import { sha256 } from "../src/downloader.ts";
import { fetchCards } from "../src/source.ts";
import { createCardStudioService } from "../src/studio-service.ts";

const reportPath = resolve("output/acceptance/card_studio_v3_2/acceptance_report.json");
const catalog = buildCatalog((await fetchCards()).cards);
const catfish = findCard(catalog, "Catfish");
const paths = cardStudioPaths(catfish, resolve("."));
const clean = await getCleanAssetState(catfish, resolve("."));

if (!clean.available) {
  const report = {
    card: { id: catfish.id, name: catfish.name },
    status: "visual_acceptance_pending",
    reason: "Catfish Clean Base is not imported in the workspace; no PNG was generated.",
    clean_path: paths.clean,
    raw_preservation: "not_mutated"
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, report_path: reportPath }, null, 2));
} else {
  const cleanBefore = new Uint8Array(await readFile(clean.path));
  const metadata = {
    ...defaultGameMetadata(catfish),
    cost: 1,
    value: 30,
    card_type: "attack",
    description: "Deal 30 damage.",
    effects: [{ id: "damage_1", type: "damage" as const, target: "all_enemies" as const, amount: 30, hits: 1 }],
    targeting: { mode: "all_enemies" as const }
  };
  const studio = createCardStudioService({ root: resolve("."), layoutPath: resolve("config/card_layout.json"), imageCache: resolve("cache/images") });
  const first = await studio.render(catfish, metadata);
  const second = await studio.render(catfish, { ...metadata, description: "Deal 31 damage." });
  const cleanAfter = new Uint8Array(await readFile(clean.path));
  if (sha256(cleanBefore) !== clean.sha256 || sha256(cleanAfter) !== clean.sha256 || !Buffer.from(cleanBefore).equals(Buffer.from(cleanAfter))) {
    throw new Error("Catfish Clean Base bytes changed during acceptance");
  }
  if (first.sha256 === second.sha256) throw new Error("Metadata edits must change the rendered output");
  const report = {
    card: { id: catfish.id, name: catfish.name },
    status: "passed",
    clean: { path: clean.path, width: clean.width, height: clean.height, compatibility: clean.compatibility, sha256: clean.sha256 },
    checks: { clean_base_recognized: true, stable_sha256: true, metadata_renders: true, metadata_changes_rendered_only: true, raw_preservation: "not_mutated" }
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, report_path: reportPath }, null, 2));
}
