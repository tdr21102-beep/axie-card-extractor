import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

async function validCache(path: string, card: CatalogCard): Promise<Uint8Array | null> {
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
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

export async function downloadCard(card: CatalogCard, options: {
  root?: string;
  cacheDir?: string;
  fetchImpl?: typeof fetch;
} = {}) {
  if (!card.image_url || !card.image_asset_id) throw new Error(`Card ${card.name} has no source image`);
  const root = resolve(options.root ?? ".");
  const extension = extname(new URL(card.image_url).pathname) || ".bin";
  const safeAsset = card.image_asset_id.replace(/[^a-zA-Z0-9._-]/g, "_");
  const cachePath = resolve(options.cacheDir ?? resolve(root, "cache/images"), `${safeAsset}${extension}`);
  let bytes = await validCache(cachePath, card);
  const cache = bytes ? "hit" : "miss";

  if (!bytes) {
    const response = await (options.fetchImpl ?? fetch)(card.image_url, {
      headers: { accept: card.image_mime_type ?? "application/octet-stream", "user-agent": "axie-card-extractor-poc/0.1" }
    });
    if (!response.ok) throw new Error(`Image download failed: ${response.status} ${response.statusText}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    if (card.image_size !== null && bytes.byteLength !== card.image_size) {
      throw new Error(`Image size mismatch: expected ${card.image_size}, got ${bytes.byteLength}`);
    }
    if (card.image_sha1 && sha1(bytes) !== card.image_sha1) throw new Error("Image SHA-1 does not match Sanity asset metadata");
    await atomicWrite(cachePath, bytes);
  }

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
    sha1: sha1(bytes),
    sha256: sha256(bytes),
    cache,
    raw_image_path: paths.image
  };
  await atomicWrite(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`);
  return { card, paths, metadata };
}
