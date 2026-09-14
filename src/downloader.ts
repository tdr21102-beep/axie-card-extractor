import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import type { CatalogCard } from "./catalog.ts";
import { classDirectory } from "./naming.ts";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha1(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

export function outputPaths(card: CatalogCard, root = ".") {
  const extension = extname(new URL(card.image_url ?? "https://invalid/image.png").pathname) || ".bin";
  return {
    image: resolve(root, "output", "raw", classDirectory(card.class), `${card.local_name}${extension}`),
    metadata: resolve(root, "output", "data", `${card.local_name}.json`)
  };
}

export async function validCachedBytes(path: string, card: CatalogCard): Promise<Uint8Array | null> {
  try {
    const bytes = await readFile(path);
    if (card.image_size !== null && bytes.byteLength !== card.image_size) return null;
    if (card.image_sha1 && sha1(bytes) !== card.image_sha1) return null;
    return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(path: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  try {
    await rename(temporary, path);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    await rm(path, { force: true });
    await rename(temporary, path);
  }
}

export function cachePathForCard(card: CatalogCard, cacheDir = resolve("cache/images")): string {
  if (!card.image_url || !card.image_asset_id) throw new Error(`Card ${card.name} has no source image`);
  const extension = extname(new URL(card.image_url).pathname) || ".bin";
  const safeAsset = card.image_asset_id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return resolve(cacheDir, `${safeAsset}${extension}`);
}

export function validateImageBytes(bytes: Uint8Array, card: CatalogCard): void {
  if (card.image_size !== null && bytes.byteLength !== card.image_size) {
    throw new Error(`Image size mismatch: expected ${card.image_size}, got ${bytes.byteLength}`);
  }
  if (card.image_sha1 && sha1(bytes) !== card.image_sha1) throw new Error("Image SHA-1 does not match Sanity asset metadata");
  if (card.image_mime_type === "image/png") {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.byteLength < png.length || png.some((byte, index) => bytes[index] !== byte)) {
      throw new Error("Downloaded asset is not a valid PNG");
    }
  }
}

export async function inspectCardCache(card: CatalogCard, cacheDir?: string) {
  const path = cachePathForCard(card, cacheDir);
  const bytes = await validCachedBytes(path, card);
  return { cached: bytes !== null, sha256: bytes ? sha256(bytes) : null, path };
}

export interface AcquiredCardImage {
  bytes: Uint8Array;
  cache: "hit" | "miss";
  cachePath: string;
  sha1: string;
  sha256: string;
}

const imageDownloads = new Map<string, Promise<AcquiredCardImage>>();

async function acquireCardImageUncached(card: CatalogCard, options: {
  cacheDir?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<AcquiredCardImage> {
  if (!card.image_url || !card.image_asset_id) throw new Error(`Card ${card.name} has no source image`);
  const cachePath = cachePathForCard(card, options.cacheDir);
  let bytes = await validCachedBytes(cachePath, card);
  const cache: "hit" | "miss" = bytes ? "hit" : "miss";

  if (!bytes) {
    const response = await (options.fetchImpl ?? fetch)(card.image_url, {
      headers: { accept: card.image_mime_type ?? "application/octet-stream", "user-agent": "axie-card-extractor/1.0" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
    });
    if (!response.ok) throw new Error(`Image download failed: ${response.status} ${response.statusText}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    validateImageBytes(bytes, card);
    await atomicWrite(cachePath, bytes);
  }

  return { bytes, cache, cachePath, sha1: sha1(bytes), sha256: sha256(bytes) };
}

export function acquireCardImage(card: CatalogCard, options: {
  cacheDir?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<AcquiredCardImage> {
  const cachePath = cachePathForCard(card, options.cacheDir);
  const active = imageDownloads.get(cachePath);
  if (active) return active;
  const pending = acquireCardImageUncached(card, options);
  imageDownloads.set(cachePath, pending);
  const cleanup = () => {
    if (imageDownloads.get(cachePath) === pending) imageDownloads.delete(cachePath);
  };
  void pending.then(cleanup, cleanup);
  return pending;
}

export async function downloadCard(card: CatalogCard, options: {
  root?: string;
  cacheDir?: string;
  fetchImpl?: typeof fetch;
} = {}) {
  if (!card.image_url || !card.image_asset_id) throw new Error(`Card ${card.name} has no source image`);
  const root = resolve(options.root ?? ".");
  const acquired = await acquireCardImage(card, {
    cacheDir: options.cacheDir ?? resolve(root, "cache/images"),
    fetchImpl: options.fetchImpl
  });
  const { bytes, cachePath, cache } = acquired;

  const paths = outputPaths(card, root);
  await mkdir(dirname(paths.image), { recursive: true });
  await copyFile(cachePath, paths.image);
  const localBytes = await readFile(paths.image);
  if (!Buffer.from(localBytes).equals(Buffer.from(bytes))) throw new Error("Local output differs from downloaded source bytes");

  const metadata = {
    name: card.name,
    id: card.id,
    slug: card.slug,
    local_name: card.local_name,
    class: card.class,
    part: card.part,
    source_url: card.image_url,
    source_asset_id: card.image_asset_id,
    source_original_filename: card.image_original_filename,
    mime_type: card.image_mime_type,
    byte_length: bytes.byteLength,
    sha1: acquired.sha1,
    sha256: acquired.sha256,
    cache,
    raw_image_path: paths.image
  };
  await atomicWrite(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`);
  return { card, paths, metadata };
}
