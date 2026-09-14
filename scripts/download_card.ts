import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCatalog, findCard, type CatalogCard } from "../src/catalog.ts";
import { downloadCard } from "../src/downloader.ts";
import { fetchCards } from "../src/source.ts";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? null;
  // npm 10 on Windows consumes its own --name option before invoking the script.
  // Supporting the remaining positional value keeps the documented command portable.
  return process.argv.slice(2).find((value) => !value.startsWith("--")) ?? null;
}

const name = argument("--name");
if (!name) throw new Error('Usage: npm run download -- --name "Teal Shell"');

let catalog: CatalogCard[];
try {
  catalog = JSON.parse(await readFile(resolve("output/card_catalog.json"), "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  catalog = buildCatalog((await fetchCards()).cards);
}

const card = findCard(catalog, name);
const result = await downloadCard(card);
console.log(JSON.stringify(result.metadata, null, 2));
