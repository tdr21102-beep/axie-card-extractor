import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { snakeCase } from "./naming.ts";
import {
  CARD_SET_SCHEMA_VERSION,
  type AxieSlot,
  type CardSetDocument
} from "./production-contract.ts";

const IDENTIFIER = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const FOREIGN_CARD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a snake_case identifier`);
  }
  return value;
}

function requireCardReference(value: string, label: string): string {
  if (typeof value !== "string" || value.length > 200 || !FOREIGN_CARD_ID.test(value)) {
    throw new Error(`${label} must be a stable catalog identifier`);
  }
  return value;
}

function requireName(value: string, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const name = value.trim();
  if (name.length === 0 || name.length > 200) throw new Error(`${label} must contain 1 to 200 characters`);
  return name;
}

function sortedUnique(values: readonly string[], label: string, read = requireIdentifier): string[] {
  const normalized = values.map((value) => read(value, label));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates`);
  return normalized.sort();
}

function cloneSlot(slot: AxieSlot): AxieSlot {
  return { id: slot.id, name: slot.name, cards: [...slot.cards] };
}

function cloneSet(set: CardSetDocument): CardSetDocument {
  return { ...set, cards: [...set.cards], axies: set.axies.map(cloneSlot) };
}

export function validateCardSetDocument(value: unknown, expectedId?: string): CardSetDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Card set must be an object");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["schema_version", "id", "name", "cards", "axies"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`Unexpected card set field: ${key}`);
  }
  if (input.schema_version !== CARD_SET_SCHEMA_VERSION) throw new Error(`Card set schema_version must equal ${CARD_SET_SCHEMA_VERSION}`);
  const id = requireIdentifier(input.id as string, "Card set id");
  if (expectedId !== undefined && id !== expectedId) throw new Error("Card set file identity does not match its document id");
  const name = requireName(input.name as string, "Card set name");
  if (!Array.isArray(input.cards)) throw new Error("Card set cards must be an array");
  const cards = sortedUnique(input.cards as string[], "Card id", requireCardReference);
  if (!Array.isArray(input.axies)) throw new Error("Card set axies must be an array");
  const seenSlots = new Set<string>();
  const assignedCards = new Set<string>();
  const axies = input.axies.map((value, index): AxieSlot => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Axie slot ${index + 1} must be an object`);
    const slot = value as Record<string, unknown>;
    for (const key of Object.keys(slot)) {
      if (!new Set(["id", "name", "cards"]).has(key)) throw new Error(`Unexpected Axie slot field: ${key}`);
    }
    const slotId = requireIdentifier(slot.id as string, "Axie slot id");
    if (seenSlots.has(slotId)) throw new Error(`Duplicate Axie slot id: ${slotId}`);
    seenSlots.add(slotId);
    if (slot.name !== null && typeof slot.name !== "string") throw new Error("Axie slot name must be a string or null");
    const slotName = slot.name === null ? null : requireName(slot.name, "Axie slot name");
    if (!Array.isArray(slot.cards)) throw new Error("Axie slot cards must be an array");
    const slotCards = sortedUnique(slot.cards as string[], "Axie slot card id", requireCardReference);
    for (const cardId of slotCards) {
      if (!cards.includes(cardId)) throw new Error(`Axie slot card is not in the set: ${cardId}`);
      if (assignedCards.has(cardId)) throw new Error(`Card is assigned to more than one Axie slot: ${cardId}`);
      assignedCards.add(cardId);
    }
    return { id: slotId, name: slotName, cards: slotCards };
  });
  return { schema_version: CARD_SET_SCHEMA_VERSION, id, name, cards, axies };
}

export function cardSetsDirectory(root = "."): string {
  return resolve(root, "cards", "sets");
}

export function cardSetPath(root: string, setId: string): string {
  return resolve(cardSetsDirectory(root), `${requireIdentifier(setId, "Card set id")}.json`);
}

async function readSet(root: string, setId: string): Promise<CardSetDocument> {
  const id = requireIdentifier(setId, "Card set id");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(cardSetPath(root, id), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Card set not found: ${id}`);
    throw error;
  }
  return validateCardSetDocument(parsed, id);
}

async function atomicReplace(path: string, bytes: string): Promise<void> {
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

async function writeSet(root: string, set: CardSetDocument): Promise<CardSetDocument> {
  const validated = validateCardSetDocument(set, set.id);
  await atomicReplace(cardSetPath(root, validated.id), `${JSON.stringify(validated, null, 2)}\n`);
  return cloneSet(validated);
}

async function createNew(path: string, bytes: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(path, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

export async function listCardSets(root = "."): Promise<CardSetDocument[]> {
  let entries;
  try {
    entries = await readdir(cardSetsDirectory(root), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const sets: CardSetDocument[] = [];
  for (const filename of filenames) {
    const id = filename.slice(0, -5);
    sets.push(await readSet(root, id));
  }
  return sets;
}

export async function getCardSet(root: string, setId: string): Promise<CardSetDocument> {
  return cloneSet(await readSet(root, setId));
}

export async function createCardSet(root: string, nameValue: string): Promise<CardSetDocument> {
  const name = requireName(nameValue, "Card set name");
  const normalized = snakeCase(name);
  if (!normalized) throw new Error("Card set name must produce a valid identifier");
  const base = /^[a-z]/u.test(normalized) ? normalized : `set_${normalized}`;
  const existing = new Set((await listCardSets(root)).map((set) => set.id));
  let id = base;
  for (let suffix = 2; existing.has(id); suffix += 1) id = `${base}_${suffix}`;
  const set: CardSetDocument = { schema_version: CARD_SET_SCHEMA_VERSION, id, name, cards: [], axies: [] };
  const validated = validateCardSetDocument(set, id);
  await createNew(cardSetPath(root, id), `${JSON.stringify(validated, null, 2)}\n`);
  return cloneSet(validated);
}

export async function renameCardSet(root: string, setId: string, name: string): Promise<CardSetDocument> {
  const set = await readSet(root, setId);
  return writeSet(root, { ...set, name: requireName(name, "Card set name") });
}

export async function deleteCardSet(root: string, setId: string): Promise<void> {
  const set = await readSet(root, setId);
  await rm(cardSetPath(root, set.id));
}

export async function addCardToSet(root: string, setId: string, cardIdValue: string): Promise<CardSetDocument> {
  const cardId = requireCardReference(cardIdValue, "Card id");
  const set = await readSet(root, setId);
  if (set.cards.includes(cardId)) return cloneSet(set);
  return writeSet(root, { ...set, cards: [...set.cards, cardId].sort() });
}

export async function removeCardFromSet(root: string, setId: string, cardIdValue: string): Promise<CardSetDocument> {
  const cardId = requireCardReference(cardIdValue, "Card id");
  const set = await readSet(root, setId);
  return writeSet(root, {
    ...set,
    cards: set.cards.filter((id) => id !== cardId),
    axies: set.axies.map((slot) => ({ ...slot, cards: slot.cards.filter((id) => id !== cardId) }))
  });
}

export async function createAxieSlot(root: string, setId: string, name: string | null = null): Promise<CardSetDocument> {
  const set = await readSet(root, setId);
  const slotNumbers = set.axies
    .map((slot) => /^axie_(\d+)$/u.exec(slot.id))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number.parseInt(match[1]!, 10));
  const next = Math.max(0, ...slotNumbers) + 1;
  const slot: AxieSlot = {
    id: `axie_${String(next).padStart(2, "0")}`,
    name: name === null ? null : requireName(name, "Axie slot name"),
    cards: []
  };
  return writeSet(root, { ...set, axies: [...set.axies, slot] });
}

export async function renameAxieSlot(root: string, setId: string, slotIdValue: string, name: string | null): Promise<CardSetDocument> {
  const slotId = requireIdentifier(slotIdValue, "Axie slot id");
  const set = await readSet(root, setId);
  if (!set.axies.some((slot) => slot.id === slotId)) throw new Error(`Axie slot not found: ${slotId}`);
  const nextName = name === null ? null : requireName(name, "Axie slot name");
  return writeSet(root, { ...set, axies: set.axies.map((slot) => slot.id === slotId ? { ...slot, name: nextName } : slot) });
}

export async function deleteAxieSlot(root: string, setId: string, slotIdValue: string): Promise<CardSetDocument> {
  const slotId = requireIdentifier(slotIdValue, "Axie slot id");
  const set = await readSet(root, setId);
  if (!set.axies.some((slot) => slot.id === slotId)) throw new Error(`Axie slot not found: ${slotId}`);
  return writeSet(root, { ...set, axies: set.axies.filter((slot) => slot.id !== slotId) });
}

export async function assignCardToAxieSlot(root: string, setId: string, slotIdValue: string, cardIdValue: string): Promise<CardSetDocument> {
  const slotId = requireIdentifier(slotIdValue, "Axie slot id");
  const cardId = requireCardReference(cardIdValue, "Card id");
  const set = await readSet(root, setId);
  if (!set.axies.some((slot) => slot.id === slotId)) throw new Error(`Axie slot not found: ${slotId}`);
  return writeSet(root, {
    ...set,
    cards: [...new Set([...set.cards, cardId])].sort(),
    axies: set.axies.map((slot) => ({
      ...slot,
      cards: slot.id === slotId
        ? [...new Set([...slot.cards, cardId])].sort()
        : slot.cards.filter((id) => id !== cardId)
    }))
  });
}

export async function removeCardFromAxieSlot(root: string, setId: string, slotIdValue: string, cardIdValue: string): Promise<CardSetDocument> {
  const slotId = requireIdentifier(slotIdValue, "Axie slot id");
  const cardId = requireCardReference(cardIdValue, "Card id");
  const set = await readSet(root, setId);
  if (!set.axies.some((slot) => slot.id === slotId)) throw new Error(`Axie slot not found: ${slotId}`);
  return writeSet(root, {
    ...set,
    axies: set.axies.map((slot) => slot.id === slotId ? { ...slot, cards: slot.cards.filter((id) => id !== cardId) } : slot)
  });
}
