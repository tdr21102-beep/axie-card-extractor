import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const SITE_URL = "https://origin-rosy.vercel.app/";
export const SANITY_PROJECT_ID = "tac9w5pw";
export const SANITY_DATASET = "production";
export const SANITY_API_VERSION = "2022-01-31";
export const SANITY_API_BASE = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${SANITY_DATASET}`;

export const CARD_QUERY = `*[_type == "card"] | order(title asc, slug.current asc){
  _id,
  _createdAt,
  _updatedAt,
  title,
  "slug": slug.current,
  body,
  "class": class->{_id,title},
  "part": part->{_id,title},
  mainImage,
  "asset": mainImage.asset->{
    _id,
    url,
    originalFilename,
    mimeType,
    size,
    sha1hash,
    "dimensions": metadata.dimensions,
    "hasAlpha": metadata.hasAlpha,
    "isOpaque": metadata.isOpaque
  }
}`;

export interface SanityReferenceValue {
  _id: string;
  title: string;
}

export interface PortableTextSpan {
  _type?: string;
  text?: string;
}

export interface PortableTextBlock {
  _type?: string;
  children?: PortableTextSpan[];
}

export interface SanityAsset {
  _id: string;
  url: string;
  originalFilename: string | null;
  mimeType: string;
  size: number;
  sha1hash: string;
  dimensions: { width: number; height: number; aspectRatio: number } | null;
  hasAlpha: boolean | null;
  isOpaque: boolean | null;
}

export interface SanityCard {
  _id: string;
  _createdAt: string;
  _updatedAt: string;
  title: string;
  slug: string;
  body: PortableTextBlock[] | null;
  class: SanityReferenceValue | null;
  part: SanityReferenceValue | null;
  mainImage: { asset?: { _ref?: string } } | null;
  asset: SanityAsset | null;
}

export interface SanityQueryResponse {
  query: string;
  result: SanityCard[];
  ms?: number;
}

export function queryUrl(query = CARD_QUERY): string {
  return `${SANITY_API_BASE}?query=${encodeURIComponent(query)}`;
}

function isCard(value: unknown): value is SanityCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Record<string, unknown>;
  return typeof card._id === "string" && typeof card.title === "string" && typeof card.slug === "string";
}

export function parseSanityCards(payload: unknown): SanityCard[] {
  if (!payload || typeof payload !== "object") throw new Error("Sanity response must be an object");
  const result = (payload as { result?: unknown }).result;
  if (!Array.isArray(result)) throw new Error("Sanity response is missing a result array");
  if (!result.every(isCard)) throw new Error("Sanity result contains an invalid card document");
  return result;
}

async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  try {
    await rename(temporary, path);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    await rm(path, { force: true });
    await rename(temporary, path);
  }
}

export async function fetchCards(options: {
  cachePath?: string;
  refresh?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<{ cards: SanityCard[]; cache: "hit" | "miss"; fetchedAt: string | null }> {
  const cachePath = resolve(options.cachePath ?? "cache/sanity_card_catalog_source.json");
  if (!options.refresh) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8"));
      return { cards: parseSanityCards(cached), cache: "hit", fetchedAt: cached.fetched_at ?? null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }

  const response = await (options.fetchImpl ?? fetch)(queryUrl(), {
    headers: { accept: "application/json", "user-agent": "axie-card-extractor/1.0" },
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
  });
  if (!response.ok) throw new Error(`Sanity query failed: ${response.status} ${response.statusText}`);
  const payload = await response.json() as SanityQueryResponse;
  const cards = parseSanityCards(payload);
  const fetchedAt = new Date().toISOString();
  await atomicWrite(cachePath, `${JSON.stringify({ ...payload, fetched_at: fetchedAt }, null, 2)}\n`);
  return { cards, cache: "miss", fetchedAt };
}
