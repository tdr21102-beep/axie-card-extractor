import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildCatalog, summarizeCatalog } from "../src/catalog.ts";
import { fetchCards } from "../src/source.ts";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

const refresh = process.argv.includes("--refresh") || process.env.npm_config_refresh === "true";
const source = await fetchCards({ refresh });
const catalog = buildCatalog(source.cards);
const summary = summarizeCatalog(catalog);
const catalogPath = resolve("output/card_catalog.json");
const summaryPath = resolve("output/catalog_summary.json");

await writeJson(catalogPath, catalog);
await writeJson(summaryPath, {
  ...summary,
  generated_at: new Date().toISOString(),
  source: {
    site: "https://origin-rosy.vercel.app/",
    provider: "Sanity",
    project_id: "tac9w5pw",
    dataset: "production"
  }
});

console.log(JSON.stringify({ catalog_path: catalogPath, summary_path: summaryPath, cache: source.cache, ...summary }, null, 2));
