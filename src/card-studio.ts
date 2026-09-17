import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadImage } from "@napi-rs/canvas";
import type { CatalogCard } from "./catalog.ts";
import { sha256 } from "./downloader.ts";
import { classDirectory, snakeCase } from "./naming.ts";
import { GAME_METADATA_SCHEMA_VERSION, parseGameMetadata, type CardGameMetadata } from "./game-metadata.ts";
export type { CardGameMetadata } from "./game-metadata.ts";

export interface CleanAssetState {
  available: boolean;
  path: string;
  sha256: string | null;
  width: number | null;
  height: number | null;
  compatibility: "master" | "legacy" | null;
}

export interface CardStudioPaths {
  clean: string;
  data: string;
  rendered: string;
}

export interface LoadedGameMetadata {
  metadata: CardGameMetadata;
  status: "default" | "saved";
  sourceSchemaVersion: 1 | 2 | null;
  migrated: boolean;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertPngStructure(bytes: Uint8Array): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.byteLength;
  let chunkIndex = 0;
  let foundIdat = false;
  let foundIend = false;
  while (offset + 12 <= buffer.byteLength) {
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.byteLength) throw new Error("Clean base is not a complete PNG");
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(buffer.subarray(offset + 4, offset + 8 + length));
    if (actualCrc !== expectedCrc) throw new Error(`Clean base PNG has an invalid ${type} checksum`);
    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) throw new Error("Clean base PNG has no valid IHDR");
    if (type === "IHDR" && (buffer.readUInt32BE(offset + 8) < 1 || buffer.readUInt32BE(offset + 12) < 1)) {
      throw new Error("Clean base PNG has invalid dimensions");
    }
    if (type === "IDAT") foundIdat = true;
    if (type === "IEND") {
      if (length !== 0 || chunkEnd !== buffer.byteLength) throw new Error("Clean base PNG has an invalid IEND");
      foundIend = true;
      break;
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  if (!foundIdat || !foundIend) throw new Error("Clean base is not a complete PNG");
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 24) throw new Error("Clean base PNG has no valid IHDR");
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function classifyCleanBase(width: number, height: number): "master" | "legacy" {
  return width === 1024 && height === 1536 ? "master" : "legacy";
}

function localIdentity(card: CatalogCard): Pick<CardGameMetadata, "id" | "class" | "part"> {
  const id = snakeCase(card.local_name);
  if (!id) throw new Error("Card has no valid local name");
  return {
    id,
    class: classDirectory(card.class),
    part: card.part ? snakeCase(card.part) : "unknown"
  };
}

export function defaultGameMetadata(card: CatalogCard): CardGameMetadata {
  return {
    schema_version: GAME_METADATA_SCHEMA_VERSION,
    ...localIdentity(card),
    name: card.name,
    cost: null,
    value: null,
    card_type: "",
    description: "",
    targeting: { mode: "single_enemy" },
    effects: []
  };
}

export function validateGameMetadata(value: unknown): CardGameMetadata {
  return parseGameMetadata(value);
}

export function assertMetadataIdentity(metadata: CardGameMetadata, card: CatalogCard): void {
  const expected = localIdentity(card);
  if (metadata.id !== expected.id || metadata.class !== expected.class || metadata.part !== expected.part) {
    throw new Error("Game metadata identity does not match the source card");
  }
}

export function cardStudioPaths(card: CatalogCard, root = "."): CardStudioPaths {
  const identity = localIdentity(card);
  const base = resolve(root, "cards");
  return {
    clean: resolve(base, "clean", identity.class, `${identity.id}.png`),
    data: resolve(base, "data", identity.class, `${identity.id}.json`),
    rendered: resolve(base, "rendered", identity.class, `${identity.id}.png`)
  };
}

async function atomicWrite(path: string, bytes: Uint8Array | string): Promise<void> {
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

export async function loadGameMetadata(card: CatalogCard, root = "."): Promise<LoadedGameMetadata> {
  const path = cardStudioPaths(card, root).data;
  try {
    const document = JSON.parse(await readFile(path, "utf8")) as unknown;
    const sourceSchemaVersion = document && typeof document === "object" && !Array.isArray(document) && (document as Record<string, unknown>).schema_version === 2 ? 2 : 1;
    const metadata = validateGameMetadata(document);
    assertMetadataIdentity(metadata, card);
    return { metadata, status: "saved", sourceSchemaVersion, migrated: sourceSchemaVersion === 1 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { metadata: defaultGameMetadata(card), status: "default", sourceSchemaVersion: null, migrated: false };
    }
    throw error;
  }
}

export async function saveGameMetadata(
  card: CatalogCard,
  metadata: unknown,
  root = "."
): Promise<CardGameMetadata> {
  const validated = validateGameMetadata(metadata);
  assertMetadataIdentity(validated, card);
  await atomicWrite(cardStudioPaths(card, root).data, `${JSON.stringify(validated, null, 2)}\n`);
  return validated;
}

export async function getCleanAssetState(card: CatalogCard, root = "."): Promise<CleanAssetState> {
  const path = cardStudioPaths(card, root).clean;
  try {
    const bytes = await readFile(path);
    const { width, height } = pngDimensions(bytes);
    return { available: true, path, sha256: sha256(bytes), width, height, compatibility: classifyCleanBase(width, height) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { available: false, path, sha256: null, width: null, height: null, compatibility: null };
    throw error;
  }
}

export async function assertValidPng(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength < PNG_SIGNATURE.byteLength || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("Clean base is not a valid PNG");
  }
  assertPngStructure(bytes);
  try {
    const image = await loadImage(Buffer.from(bytes));
    if (image.width < 1 || image.height < 1) throw new Error("PNG has invalid dimensions");
  } catch {
    throw new Error("Clean base is not a decodable PNG");
  }
}

export async function importCleanBase(
  card: CatalogCard,
  sourcePath: string,
  options: { root?: string; replace?: boolean } = {}
): Promise<CleanAssetState> {
  const sourceBytes = await readFile(sourcePath);
  await assertValidPng(sourceBytes);
  const target = cardStudioPaths(card, options.root).clean;
  try {
    const existing = await readFile(target);
    if (existing.equals(sourceBytes)) {
      const { width, height } = pngDimensions(existing);
      return { available: true, path: target, sha256: sha256(existing), width, height, compatibility: classifyCleanBase(width, height) };
    }
    if (!options.replace) throw new Error(`Clean asset conflict: ${target} already exists with different contents`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // A different Clean Base invalidates every rendered derivative. Keep this
  // invariant at the shared import boundary as well as the service wrapper.
  await rm(cardStudioPaths(card, options.root).rendered, { force: true });
  await atomicWrite(target, sourceBytes);
  const { width, height } = pngDimensions(sourceBytes);
  return { available: true, path: target, sha256: sha256(sourceBytes), width, height, compatibility: classifyCleanBase(width, height) };
}
