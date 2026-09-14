import type { BatchRequest } from "./ipc-contract.ts";
import type { CatalogFilters } from "./filters.ts";

const CLASSES = new Set(["Aqua", "Beast", "Bird", "Bug", "Plant", "Reptile"]);
const PARTS = new Set(["Eyes", "Ears", "Mouth", "Horn", "Back", "Tail"]);

function validateString(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
}

export function validateCardId(value: unknown): string {
  return validateString(value, "card id", 200);
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
