import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const CARD_TYPE_CONFIG_VERSION = 1 as const;

export interface CardTypeVisual {
  label: string;
  icon_reference: string | null;
  style_key: string;
}

export interface CardTypeConfig {
  version: typeof CARD_TYPE_CONFIG_VERSION;
  types: Record<string, CardTypeVisual>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 100 || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${label} must be a safe non-empty string`);
  }
  return value.trim();
}

export function parseCardTypeConfig(value: unknown): CardTypeConfig {
  if (!isRecord(value) || value.version !== CARD_TYPE_CONFIG_VERSION || !isRecord(value.types)) {
    throw new Error(`card type config must use version ${CARD_TYPE_CONFIG_VERSION} and contain a types object`);
  }
  const types: Record<string, CardTypeVisual> = {};
  for (const [key, entryValue] of Object.entries(value.types)) {
    if (!/^[a-z][a-z0-9_]*$/u.test(key) || !isRecord(entryValue)) throw new Error(`Invalid card type config entry: ${key}`);
    const icon = entryValue.icon_reference;
    if (icon !== null && (typeof icon !== "string" || icon.length > 260 || icon.trim().length === 0)) {
      throw new Error(`types.${key}.icon_reference must be null or a relative asset reference`);
    }
    if (typeof icon === "string" && (/^(?:[a-z]+:|[\\/]|[A-Za-z]:)/u.test(icon) || icon.split(/[\\/]/u).includes(".."))) {
      throw new Error(`types.${key}.icon_reference must stay within packaged assets`);
    }
    types[key] = {
      label: safeText(entryValue.label, `types.${key}.label`),
      icon_reference: typeof icon === "string" ? icon.trim() : null,
      style_key: safeText(entryValue.style_key, `types.${key}.style_key`)
    };
  }
  return { version: CARD_TYPE_CONFIG_VERSION, types };
}

export function loadCardTypeConfig(path = resolve("config/card_types.json")): CardTypeConfig {
  try {
    return parseCardTypeConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(`Unable to load card type config at ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
