import { resolve } from "node:path";
import { buildCatalog, findCard } from "../src/catalog.ts";
import { exportBatch, exportCard } from "../src/exporter.ts";
import { filterCatalog } from "../src/filters.ts";
import { fetchCards } from "../src/source.ts";

const source = await fetchCards();
const catalog = buildCatalog(source.cards);
if (catalog.length !== 192) throw new Error(`Expected 192 cards, received ${catalog.length}`);

const outputIndex = process.argv.indexOf("--output");
const outputRoot = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] ?? "output/acceptance" : "output/acceptance");
const cacheDir = resolve("cache/images");
const tealShell = findCard(catalog, "Teal Shell");
const cucumberSlice = findCard(catalog, "Cucumber Slice");
const nutCrackers = catalog.filter((card) => card.name === "Nut Cracker");
const expectedNutNames = ["nut_cracker", "nut_cracker_ears", "nut_cracker_tail"];
if (JSON.stringify(nutCrackers.map((card) => card.local_name).sort()) !== JSON.stringify(expectedNutNames)) {
  throw new Error("Nut Cracker variants are not collision-safe");
}
if (tealShell.class !== "Aqua" || tealShell.part !== "Horn") throw new Error("Teal Shell metadata mismatch");
if (cucumberSlice.class !== "Plant" || cucumberSlice.part !== "Eyes") throw new Error("Cucumber Slice metadata mismatch");

const teal = await exportCard(tealShell, { exportRoot: resolve(outputRoot, "single"), cacheDir, exportMetadata: true });
const cucumber = await exportCard(cucumberSlice, { exportRoot: resolve(outputRoot, "single"), cacheDir, exportMetadata: true });
for (const result of [teal, cucumber]) {
  if (result.status === "failed" || !result.sha256 || result.sha256.length !== 64) {
    throw new Error(`${result.name} acceptance failed: ${result.error ?? "missing verified SHA-256"}`);
  }
}
const nutReport = await exportBatch(nutCrackers, {
  exportRoot: resolve(outputRoot, "nut_variants"),
  cacheDir,
  layout: "flat",
  exportMetadata: true,
  filters: { search: "Nut Cracker", className: null, part: null }
});
const aquaFilters = { search: "", className: "Aqua", part: null };
const aqua = filterCatalog(catalog, aquaFilters);
if (aqua.length !== 32) throw new Error(`Expected 32 Aqua cards, received ${aqua.length}`);
const aquaReport = await exportBatch(aqua, {
  exportRoot: resolve(outputRoot, "aqua_batch"),
  cacheDir,
  layout: "by-class",
  exportMetadata: true,
  filters: aquaFilters
});
if (nutReport.failed !== 0 || nutReport.total !== 3) throw new Error(`Nut Cracker batch failed for ${nutReport.failed} cards`);
if (aquaReport.failed !== 0 || aquaReport.total !== 32) throw new Error(`Aqua batch failed for ${aquaReport.failed} cards`);

console.log(JSON.stringify({
  catalog_total: catalog.length,
  source_cache: source.cache,
  teal_shell: teal,
  cucumber_slice: cucumber,
  nut_cracker: {
    local_names: nutCrackers.map((card) => card.local_name),
    success: nutReport.success,
    failed: nutReport.failed,
    skipped: nutReport.skipped
  },
  aqua_batch: {
    selected: aqua.length,
    success: aquaReport.success,
    failed: aquaReport.failed,
    skipped: aquaReport.skipped,
    cached: aquaReport.cached,
    report: aquaReport.report_path
  }
}, null, 2));
