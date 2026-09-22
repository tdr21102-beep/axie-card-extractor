import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CatalogCard } from "./catalog.ts";
import { defaultGameMetadata } from "./card-studio.ts";
import { parseCardVisualLayoutOverrides, type CardVisualLayoutOverrides } from "./card-layout-overrides.ts";
import {
  STUDIO_DRAFT_SCHEMA_VERSION,
  type StudioDraftDocument,
  type StudioDraftResult
} from "./production-contract.ts";

export const STUDIO_DRAFT_MAX_BYTES = 1_048_576;

function assertJsonValue(value: unknown, path: string, ancestors: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite JSON numbers`);
    return;
  }
  if (typeof value !== "object") throw new Error(`${path} is not JSON serializable`);
  if (ancestors.has(value)) throw new Error(`${path} contains a circular reference`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, ancestors));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} must contain only plain JSON objects`);
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertJsonValue(item, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function validateDraftIdentity(card: CatalogCard, metadata: unknown): void {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Draft metadata must be an object");
  }
  const expected = defaultGameMetadata(card);
  const candidate = metadata as Record<string, unknown>;
  if (candidate.id !== expected.id || candidate.class !== expected.class || candidate.part !== expected.part) {
    throw new Error("Draft metadata identity does not match the source card");
  }
}

function serializeDraft(document: StudioDraftDocument): string {
  assertJsonValue(document, "$", new Set());
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > STUDIO_DRAFT_MAX_BYTES) {
    throw new Error(`Studio draft exceeds ${STUDIO_DRAFT_MAX_BYTES} bytes`);
  }
  return serialized;
}

export function studioDraftPath(card: CatalogCard, root = "."): string {
  const identity = defaultGameMetadata(card);
  return resolve(root, "cards", "drafts", identity.class, `${identity.id}.json`);
}

function validateStoredDraft(value: unknown, card: CatalogCard): StudioDraftDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Studio draft must be an object");
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => !new Set(["schema_version", "card_id", "metadata", "visual_layout"]).has(key))) {
    throw new Error("Studio draft contains unexpected fields");
  }
  if (input.schema_version !== STUDIO_DRAFT_SCHEMA_VERSION) throw new Error(`Studio draft schema_version must equal ${STUDIO_DRAFT_SCHEMA_VERSION}`);
  if (input.card_id !== card.id) throw new Error("Studio draft card identity does not match the source card");
  validateDraftIdentity(card, input.metadata);
  assertJsonValue(input.metadata, "$.metadata", new Set());
  const visualLayout = input.visual_layout === undefined ? undefined : parseCardVisualLayoutOverrides(input.visual_layout);
  return {
    schema_version: STUDIO_DRAFT_SCHEMA_VERSION,
    card_id: card.id,
    metadata: structuredClone(input.metadata),
    ...(visualLayout === undefined ? {} : { visual_layout: visualLayout })
  };
}

async function atomicWrite(path: string, bytes: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  try {
    await rename(temporary, path);
  } catch (error) {
    if (!new Set(["EEXIST", "EPERM"]).has((error as NodeJS.ErrnoException).code ?? "")) throw error;
    const backup = `${path}.${process.pid}.${randomUUID()}.backup`;
    let backedUp = false;
    try {
      try {
        await rename(path, backup);
        backedUp = true;
      } catch (backupError) {
        if ((backupError as NodeJS.ErrnoException).code !== "ENOENT") throw backupError;
      }
      await rename(temporary, path);
    } catch (replacementError) {
      if (backedUp) {
        try {
          await rename(backup, path);
          backedUp = false;
        } catch {
          // Preserve the backup for recovery if restoring the committed file fails.
        }
      }
      throw replacementError;
    }
    if (backedUp) await rm(backup, { force: true }).catch(() => undefined);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function loadStudioDraft(card: CatalogCard, root = "."): Promise<StudioDraftResult> {
  try {
    const serialized = await readFile(studioDraftPath(card, root), "utf8");
    if (Buffer.byteLength(serialized, "utf8") > STUDIO_DRAFT_MAX_BYTES) {
      throw new Error(`Studio draft exceeds ${STUDIO_DRAFT_MAX_BYTES} bytes`);
    }
    const draft = validateStoredDraft(JSON.parse(serialized) as unknown, card);
    return { available: true, draft };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { available: false, draft: null };
    throw error;
  }
}

export async function saveStudioDraft(
  card: CatalogCard,
  metadata: unknown,
  root = ".",
  visualLayoutOverrides?: CardVisualLayoutOverrides
): Promise<StudioDraftResult> {
  validateDraftIdentity(card, metadata);
  const draft: StudioDraftDocument = {
    schema_version: STUDIO_DRAFT_SCHEMA_VERSION,
    card_id: card.id,
    metadata: structuredClone(metadata),
    ...(visualLayoutOverrides === undefined ? {} : { visual_layout: parseCardVisualLayoutOverrides(visualLayoutOverrides) })
  };
  await atomicWrite(studioDraftPath(card, root), serializeDraft(draft));
  return { available: true, draft: validateStoredDraft(draft, card) };
}

export async function discardStudioDraft(card: CatalogCard, root = "."): Promise<void> {
  await rm(studioDraftPath(card, root), { force: true });
}
