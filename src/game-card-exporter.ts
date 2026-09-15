import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CatalogCard } from "./catalog.ts";
import { sha256 } from "./downloader.ts";
import { classDirectory, snakeCase } from "./naming.ts";
import { parseGameMetadata, type CardGameMetadata } from "./game-metadata.ts";

export const GAME_CARD_PACKAGE_SCHEMA_VERSION = 1 as const;
export type GameVisualSource = "original" | "rendered";
export type ExportedGameVisualSource = "original_placeholder" | "rendered";

export interface GameCardVisualReference {
  source: ExportedGameVisualSource;
  file: "card.png";
  sha256: string;
  warning: string | null;
}

export type GameCardDocument = CardGameMetadata & {
  package_schema_version: typeof GAME_CARD_PACKAGE_SCHEMA_VERSION;
  visual: GameCardVisualReference;
};

export interface GameCardExportResult {
  status: "success" | "skipped";
  directory: string;
  image_path: string;
  metadata_path: string;
  image_sha256: string;
  visual_source: ExportedGameVisualSource;
  document: GameCardDocument;
}

export class GameExportConflictError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Game export conflict: ${path} already exists with different contents`);
    this.name = "GameExportConflictError";
    this.path = path;
  }
}

export function gameCardExportPaths(card: CatalogCard, exportRoot: string) {
  const cardId = snakeCase(card.local_name);
  if (!cardId) throw new Error("Card has no valid local name for game export");
  const directory = resolve(exportRoot, "game_export", classDirectory(card.class), cardId);
  return { directory, image: resolve(directory, "card.png"), metadata: resolve(directory, "card.json") };
}

function buildGameCardDocument(metadataValue: unknown, source: GameVisualSource, imageHash: string): GameCardDocument {
  const metadata = parseGameMetadata(metadataValue);
  const visualSource: ExportedGameVisualSource = source === "original" ? "original_placeholder" : "rendered";
  return {
    ...metadata,
    package_schema_version: GAME_CARD_PACKAGE_SCHEMA_VERSION,
    visual: {
      source: visualSource,
      file: "card.png",
      sha256: imageHash,
      warning: source === "original" ? "Embedded text may not match Game Metadata" : null
    }
  };
}

export function validateGameCardDocument(value: unknown): GameCardDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Game card document must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.package_schema_version !== GAME_CARD_PACKAGE_SCHEMA_VERSION) throw new Error("Invalid game card package_schema_version");
  if (!candidate.visual || typeof candidate.visual !== "object" || Array.isArray(candidate.visual)) throw new Error("Invalid game card visual reference");
  const visual = candidate.visual as Record<string, unknown>;
  if (visual.source !== "original_placeholder" && visual.source !== "rendered") throw new Error("Invalid game card visual source");
  if (visual.file !== "card.png" || typeof visual.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(visual.sha256)) {
    throw new Error("Invalid game card visual file or SHA-256");
  }
  if (visual.warning !== null && typeof visual.warning !== "string") throw new Error("Invalid game card visual warning");
  const { package_schema_version: _packageVersion, visual: _visual, ...metadataValue } = candidate;
  const metadata = parseGameMetadata(metadataValue);
  return {
    ...metadata,
    package_schema_version: GAME_CARD_PACKAGE_SCHEMA_VERSION,
    visual: {
      source: visual.source,
      file: "card.png",
      sha256: visual.sha256,
      warning: visual.warning
    }
  };
}

async function classify(path: string, expected: Uint8Array): Promise<"missing" | "identical"> {
  try {
    const existing = await readFile(path);
    if (existing.equals(expected)) return "identical";
    throw new GameExportConflictError(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function writeNewOrIdentical(path: string, expected: Uint8Array): Promise<"written" | "identical"> {
  const before = await classify(path, expected);
  if (before === "identical") return "identical";
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, expected);
  try {
    try {
      await link(temporary, path);
      return "written";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return (await classify(path, expected)) === "identical" ? "identical" : writeNewOrIdentical(path, expected);
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
          return (await classify(path, expected)) === "identical" ? "identical" : writeNewOrIdentical(path, expected);
        }
        throw fallbackError;
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function exportGameCardPackage(input: {
  card: CatalogCard;
  metadata: unknown;
  visualSource: GameVisualSource;
  imageBytes: Uint8Array;
  exportRoot: string;
}): Promise<GameCardExportResult> {
  if (input.visualSource !== "original" && input.visualSource !== "rendered") throw new Error("Invalid game visual source");
  const imageBytes = Uint8Array.from(input.imageBytes);
  if (imageBytes.byteLength === 0) throw new Error("Game card image is empty");
  const imageHash = sha256(imageBytes);
  const document = buildGameCardDocument(input.metadata, input.visualSource, imageHash);
  const jsonBytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
  const paths = gameCardExportPaths(input.card, input.exportRoot);

  // Preflight both outputs so a known conflict never leaves half a package behind.
  const [imageState, metadataState] = await Promise.all([
    classify(paths.image, imageBytes),
    classify(paths.metadata, jsonBytes)
  ]);
  const imageWrite = imageState === "missing" ? await writeNewOrIdentical(paths.image, imageBytes) : "identical";
  const metadataWrite = metadataState === "missing" ? await writeNewOrIdentical(paths.metadata, jsonBytes) : "identical";
  return {
    status: imageWrite === "identical" && metadataWrite === "identical" ? "skipped" : "success",
    directory: paths.directory,
    image_path: paths.image,
    metadata_path: paths.metadata,
    image_sha256: imageHash,
    visual_source: document.visual.source,
    document
  };
}

export interface GameBatchItemResult {
  card_id: string;
  status: "success" | "skipped" | "failed";
  result: GameCardExportResult | null;
  error: string | null;
}

export async function exportGameCardsBatch<T>(items: T[], exportOne: (item: T) => Promise<GameCardExportResult>, cardId: (item: T) => string): Promise<GameBatchItemResult[]> {
  const results: GameBatchItemResult[] = [];
  for (const item of items) {
    try {
      const result = await exportOne(item);
      results.push({ card_id: cardId(item), status: result.status, result, error: null });
    } catch (error) {
      results.push({ card_id: cardId(item), status: "failed", result: null, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
