import type { PortableTextBlock, SanityCard } from "./source.ts";
import { SANITY_API_VERSION, SANITY_DATASET, SANITY_PROJECT_ID } from "./source.ts";
import { snakeCase } from "./naming.ts";

export interface CatalogCard {
  name: string;
  id: string;
  slug: string;
  local_name: string;
  /** Omitted for legacy Sanity part cards. */
  card_origin?: CardOrigin;
  /** Required for equipment cards and omitted for part cards. */
  equipment_slot?: EquipmentSlot;
  class: string | null;
  class_id: string | null;
  part: string | null;
  part_id: string | null;
  image_url: string | null;
  image_asset_id: string | null;
  image_original_filename: string | null;
  image_mime_type: string | null;
  image_size: number | null;
  image_sha1: string | null;
  image_dimensions: { width: number; height: number; aspectRatio: number } | null;
  cost: number | null;
  effect: string | null;
  card_type: null;
  body_text: string[];
  created_at: string;
  updated_at: string;
  source: {
    provider: "Sanity" | "Equipment Registry";
    project_id: string;
    dataset: string;
    api_version: string;
    document_id: string;
  };
}

export type CardOrigin = "part" | "equipment";
export type EquipmentSlot = "weapon" | "shield" | "helmet" | "boots";

export function portableTextLines(body: PortableTextBlock[] | null): string[] {
  if (!body) return [];
  return body
    .filter((block) => block._type === "block" && Array.isArray(block.children))
    .map((block) => block.children!.map((child) => child.text ?? "").join("").trim())
    .filter(Boolean);
}

function structuredText(lines: string[]): { cost: number | null; effect: string | null } {
  let cost: number | null = null;
  const effectLines: string[] = [];
  for (const line of lines) {
    const match = line.match(/^Mana:\s*(\d+)$/i);
    if (match) cost = Number(match[1]);
    else effectLines.push(line);
  }
  return { cost, effect: effectLines.length ? effectLines.join("\n") : null };
}

export function toCatalogCard(card: SanityCard): CatalogCard {
  const bodyText = portableTextLines(card.body);
  const text = structuredText(bodyText);
  return {
    name: card.title,
    id: card._id,
    slug: card.slug,
    local_name: snakeCase(card.slug || card.title),
    class: card.class?.title ?? null,
    class_id: card.class?._id ?? null,
    part: card.part?.title ?? null,
    part_id: card.part?._id ?? null,
    image_url: card.asset?.url ?? null,
    image_asset_id: card.asset?._id ?? null,
    image_original_filename: card.asset?.originalFilename ?? null,
    image_mime_type: card.asset?.mimeType ?? null,
    image_size: card.asset?.size ?? null,
    image_sha1: card.asset?.sha1hash ?? null,
    image_dimensions: card.asset?.dimensions ?? null,
    cost: text.cost,
    effect: text.effect,
    card_type: null,
    body_text: bodyText,
    created_at: card._createdAt,
    updated_at: card._updatedAt,
    source: {
      provider: "Sanity",
      project_id: SANITY_PROJECT_ID,
      dataset: SANITY_DATASET,
      api_version: SANITY_API_VERSION,
      document_id: card._id
    }
  };
}

export function buildCatalog(cards: SanityCard[]): CatalogCard[] {
  return cards.map(toCatalogCard).sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}

export function findCard(catalog: CatalogCard[], query: string): CatalogCard {
  const normalized = snakeCase(query);
  const candidates = catalog.filter((card) =>
    snakeCase(card.name) === normalized || snakeCase(card.slug) === normalized || card.local_name === normalized
  );
  if (!candidates.length) throw new Error(`Card not found: ${query}`);
  if (candidates.length === 1) return candidates[0];
  const canonical = candidates.find((card) => snakeCase(card.slug) === normalized);
  if (canonical) return canonical;
  throw new Error(`Ambiguous card name "${query}". Use one of these slugs: ${candidates.map((card) => card.slug).join(", ")}`);
}

export function summarizeCatalog(catalog: CatalogCard[]) {
  const byClass: Record<string, number> = {};
  for (const card of catalog) {
    const key = card.class ?? "Unknown";
    byClass[key] = (byClass[key] ?? 0) + 1;
  }
  const duplicateNames = Object.entries(
    catalog.reduce<Record<string, number>>((counts, card) => {
      counts[card.name] = (counts[card.name] ?? 0) + 1;
      return counts;
    }, {})
  ).filter(([, count]) => count > 1).map(([name, count]) => ({ name, count }));
  return {
    total: catalog.length,
    by_class: Object.fromEntries(Object.entries(byClass).sort(([a], [b]) => a.localeCompare(b))),
    cards_with_structured_body: catalog.filter((card) => card.body_text.length > 0).length,
    unique_display_names: new Set(catalog.map((card) => card.name)).size,
    duplicate_display_names: duplicateNames
  };
}
