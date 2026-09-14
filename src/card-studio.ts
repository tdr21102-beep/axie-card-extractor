import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadImage } from "@napi-rs/canvas";
import type { CatalogCard } from "./catalog.ts";
import { sha256 } from "./downloader.ts";
import { classDirectory, snakeCase } from "./naming.ts";

export interface CardGameMetadata {
  id: string;
  name: string;
  class: string;
  part: string;
  cost: number | null;
  value: number | null;
  card_type: string;
  description: string;
}

export interface CleanAssetState {
  available: boolean;
  path: string;
  sha256: string | null;
}

export interface CardStudioPaths {
  clean: string;
  data: string;
  rendered: string;
}

export interface LoadedGameMetadata {
  metadata: CardGameMetadata;
  status: "default" | "saved";
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
    ...localIdentity(card),
    name: card.name,
    cost: null,
    value: null,
    card_type: "",
    description: ""
  };
}

function requiredString(candidate: Record<string, unknown>, key: keyof CardGameMetadata, max: number): string {
  const value = candidate[key];
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(`Invalid game metadata ${key}`);
  }
  return value;
}

function optionalNumber(candidate: Record<string, unknown>, key: "cost" | "value"): number | null {
  const value = candidate[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 9999) {
    throw new Error(`Invalid game metadata ${key}`);
  }
  return value;
}

export function validateGameMetadata(value: unknown): CardGameMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid game metadata");
  const candidate = value as Record<string, unknown>;
  return {
    id: requiredString(candidate, "id", 200),
    name: requiredString(candidate, "name", 200),
    class: requiredString(candidate, "class", 100),
    part: requiredString(candidate, "part", 100),
    cost: optionalNumber(candidate, "cost"),
    value: optionalNumber(candidate, "value"),
    card_type: typeof candidate.card_type === "string" && candidate.card_type.length <= 100
      ? candidate.card_type
      : (() => { throw new Error("Invalid game metadata card_type"); })(),
    description: typeof candidate.description === "string" && candidate.description.length <= 10_000
      ? candidate.description
      : (() => { throw new Error("Invalid game metadata description"); })()
  };
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
    const metadata = validateGameMetadata(JSON.parse(await readFile(path, "utf8")));
    assertMetadataIdentity(metadata, card);
    return { metadata, status: "saved" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { metadata: defaultGameMetadata(card), status: "default" };
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
    return { available: true, path, sha256: sha256(bytes) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { available: false, path, sha256: null };
    throw error;
  }
}

async function assertPng(bytes: Uint8Array): Promise<void> {
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
  await assertPng(sourceBytes);
  const target = cardStudioPaths(card, options.root).clean;
  try {
    const existing = await readFile(target);
    if (existing.equals(sourceBytes)) return { available: true, path: target, sha256: sha256(existing) };
    if (!options.replace) throw new Error(`Clean asset conflict: ${target} already exists with different contents`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await atomicWrite(target, sourceBytes);
  return { available: true, path: target, sha256: sha256(sourceBytes) };
}
