import { validateGameMetadata } from "./card-studio.ts";
import type { BatchRequest, StudioGameExportRequest, StudioMetadataRequest } from "./ipc-contract.ts";
import type { CatalogFilters } from "./filters.ts";
import type {
  AxieSlotCardRequest,
  AxieSlotCreateRequest,
  AxieSlotRenameRequest,
  AxieSlotRequest,
  CardSetCardRequest,
  CardSetNameRequest,
  CardSetRenameRequest,
  GameSetExportRequest,
  ProductionDashboardRequest,
  StudioDraftSaveRequest
} from "./production-contract.ts";

const CLASSES = new Set(["Aqua", "Beast", "Bird", "Bug", "Plant", "Reptile"]);
const PARTS = new Set(["Eyes", "Ears", "Mouth", "Horn", "Back", "Tail"]);

function validateString(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
}

export function validateCardId(value: unknown): string {
  return validateString(value, "card id", 200);
}

export function validateCardSetId(value: unknown): string {
  return validateStableId(value, "card set id");
}

export function validateFilters(value: unknown): CatalogFilters {
  if (!value || typeof value !== "object") throw new Error("Invalid filters");
  const candidate = value as Record<string, unknown>;
  const search = typeof candidate.search === "string" && candidate.search.length <= 200 ? candidate.search : "";
  const className = candidate.className === null ? null : validateString(candidate.className, "class filter", 20);
  const part = candidate.part === null ? null : validateString(candidate.part, "part filter", 20);
  if (className && !CLASSES.has(className)) throw new Error("Invalid class filter");
  if (part && !PARTS.has(part)) throw new Error("Invalid part filter");
  return { search, className, part };
}

export function validateBatchRequest(value: unknown): BatchRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid batch request");
  const candidate = value as Record<string, unknown>;
  const layout = candidate.layout;
  if (layout !== "by-class" && layout !== "flat") throw new Error("Invalid output layout");
  if (typeof candidate.exportMetadata !== "boolean") throw new Error("Invalid metadata option");
  return { filters: validateFilters(candidate.filters), layout, exportMetadata: candidate.exportMetadata };
}

export function validateStudioMetadataRequest(value: unknown): StudioMetadataRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid Card Studio request");
  const candidate = value as Record<string, unknown>;
  return {
    cardId: validateCardId(candidate.cardId),
    metadata: validateGameMetadata(candidate.metadata)
  };
}

export function validateStudioGameExportRequest(value: unknown): StudioGameExportRequest {
  const base = validateStudioMetadataRequest(value);
  const visualSource = (value as Record<string, unknown>).visualSource;
  if (visualSource !== "original" && visualSource !== "rendered") throw new Error("Invalid game visual source");
  return { ...base, visualSource };
}

function validateRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function validateStableId(value: unknown, label: string): string {
  const id = validateString(value, label, 100);
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u.test(id)) throw new Error(`Invalid ${label}`);
  return id;
}

function validateDisplayName(value: unknown, label: string): string {
  const name = validateString(value, label, 100).trim();
  if (!name) throw new Error(`Invalid ${label}`);
  return name;
}

export function validateCardSetNameRequest(value: unknown): CardSetNameRequest {
  const candidate = validateRecord(value, "card set request");
  return { name: validateDisplayName(candidate.name, "card set name") };
}

export function validateCardSetRenameRequest(value: unknown): CardSetRenameRequest {
  const candidate = validateRecord(value, "card set rename request");
  return { setId: validateStableId(candidate.setId, "card set id"), name: validateDisplayName(candidate.name, "card set name") };
}

export function validateCardSetCardRequest(value: unknown): CardSetCardRequest {
  const candidate = validateRecord(value, "card set card request");
  return { setId: validateStableId(candidate.setId, "card set id"), cardId: validateCardId(candidate.cardId) };
}

export function validateAxieSlotCreateRequest(value: unknown): AxieSlotCreateRequest {
  const candidate = validateRecord(value, "Axie slot create request");
  const name = candidate.name === undefined || candidate.name === null ? null : validateDisplayName(candidate.name, "Axie slot name");
  return { setId: validateStableId(candidate.setId, "card set id"), name };
}

export function validateAxieSlotRequest(value: unknown): AxieSlotRequest {
  const candidate = validateRecord(value, "Axie slot request");
  return { setId: validateStableId(candidate.setId, "card set id"), slotId: validateStableId(candidate.slotId, "Axie slot id") };
}

export function validateAxieSlotRenameRequest(value: unknown): AxieSlotRenameRequest {
  const candidate = validateRecord(value, "Axie slot rename request");
  const base = validateAxieSlotRequest(candidate);
  return { ...base, name: candidate.name === null ? null : validateDisplayName(candidate.name, "Axie slot name") };
}

export function validateAxieSlotCardRequest(value: unknown): AxieSlotCardRequest {
  const candidate = validateRecord(value, "Axie slot card request");
  return { ...validateAxieSlotRequest(candidate), cardId: validateCardId(candidate.cardId) };
}

export function validateProductionDashboardRequest(value: unknown): ProductionDashboardRequest {
  const candidate = validateRecord(value, "production dashboard request");
  return { setId: candidate.setId === null ? null : validateStableId(candidate.setId, "card set id") };
}

export function validateStudioDraftSaveRequest(value: unknown): StudioDraftSaveRequest {
  const candidate = validateRecord(value, "studio draft request");
  const metadata = validateRecord(candidate.metadata, "studio draft metadata");
  if (JSON.stringify(metadata).length > 250_000) throw new Error("Studio draft is too large");
  return { cardId: validateCardId(candidate.cardId), metadata };
}

export function validateGameSetExportRequest(value: unknown): GameSetExportRequest {
  const candidate = validateRecord(value, "game set export request");
  const visualSource = candidate.visualSource;
  if (visualSource !== "original" && visualSource !== "rendered") throw new Error("Invalid game visual source");
  if (typeof candidate.readyOnly !== "boolean") throw new Error("Invalid ready-only option");
  return { setId: validateStableId(candidate.setId, "card set id"), visualSource, readyOnly: candidate.readyOnly };
}
