import { randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { CatalogCard } from "./catalog.ts";
import { sha256 } from "./downloader.ts";
import {
  exportGameCardPackage,
  validateGameCardDocument,
  type GameCardExportResult,
  type GameVisualSource
} from "./game-card-exporter.ts";
import { classDirectory, snakeCase } from "./naming.ts";
import {
  GAME_SET_MANIFEST_SCHEMA_VERSION,
  type AxieSlot,
  type CardSetDocument,
  type GameSetExportItem,
  type GameSetExportReport,
  type GameSetExportResult,
  type GameSetManifest,
  type GameSetManifestCard,
  type ProductionCardState
} from "./production-contract.ts";
import { validateCardSetDocument } from "./card-sets.ts";

export interface GameSetExportCandidate {
  card: CatalogCard;
  production: ProductionCardState;
}

export type ExportGameSetCard = (
  card: CatalogCard,
  visualSource: GameVisualSource,
  temporaryExportRoot: string
) => Promise<GameCardExportResult>;

export interface GameSetExportInput {
  set: CardSetDocument;
  candidates: readonly GameSetExportCandidate[];
  visualSource: GameVisualSource;
  readyOnly: boolean;
  exportRoot: string;
  exportOne: ExportGameSetCard;
}

export class GameSetExportConflictError extends Error {
  readonly relativePath: string;

  constructor(relativePath: string) {
    super(`Game set export conflict: ${relativePath} already exists with different contents`);
    this.name = "GameSetExportConflictError";
    this.relativePath = relativePath;
  }
}

function posix(...parts: string[]): string {
  return parts.join("/");
}

async function classify(path: string, relativePath: string, expected: Uint8Array): Promise<"missing" | "identical"> {
  try {
    const existing = await readFile(path);
    if (existing.equals(expected)) return "identical";
    throw new GameSetExportConflictError(relativePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function writeNewOrIdentical(path: string, relativePath: string, expected: Uint8Array): Promise<"written" | "identical"> {
  const state = await classify(path, relativePath, expected);
  if (state === "identical") return state;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, expected, { flag: "wx" });
  try {
    try {
      await link(temporary, path);
      return "written";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const concurrent = await classify(path, relativePath, expected);
        return concurrent === "identical" ? "identical" : writeNewOrIdentical(path, relativePath, expected);
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
          const concurrent = await classify(path, relativePath, expected);
          return concurrent === "identical" ? "identical" : writeNewOrIdentical(path, relativePath, expected);
        }
        throw fallbackError;
      }
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function writePair(input: {
  first: { path: string; relativePath: string; bytes: Uint8Array };
  second: { path: string; relativePath: string; bytes: Uint8Array };
}): Promise<{ first: "written" | "identical"; second: "written" | "identical" }> {
  const [firstState, secondState] = await Promise.all([
    classify(input.first.path, input.first.relativePath, input.first.bytes),
    classify(input.second.path, input.second.relativePath, input.second.bytes)
  ]);
  const firstWrite = firstState === "missing"
    ? await writeNewOrIdentical(input.first.path, input.first.relativePath, input.first.bytes)
    : "identical";
  try {
    const secondWrite = secondState === "missing"
      ? await writeNewOrIdentical(input.second.path, input.second.relativePath, input.second.bytes)
      : "identical";
    return { first: firstWrite, second: secondWrite };
  } catch (error) {
    // A race after the two-file preflight must not leave a package that looks
    // complete. Only remove the first file when this invocation created it.
    if (firstWrite === "written") await rm(input.first.path, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeExecutionReport(directory: string, bytes: Uint8Array): Promise<string> {
  for (let index = 1; index <= 10_000; index += 1) {
    const filename = index === 1 ? "report.json" : `report_${index}.json`;
    const path = resolve(directory, filename);
    try {
      const result = await writeNewOrIdentical(path, filename, bytes);
      // Reports describe one execution. Even an identical prior report belongs
      // to a previous run, so continue until a new conflict-safe name is claimed.
      if (result === "written") return path;
    } catch (error) {
      if (!(error instanceof GameSetExportConflictError)) throw error;
    }
  }
  throw new Error("Could not allocate a conflict-safe game set report filename");
}

function portableError(error: unknown, roots: readonly string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const root of roots) {
    message = message.replaceAll(root, "<output>").replaceAll(root.replaceAll("\\", "/"), "<output>");
  }
  return message
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n]*/gu, "<path>")
    .replaceAll("\\", "/");
}

interface PlannedCandidate {
  candidate: GameSetExportCandidate;
  localId: string;
  cardClass: string;
  outputIdentity: string;
}

interface PreparedExport {
  catalogId: string;
  localId: string;
  item: GameSetExportItem;
  manifestCard: GameSetManifestCard;
  image: { path: string; relativePath: string; bytes: Uint8Array };
  metadata: { path: string; relativePath: string; bytes: Uint8Array };
  published: { first: "written" | "identical"; second: "written" | "identical" } | null;
}

function planCandidate(
  catalogId: string,
  candidate: GameSetExportCandidate | undefined,
  visualSource: GameVisualSource
): PlannedCandidate | string {
  if (!candidate) return "Card is not present in the source catalog";
  if (candidate.card.id !== catalogId || candidate.production.card_id !== catalogId) {
    return "Card production identity does not match the Card Set reference";
  }
  const localId = snakeCase(candidate.card.local_name);
  const cardClass = classDirectory(candidate.card.class);
  if (!localId) return "Card has no valid local identity";
  if (!cardClass) return "Card has no valid class directory";
  if (!candidate.production.game_ready || !candidate.production.exportable_visual_sources.includes(visualSource)) {
    return "Card is not Game Ready for the selected visual source";
  }
  return { candidate, localId, cardClass, outputIdentity: posix(cardClass, localId) };
}

function mapAxiesToExportedIds(axies: readonly AxieSlot[], localIdByCatalogId: ReadonlyMap<string, string>): AxieSlot[] {
  return axies.map((slot) => ({
    id: slot.id,
    name: slot.name,
    cards: slot.cards
      .map((cardId) => localIdByCatalogId.get(cardId))
      .filter((cardId): cardId is string => cardId !== undefined)
      .sort()
  }));
}

function buildManifest(set: CardSetDocument, prepared: readonly PreparedExport[]): GameSetManifest {
  const included = prepared.filter((entry) => entry.item.status !== "failed");
  const localIdByCatalogId = new Map(included.map((entry) => [entry.catalogId, entry.localId]));
  const cards = included.map((entry) => entry.manifestCard).sort((left, right) => left.card_id.localeCompare(right.card_id, "en"));
  return {
    schema_version: GAME_SET_MANIFEST_SCHEMA_VERSION,
    set_id: set.id,
    set_name: set.name,
    cards,
    axies: mapAxiesToExportedIds(set.axies, localIdByCatalogId),
    export: { card_count: cards.length }
  };
}

function buildReport(set: CardSetDocument, items: readonly GameSetExportItem[]): GameSetExportReport {
  return {
    schema_version: 1,
    set_id: set.id,
    requested: set.cards.length,
    success: items.filter((item) => item.status === "success").length,
    failed: items.filter((item) => item.status === "failed").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    cards: [...items]
  };
}

async function rollbackPublished(prepared: readonly PreparedExport[]): Promise<void> {
  for (const entry of [...prepared].reverse()) {
    if (entry.published?.second === "written") await rm(entry.metadata.path, { force: true }).catch(() => undefined);
    if (entry.published?.first === "written") await rm(entry.image.path, { force: true }).catch(() => undefined);
    entry.published = null;
  }
}

export async function exportGameSet(input: GameSetExportInput): Promise<GameSetExportResult> {
  if (input.visualSource !== "original" && input.visualSource !== "rendered") throw new Error("Invalid game visual source");
  if (typeof input.readyOnly !== "boolean") throw new Error("readyOnly must be a boolean");
  const set = validateCardSetDocument(input.set);
  const directory = resolve(input.exportRoot, "game_export", set.id);
  const candidateByCatalogId = new Map<string, GameSetExportCandidate>();
  for (const candidate of input.candidates) {
    if (candidateByCatalogId.has(candidate.card.id)) throw new Error(`Duplicate export candidate: ${candidate.card.id}`);
    candidateByCatalogId.set(candidate.card.id, candidate);
  }
  if (!input.readyOnly) {
    const outputOwners = new Map<string, string>();
    const blocked = set.cards.flatMap((catalogId) => {
      const planned = planCandidate(catalogId, candidateByCatalogId.get(catalogId), input.visualSource);
      if (typeof planned === "string") return [`${catalogId}: ${planned}`];
      const owner = outputOwners.get(planned.outputIdentity);
      if (owner) return [`${catalogId}: Output identity conflicts with ${owner}`];
      outputOwners.set(planned.outputIdentity, catalogId);
      return [];
    });
    if (blocked.length > 0) {
      throw new Error(`Game set export blocked before writing: ${blocked.join(", ")}`);
    }
  }
  const reportItems: GameSetExportItem[] = [];
  const prepared: PreparedExport[] = [];

  const outputOwners = new Map<string, string>();
  for (const catalogId of set.cards) {
    const planned = planCandidate(catalogId, candidateByCatalogId.get(catalogId), input.visualSource);
    if (typeof planned === "string") {
      reportItems.push({
        card_id: catalogId,
        status: input.readyOnly && planned === "Card is not Game Ready for the selected visual source" ? "skipped" : "failed",
        result: null,
        error: planned
      });
      continue;
    }
    const priorOwner = outputOwners.get(planned.outputIdentity);
    if (priorOwner) {
      reportItems.push({
        card_id: catalogId,
        status: "failed",
        result: null,
        error: `Output identity conflicts with ${priorOwner}`
      });
      continue;
    }
    outputOwners.set(planned.outputIdentity, catalogId);
    const { candidate, localId, cardClass } = planned;

    const relativeDirectory = posix("cards", cardClass, localId);
    const relativePng = posix(relativeDirectory, "card.png");
    const relativeJson = posix(relativeDirectory, "card.json");
    const finalPng = resolve(directory, ...relativePng.split("/"));
    const finalJson = resolve(directory, ...relativeJson.split("/"));
    const stagingRoot = await mkdtemp(join(tmpdir(), "axie-game-set-"));
    try {
      const staged = await input.exportOne(candidate.card, input.visualSource, stagingRoot);
      if (staged.document.id !== localId || staged.document.class !== cardClass) {
        throw new Error("Exported card identity does not match the source catalog card");
      }
      const [imageBytes, metadataBytes] = await Promise.all([
        readFile(staged.image_path),
        readFile(staged.metadata_path)
      ]);
      const document = validateGameCardDocument(JSON.parse(metadataBytes.toString("utf8")) as unknown);
      const imageHash = sha256(imageBytes);
      if (document.visual.sha256 !== imageHash || staged.image_sha256 !== imageHash) {
        throw new Error("Exported card image hash does not match its metadata");
      }
      const expectedVisualSource = input.visualSource === "original" ? "original_placeholder" : "rendered";
      if (document.visual.source !== expectedVisualSource || staged.visual_source !== expectedVisualSource) {
        throw new Error("Exported card visual source does not match the requested visual source");
      }
      const [imageState, metadataState] = await Promise.all([
        classify(finalPng, relativePng, imageBytes),
        classify(finalJson, relativeJson, metadataBytes)
      ]);
      const portableResult = {
        card_json: relativeJson,
        card_png: relativePng,
        sha256: imageHash,
        visual_source: document.visual.source
      };
      const status = imageState === "identical" && metadataState === "identical" ? "skipped" : "success";
      const item: GameSetExportItem = { card_id: catalogId, status, result: portableResult, error: null };
      reportItems.push(item);
      prepared.push({
        catalogId,
        localId,
        item,
        manifestCard: { card_id: localId, ...portableResult },
        image: { path: finalPng, relativePath: relativePng, bytes: imageBytes },
        metadata: { path: finalJson, relativePath: relativeJson, bytes: metadataBytes },
        published: null
      });
    } catch (error) {
      reportItems.push({ card_id: catalogId, status: "failed", result: null, error: portableError(error, [stagingRoot, directory]) });
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const manifestPath = resolve(directory, "manifest.json");
  const plannedManifest = buildManifest(set, prepared);
  const plannedManifestBytes = Buffer.from(`${JSON.stringify(plannedManifest, null, 2)}\n`, "utf8");
  try {
    await classify(manifestPath, "manifest.json", plannedManifestBytes);
  } catch (error) {
    const portable = portableError(error, [directory]);
    for (const entry of prepared) {
      if (entry.item.status === "success") {
        entry.item.status = "failed";
        entry.item.result = null;
        entry.item.error = portable;
      }
    }
    const conflictReport = buildReport(set, reportItems);
    await writeExecutionReport(directory, Buffer.from(`${JSON.stringify(conflictReport, null, 2)}\n`, "utf8"));
    throw error;
  }

  for (const entry of prepared) {
    try {
      entry.published = await writePair({ first: entry.image, second: entry.metadata });
      entry.item.status = entry.published.first === "identical" && entry.published.second === "identical" ? "skipped" : "success";
    } catch (error) {
      entry.item.status = "failed";
      entry.item.result = null;
      entry.item.error = portableError(error, [directory]);
    }
  }

  const manifest = buildManifest(set, prepared);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  try {
    await writeNewOrIdentical(manifestPath, "manifest.json", manifestBytes);
  } catch (error) {
    await rollbackPublished(prepared);
    const portable = portableError(error, [directory]);
    for (const entry of prepared) {
      if (entry.item.status === "success") {
        entry.item.status = "failed";
        entry.item.result = null;
        entry.item.error = portable;
      }
    }
    const conflictReport = buildReport(set, reportItems);
    await writeExecutionReport(directory, Buffer.from(`${JSON.stringify(conflictReport, null, 2)}\n`, "utf8"));
    throw error;
  }
  const report = buildReport(set, reportItems);
  const reportPath = await writeExecutionReport(directory, Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"));
  return { directory, manifest_path: manifestPath, report_path: reportPath, manifest, report };
}

export async function exportGameSetWithPackages(input: Omit<GameSetExportInput, "exportOne"> & {
  metadataFor(card: CatalogCard): unknown | Promise<unknown>;
  imageBytesFor(card: CatalogCard, visualSource: GameVisualSource): Uint8Array | Promise<Uint8Array>;
}): Promise<GameSetExportResult> {
  return exportGameSet({
    ...input,
    exportOne: async (card, visualSource, temporaryExportRoot) => exportGameCardPackage({
      card,
      metadata: await input.metadataFor(card),
      visualSource,
      imageBytes: await input.imageBytesFor(card, visualSource),
      exportRoot: temporaryExportRoot
    })
  });
}
