import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CatalogCard } from "./catalog.ts";
import { acquireCardImage } from "./downloader.ts";
import { exportGameCardPackage, type GameVisualSource } from "./game-card-exporter.ts";
import {
  assertMetadataIdentity,
  cardStudioPaths,
  getCleanAssetState,
  importCleanBase,
  loadGameMetadata,
  saveGameMetadata,
  type CardGameMetadata
} from "./card-studio.ts";
import { parseGameMetadata } from "./game-metadata.ts";
import { loadCardLayout } from "./card-layout.ts";
import { renderCard } from "./card-renderer.ts";

export interface CardStudioServiceOptions {
  root: string;
  layoutPath: string;
  imageCache?: string;
  fetchImpl?: typeof fetch;
}

async function atomicReplace(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  try {
    await rename(temporary, path);
  } catch (error) {
    if (!new Set(["EEXIST", "EPERM"]).has((error as NodeJS.ErrnoException).code ?? "")) throw error;
    await rm(path, { force: true });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export function createCardStudioService(options: CardStudioServiceOptions) {
  const layout = loadCardLayout(options.layoutPath);

  const load = async (card: CatalogCard) => {
    const [stored, clean] = await Promise.all([
      loadGameMetadata(card, options.root),
      getCleanAssetState(card, options.root)
    ]);
    return {
      source: card,
      metadata: stored.metadata,
      metadataStatus: stored.status,
      metadataSourceSchemaVersion: stored.sourceSchemaVersion,
      metadataMigrated: stored.migrated,
      clean
    };
  };

  const saveMetadata = async (card: CatalogCard, metadata: CardGameMetadata) => {
    await saveGameMetadata(card, metadata, options.root);
    return load(card);
  };

  const importClean = async (card: CatalogCard, sourcePath: string, replace = false) => {
    await importCleanBase(card, sourcePath, { root: options.root, replace });
    return load(card);
  };

  const render = async (card: CatalogCard, metadata: CardGameMetadata) => {
    const validated = parseGameMetadata(metadata);
    assertMetadataIdentity(validated, card);
    const clean = await getCleanAssetState(card, options.root);
    if (!clean.available || !clean.sha256) throw new Error("Clean visual not available");
    const cleanBytes = new Uint8Array(await readFile(clean.path));
    const result = await renderCard(cleanBytes, validated, layout);
    return { ...result, cleanSha256: clean.sha256 };
  };

  const exportRendered = async (card: CatalogCard, metadata: CardGameMetadata) => {
    const rendered = await render(card, metadata);
    const path = cardStudioPaths(card, options.root).rendered;
    await atomicReplace(path, rendered.bytes);
    return { path, sha256: rendered.sha256, cleanSha256: rendered.cleanSha256, warnings: rendered.warnings };
  };

  const exportGameCard = async (card: CatalogCard, metadata: CardGameMetadata, visualSource: GameVisualSource, exportRoot: string) => {
    const validated = parseGameMetadata(metadata);
    assertMetadataIdentity(validated, card);
    let imageBytes: Uint8Array;
    if (visualSource === "original") {
      imageBytes = (await acquireCardImage(card, {
        cacheDir: options.imageCache,
        fetchImpl: options.fetchImpl
      })).bytes;
    } else if (visualSource === "rendered") {
      imageBytes = (await render(card, validated)).bytes;
    } else {
      throw new Error("Invalid game visual source");
    }
    return exportGameCardPackage({ card, metadata: validated, visualSource, imageBytes, exportRoot });
  };

  return { load, saveMetadata, importClean, render, exportRendered, exportGameCard, layout };
}
