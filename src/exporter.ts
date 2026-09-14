import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import type { CatalogCard } from "./catalog.ts";
import { acquireCardImage, inspectCardCache, sha256 } from "./downloader.ts";
import { classDirectory } from "./naming.ts";
import type { CatalogFilters } from "./filters.ts";

export type OutputLayout = "by-class" | "flat";
export type ExportStatus = "success" | "failed" | "skipped";

export interface ExportedCard {
  sanity_id: string;
  name: string;
  class: string | null;
  part: string | null;
  local_filename: string;
  sha256: string | null;
  status: ExportStatus;
  cache: "hit" | "miss" | null;
  error: string | null;
  image_path: string | null;
  metadata_path: string | null;
}

export interface BatchReport {
  report_path: string;
  filters: CatalogFilters;
  layout: OutputLayout;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  cached: number;
  cards: ExportedCard[];
}

export class OutputConflictError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Output conflict: ${path} already exists with different contents`);
    this.name = "OutputConflictError";
    this.path = path;
  }
}

export function exportPaths(card: CatalogCard, exportRoot: string, layout: OutputLayout) {
  const extension = card.image_url ? extname(new URL(card.image_url).pathname) || ".bin" : ".bin";
  const className = classDirectory(card.class);
  const imageDirectory = layout === "by-class" ? resolve(exportRoot, className) : resolve(exportRoot);
  const metadataDirectory = layout === "by-class"
    ? resolve(exportRoot, "data", className)
    : resolve(exportRoot, "data");
  return {
    image: resolve(imageDirectory, `${card.local_name}${extension}`),
    metadata: resolve(metadataDirectory, `${card.local_name}.json`)
  };
}

async function writeIfSafe(path: string, bytes: Uint8Array | string): Promise<"written" | "identical"> {
  const expected = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, expected);
  try {
    await link(temporary, path);
    return "written";
  } catch (error) {
    try {
      const existing = await readFile(path);
      if (existing.equals(expected)) return "identical";
      throw new OutputConflictError(path);
    } catch (readError) {
      if ((readError as NodeJS.ErrnoException).code !== "ENOENT") throw readError;
    }
    if (!new Set(["EPERM", "ENOSYS", "ENOTSUP"]).has((error as NodeJS.ErrnoException).code ?? "")) throw error;
    let handle;
    try {
      handle = await open(path, "wx");
      await handle.writeFile(expected);
      await handle.sync();
      await handle.close();
      handle = undefined;
      return "written";
    } catch (fallbackError) {
      if (handle) {
        await handle.close().catch(() => undefined);
        await rm(path, { force: true }).catch(() => undefined);
      }
      if ((fallbackError as NodeJS.ErrnoException).code === "EEXIST") {
        const existing = await readFile(path);
        if (existing.equals(expected)) return "identical";
        throw new OutputConflictError(path);
      }
      throw fallbackError;
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeBatchReport(exportRoot: string, json: string): Promise<string> {
  for (let index = 1; index <= 10_000; index += 1) {
    const filename = index === 1 ? "batch_report.json" : `batch_report_${index}.json`;
    const path = resolve(exportRoot, filename);
    try {
      const result = await writeIfSafe(path, json);
      if (result === "written") return path;
    } catch (error) {
      if (!(error instanceof OutputConflictError)) throw error;
    }
  }
  throw new Error("Could not allocate a conflict-safe batch report filename");
}

export function exportedMetadata(card: CatalogCard, imageSha256: string) {
  return {
    name: card.name,
    local_name: card.local_name,
    slug: card.slug,
    sanity_id: card.id,
    class: card.class,
    part: card.part,
    image_url: card.image_url,
    body_text: card.body_text,
    mana: card.cost,
    cost: card.cost,
    effect: card.effect,
    card_type: card.card_type,
    sha256: imageSha256,
    source: card.source
  };
}

function friendlyError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "The image request timed out";
    return error.message;
  }
  return "Unknown export error";
}

export async function exportCard(card: CatalogCard, options: {
  exportRoot: string;
  cacheDir?: string;
  layout?: OutputLayout;
  exportMetadata?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ExportedCard> {
  const layout = options.layout ?? "by-class";
  const paths = exportPaths(card, options.exportRoot, layout);
  try {
    const acquired = await acquireCardImage(card, { cacheDir: options.cacheDir, fetchImpl: options.fetchImpl });
    const imageWrite = await writeIfSafe(paths.image, acquired.bytes);
    let metadataPath: string | null = null;
    if (options.exportMetadata ?? true) {
      const json = `${JSON.stringify(exportedMetadata(card, acquired.sha256), null, 2)}\n`;
      await writeIfSafe(paths.metadata, json);
      metadataPath = paths.metadata;
    }
    return {
      sanity_id: card.id,
      name: card.name,
      class: card.class,
      part: card.part,
      local_filename: paths.image.split(/[\\/]/).at(-1) ?? `${card.local_name}.png`,
      sha256: acquired.sha256,
      status: imageWrite === "identical" ? "skipped" : "success",
      cache: acquired.cache,
      error: null,
      image_path: paths.image,
      metadata_path: metadataPath
    };
  } catch (error) {
    return {
      sanity_id: card.id,
      name: card.name,
      class: card.class,
      part: card.part,
      local_filename: paths.image.split(/[\\/]/).at(-1) ?? `${card.local_name}.png`,
      sha256: null,
      status: "failed",
      cache: null,
      error: friendlyError(error),
      image_path: paths.image,
      metadata_path: null
    };
  }
}

export async function batchPlan(cards: CatalogCard[], cacheDir?: string) {
  const states = await Promise.all(cards.map((card) => inspectCardCache(card, cacheDir)));
  const cached = states.filter((state) => state.cached).length;
  return { total: cards.length, cached, needDownload: cards.length - cached };
}

export async function exportBatch(cards: CatalogCard[], options: {
  exportRoot: string;
  cacheDir?: string;
  layout: OutputLayout;
  exportMetadata: boolean;
  filters: CatalogFilters;
  fetchImpl?: typeof fetch;
}): Promise<BatchReport> {
  const results: ExportedCard[] = [];
  for (const card of cards) {
    results.push(await exportCard(card, options));
  }
  const report = {
    filters: options.filters,
    layout: options.layout,
    total: results.length,
    success: results.filter((result) => result.status === "success").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    cached: results.filter((result) => result.cache === "hit").length,
    cards: results
  };
  const reportPath = await writeBatchReport(options.exportRoot, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, report_path: reportPath };
}
