import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildCatalog, summarizeCatalog } from "../src/catalog.ts";
import { CARD_QUERY, SANITY_API_VERSION, SANITY_DATASET, SANITY_PROJECT_ID, SITE_URL, fetchCards, queryUrl } from "../src/source.ts";

async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, path);
}

const htmlResponse = await fetch(SITE_URL, { headers: { "user-agent": "axie-card-extractor-poc/0.1" } });
if (!htmlResponse.ok) throw new Error(`Site fetch failed: ${htmlResponse.status}`);
const html = await htmlResponse.text();
const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
if (!nextDataMatch) throw new Error("The page does not contain __NEXT_DATA__");
const nextData = JSON.parse(nextDataMatch[1]);
const embeddedCards = nextData?.props?.pageProps?.allCards;
if (!Array.isArray(embeddedCards)) throw new Error("__NEXT_DATA__ does not contain pageProps.allCards");

const refresh = process.argv.includes("--refresh") || process.env.npm_config_refresh === "true";
const source = await fetchCards({ refresh });
const catalog = buildCatalog(source.cards);
const bundlePaths = [...html.matchAll(/(?:src|href)="([^"?]+_next\/static[^"?]+)"/g)].map((match) => match[1]);
const targetNames = ["Teal Shell", "Catfish", "Nut Cracker", "Cucumber Slice"];
const report = {
  inspected_at: new Date().toISOString(),
  site_url: SITE_URL,
  next_build_id: nextData.buildId ?? null,
  embedded_catalog_count: embeddedCards.length,
  bundle_paths: [...new Set(bundlePaths)],
  sanity: {
    project_id: SANITY_PROJECT_ID,
    dataset: SANITY_DATASET,
    api_version: SANITY_API_VERSION,
    public_read_access: true,
    groq: CARD_QUERY,
    query_url: queryUrl()
  },
  catalog: summarizeCatalog(catalog),
  schema_observations: {
    card_fields: ["_id", "_createdAt", "_updatedAt", "title", "slug", "body", "class", "part", "mainImage"],
    cards_with_body: catalog.filter((card) => card.body_text.length > 0).length,
    cards_without_body: catalog.filter((card) => card.body_text.length === 0).length,
    structured_cost_is_general: false,
    structured_effect_is_general: false,
    structured_card_type_exists: false
  },
  test_cards: catalog.filter((card) => targetNames.includes(card.name))
};

await atomicWrite(resolve("debug/source_snapshot.html"), html);
await atomicWrite(resolve("debug/source_report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
