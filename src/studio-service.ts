import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CatalogCard } from "./catalog.ts";
import { acquireCardImage } from "./downloader.ts";
import { exportGameCardPackage, exportIndividualGameCard, type GameVisualSource } from "./game-card-exporter.ts";
import {
  assertValidPng,
  assertMetadataIdentity,
  cardStudioPaths,
  getCleanAssetState,
  importCleanBase,
  loadCardVisualLayoutOverrides,
  loadGameMetadata,
  saveCardVisualLayoutOverrides,
  saveGameMetadata,
  type CardGameMetadata
} from "./card-studio.ts";
import {
  applyCardVisualLayoutOverrides,
  effectiveVisualLayout,
  visualLayoutRenderingContext,
  type CardVisualLayoutOverrides
} from "./card-layout-overrides.ts";
import { assertGameMetadataGameReady, parseGameMetadata } from "./game-metadata.ts";
import { loadCardLayout } from "./card-layout.ts";
import { renderCard } from "./card-renderer.ts";

export interface CardStudioServiceOptions {
  root: string;
  layoutPath: string;
  imageCache?: string;
  assetRoot?: string;
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
  // Keep the active layout in service state. Reload parses a fresh disk copy
  // and only swaps it after validation succeeds, preserving the last good
  // renderer configuration when an editor has a malformed intermediate file.
  let layout = loadCardLayout(options.layoutPath);

  const reloadLayout = () => {
    const nextLayout = loadCardLayout(options.layoutPath);
    layout = nextLayout;
    return nextLayout;
  };

  const load = async (card: CatalogCard) => {
    const [stored, clean, visualLayoutOverrides] = await Promise.all([
      loadGameMetadata(card, options.root),
      getCleanAssetState(card, options.root),
      loadCardVisualLayoutOverrides(card, options.root)
    ]);
    return {
      source: card,
      metadata: stored.metadata,
      metadataStatus: stored.status,
      metadataSourceSchemaVersion: stored.sourceSchemaVersion,
      metadataMigrated: stored.migrated,
      clean,
      visualLayoutOverrides,
      effectiveVisualLayout: effectiveVisualLayout(layout, visualLayoutOverrides),
      visualLayoutRendering: visualLayoutRenderingContext(layout)
    };
  };

  const saveMetadata = async (card: CatalogCard, metadata: CardGameMetadata, visualLayoutOverrides?: CardVisualLayoutOverrides) => {
    await saveGameMetadata(card, metadata, options.root);
    if (visualLayoutOverrides !== undefined) await saveCardVisualLayoutOverrides(card, visualLayoutOverrides, options.root);
    return load(card);
  };

  const importClean = async (card: CatalogCard, sourcePath: string, replace = false) => {
    const paths = cardStudioPaths(card, options.root);
    const sourceBytes = await readFile(sourcePath);
    await assertValidPng(sourceBytes);
    let existing: Buffer | null = null;
    try {
      existing = await readFile(paths.clean);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing?.equals(sourceBytes)) return load(card);
    if (existing && !replace) {
      throw new Error(`Clean asset conflict: ${paths.clean} already exists with different contents`);
    }
    // Invalidate the derived render before committing a different clean base.
    // If Windows cannot remove it (for example because it is locked), the
    // existing clean stays committed and the replacement fails safely.
    await rm(paths.rendered, { force: true });
    await importCleanBase(card, sourcePath, { root: options.root, replace });
    return load(card);
  };

  const render = async (card: CatalogCard, metadata: CardGameMetadata, visualLayoutOverrides?: CardVisualLayoutOverrides) => {
    const validated = parseGameMetadata(metadata);
    assertMetadataIdentity(validated, card);
    const clean = await getCleanAssetState(card, options.root);
    if (!clean.available || !clean.sha256) throw new Error("Clean visual not available");
    const cleanBytes = new Uint8Array(await readFile(clean.path));
    const overrides = visualLayoutOverrides ?? await loadCardVisualLayoutOverrides(card, options.root);
    const resolvedLayout = applyCardVisualLayoutOverrides(layout, overrides);
    const result = await renderCard(cleanBytes, validated, resolvedLayout);
    return { ...result, cleanSha256: clean.sha256, effectiveVisualLayout: effectiveVisualLayout(layout, overrides), visualLayoutRendering: visualLayoutRenderingContext(layout) };
  };

  const exportRendered = async (card: CatalogCard, metadata: CardGameMetadata, visualLayoutOverrides?: CardVisualLayoutOverrides) => {
    const rendered = await render(card, metadata, visualLayoutOverrides);
    const path = cardStudioPaths(card, options.root).rendered;
    await atomicReplace(path, rendered.bytes);
    return { path, sha256: rendered.sha256, cleanSha256: rendered.cleanSha256, warnings: rendered.warnings };
  };

  const exportGameCardWith = async (
    card: CatalogCard,
    metadata: CardGameMetadata,
    visualLayoutOverrides: CardVisualLayoutOverrides | undefined,
    visualSource: GameVisualSource,
    exportRoot: string,
    write: typeof exportGameCardPackage
  ) => {
    const validated = parseGameMetadata(metadata);
    assertMetadataIdentity(validated, card);
    // Block invalid gameplay before fetching a source image or rendering. Draft
    // metadata remains saveable, but only explicitly configured gameplay can be
    // published as a game card.
    assertGameMetadataGameReady(validated);
    let imageBytes: Uint8Array;
    if (visualSource === "original") {
      imageBytes = (await acquireCardImage(card, {
        cacheDir: options.imageCache,
        assetRoot: options.assetRoot,
        fetchImpl: options.fetchImpl
      })).bytes;
    } else if (visualSource === "rendered") {
      imageBytes = (await render(card, validated, visualLayoutOverrides)).bytes;
    } else {
      throw new Error("Invalid game visual source");
    }
    return write({ card, metadata: validated, visualSource, imageBytes, exportRoot });
  };

  const exportGameCard = (card: CatalogCard, metadata: CardGameMetadata, visualSource: GameVisualSource, exportRoot: string, visualLayoutOverrides?: CardVisualLayoutOverrides) =>
    exportGameCardWith(card, metadata, visualLayoutOverrides, visualSource, exportRoot, exportGameCardPackage);

  const exportIndividualGameCardFlat = (card: CatalogCard, metadata: CardGameMetadata, visualSource: GameVisualSource, exportRoot: string, visualLayoutOverrides?: CardVisualLayoutOverrides) =>
    exportGameCardWith(card, metadata, visualLayoutOverrides, visualSource, exportRoot, exportIndividualGameCard);

  return {
    load,
    saveMetadata,
    importClean,
    render,
    exportRendered,
    exportGameCard,
    exportIndividualGameCardFlat,
    reloadLayout,
    get layout() { return layout; }
  };
}
