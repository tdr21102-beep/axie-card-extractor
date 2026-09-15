export const GAME_METADATA_SCHEMA_VERSION = 2 as const;

export const TARGET_VOCABULARY = [
  "self",
  "selected",
  "single_enemy",
  "single_ally",
  "all_enemies",
  "all_allies"
] as const;

export type TargetVocabulary = (typeof TARGET_VOCABULARY)[number];

export const EFFECT_TYPES = ["damage", "heal", "shield", "buff", "debuff", "cleanse"] as const;
export type CardEffectType = (typeof EFFECT_TYPES)[number];

export interface CardTargeting {
  mode: TargetVocabulary;
}

interface CardEffectBase {
  id: string;
  type: CardEffectType;
  target: TargetVocabulary;
}

export interface DamageEffect extends CardEffectBase {
  type: "damage";
  amount: number;
  hits: number;
}

export interface HealEffect extends CardEffectBase {
  type: "heal";
  amount: number;
}

export interface ShieldEffect extends CardEffectBase {
  type: "shield";
  amount: number;
}

export interface BuffEffect extends CardEffectBase {
  type: "buff";
  status: string;
  stacks: number;
  duration: number;
}

export interface DebuffEffect extends CardEffectBase {
  type: "debuff";
  status: string;
  stacks: number;
  duration: number;
}

export interface CleanseEffect extends CardEffectBase {
  type: "cleanse";
  count: number;
}

export type CardEffect =
  | DamageEffect
  | HealEffect
  | ShieldEffect
  | BuffEffect
  | DebuffEffect
  | CleanseEffect;

export type NewCardEffect =
  | Omit<DamageEffect, "id">
  | Omit<HealEffect, "id">
  | Omit<ShieldEffect, "id">
  | Omit<BuffEffect, "id">
  | Omit<DebuffEffect, "id">
  | Omit<CleanseEffect, "id">;

export interface CardGameMetadataV1 {
  schema_version?: 1;
  id: string;
  name: string;
  class: string;
  part: string;
  cost: number | null;
  value: number | null;
  card_type: string;
  description: string;
}

export interface CardGameMetadata {
  schema_version: typeof GAME_METADATA_SCHEMA_VERSION;
  id: string;
  name: string;
  class: string;
  part: string;
  cost: number | null;
  value: number | null;
  card_type: string;
  description: string;
  targeting: CardTargeting;
  effects: CardEffect[];
}

export type GameMetadataIssueSeverity = "warning" | "error";
export type GameMetadataValidationStatus = "valid" | "warnings" | "invalid";

export interface GameMetadataValidationIssue {
  path: string;
  message: string;
  severity: GameMetadataIssueSeverity;
}

export interface GameMetadataValidationResult {
  status: GameMetadataValidationStatus;
  issues: GameMetadataValidationIssue[];
  metadata: CardGameMetadata | null;
}

export type AdvancedJsonParseResult =
  | {
      ok: true;
      accepted: true;
      metadata: CardGameMetadata;
      validation: GameMetadataValidationResult;
      error: null;
    }
  | {
      ok: false;
      accepted: false;
      metadata: CardGameMetadata | null;
      validation: GameMetadataValidationResult;
      error: string;
    };

export type EffectMoveDirection = "up" | "down";

const TARGETS = new Set<string>(TARGET_VOCABULARY);
const EFFECT_TYPE_SET = new Set<string>(EFFECT_TYPES);
const EFFECT_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "id",
  "name",
  "class",
  "part",
  "cost",
  "value",
  "card_type",
  "description",
  "targeting",
  "effects"
]);
const EFFECT_KEYS: Record<CardEffectType, ReadonlySet<string>> = {
  damage: new Set(["id", "type", "target", "amount", "hits"]),
  heal: new Set(["id", "type", "target", "amount"]),
  shield: new Set(["id", "type", "target", "amount"]),
  buff: new Set(["id", "type", "target", "status", "stacks", "duration"]),
  debuff: new Set(["id", "type", "target", "status", "stacks", "duration"]),
  cleanse: new Set(["id", "type", "target", "count"])
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: GameMetadataValidationIssue[],
  path: string,
  message: string,
  severity: GameMetadataIssueSeverity = "error"
): void {
  issues.push({ path, message, severity });
}

function checkExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: GameMetadataValidationIssue[],
  severity: GameMetadataIssueSeverity = "error"
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addIssue(issues, path === "$" ? key : `${path}.${key}`, "Unexpected field", severity);
    }
  }
}

function readString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: GameMetadataValidationIssue[],
  options: { allowEmpty?: boolean; maxLength?: number } = {}
): string {
  const candidate = value[key];
  if (typeof candidate !== "string") {
    addIssue(issues, path, "Must be a string");
    return "";
  }
  if (!options.allowEmpty && candidate.trim().length === 0) {
    addIssue(issues, path, "Must not be empty");
  }
  if (options.maxLength !== undefined && candidate.length > options.maxLength) {
    addIssue(issues, path, `Must be at most ${options.maxLength} characters`);
  }
  return candidate;
}

function readNullableVisualNumber(
  value: Record<string, unknown>,
  key: "cost" | "value",
  issues: GameMetadataValidationIssue[]
): number | null {
  const candidate = value[key];
  if (candidate === null) {
    addIssue(issues, key, `${key === "cost" ? "Cost" : "Value"} is unset`, "warning");
    return null;
  }
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0 || candidate > 9999) {
    addIssue(issues, key, "Must be null or an integer from 0 to 9999");
    return null;
  }
  return candidate;
}

function readPositiveInteger(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: GameMetadataValidationIssue[]
): number {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 1) {
    addIssue(issues, path, "Must be a positive integer");
    return 1;
  }
  return candidate;
}

function readTarget(value: unknown, path: string, issues: GameMetadataValidationIssue[]): TargetVocabulary {
  if (typeof value !== "string" || !TARGETS.has(value)) {
    addIssue(issues, path, `Must be one of: ${TARGET_VOCABULARY.join(", ")}`);
    return "selected";
  }
  return value as TargetVocabulary;
}

function parseEffect(value: unknown, index: number, issues: GameMetadataValidationIssue[]): CardEffect | null {
  const path = `effects[${index}]`;
  if (!isRecord(value)) {
    addIssue(issues, path, "Must be an object");
    return null;
  }

  const typeValue = value.type;
  if (typeof typeValue !== "string" || !EFFECT_TYPE_SET.has(typeValue)) {
    addIssue(issues, `${path}.type`, `Must be one of: ${EFFECT_TYPES.join(", ")}`);
    return null;
  }
  const type = typeValue as CardEffectType;
  checkExactKeys(value, EFFECT_KEYS[type], path, issues);

  const id = readString(value, "id", `${path}.id`, issues, { maxLength: 100 });
  if (id !== "" && !EFFECT_ID.test(id)) {
    addIssue(issues, `${path}.id`, "Must be a snake_case identifier beginning with a letter");
  }
  const target = readTarget(value.target, `${path}.target`, issues);

  switch (type) {
    case "damage":
      return {
        id,
        type,
        target,
        amount: readPositiveInteger(value, "amount", `${path}.amount`, issues),
        hits: readPositiveInteger(value, "hits", `${path}.hits`, issues)
      };
    case "heal":
      return { id, type, target, amount: readPositiveInteger(value, "amount", `${path}.amount`, issues) };
    case "shield":
      return { id, type, target, amount: readPositiveInteger(value, "amount", `${path}.amount`, issues) };
    case "buff":
    case "debuff":
      return {
        id,
        type,
        target,
        status: readString(value, "status", `${path}.status`, issues),
        stacks: readPositiveInteger(value, "stacks", `${path}.stacks`, issues),
        duration: readPositiveInteger(value, "duration", `${path}.duration`, issues)
      };
    case "cleanse":
      return { id, type, target, count: readPositiveInteger(value, "count", `${path}.count`, issues) };
  }
}

function cloneEffect(effect: CardEffect): CardEffect {
  return { ...effect };
}

export function cloneGameMetadata(metadata: CardGameMetadata): CardGameMetadata {
  return {
    ...metadata,
    targeting: { ...metadata.targeting },
    effects: metadata.effects.map(cloneEffect)
  };
}

export function validateGameMetadataV2(value: unknown): GameMetadataValidationResult {
  const issues: GameMetadataValidationIssue[] = [];
  if (!isRecord(value)) {
    addIssue(issues, "$", "Game metadata must be an object");
    return { status: "invalid", issues, metadata: null };
  }

  // Never normalize unknown V2 fields away: rejecting them prevents Advanced JSON
  // or a future schema extension from being silently destroyed on Apply/Save.
  checkExactKeys(value, TOP_LEVEL_KEYS, "$", issues);
  if (value.schema_version !== GAME_METADATA_SCHEMA_VERSION) {
    addIssue(issues, "schema_version", `Must equal ${GAME_METADATA_SCHEMA_VERSION}`);
  }

  const id = readString(value, "id", "id", issues, { maxLength: 200 });
  const name = readString(value, "name", "name", issues, { maxLength: 200 });
  const cardClass = readString(value, "class", "class", issues, { maxLength: 100 });
  const part = readString(value, "part", "part", issues, { maxLength: 100 });
  const cost = readNullableVisualNumber(value, "cost", issues);
  const visualValue = readNullableVisualNumber(value, "value", issues);
  const cardType = readString(value, "card_type", "card_type", issues, { allowEmpty: true, maxLength: 100 });
  const description = readString(value, "description", "description", issues, {
    allowEmpty: true,
    maxLength: 10_000
  });
  if (typeof value.card_type === "string" && cardType.trim() === "") {
    addIssue(issues, "card_type", "Card type is empty", "warning");
  }
  if (typeof value.description === "string" && description.trim() === "") {
    addIssue(issues, "description", "Description is empty", "warning");
  }

  let targeting: CardTargeting = { mode: "single_enemy" };
  if (!isRecord(value.targeting)) {
    addIssue(issues, "targeting", "Must be an object");
  } else {
    checkExactKeys(value.targeting, new Set(["mode"]), "targeting", issues);
    targeting = { mode: readTarget(value.targeting.mode, "targeting.mode", issues) };
  }

  const effects: CardEffect[] = [];
  if (!Array.isArray(value.effects)) {
    addIssue(issues, "effects", "Must be an array");
  } else {
    for (const [index, candidate] of value.effects.entries()) {
      const effect = parseEffect(candidate, index, issues);
      if (effect) effects.push(effect);
    }
    if (value.effects.length === 0) {
      addIssue(issues, "effects", "No structured effects are defined", "warning");
    }
  }

  const firstIndexById = new Map<string, number>();
  for (const [index, effect] of effects.entries()) {
    const firstIndex = firstIndexById.get(effect.id);
    if (firstIndex !== undefined) {
      addIssue(issues, `effects[${index}].id`, `Duplicates effects[${firstIndex}].id`);
    } else if (effect.id !== "") {
      firstIndexById.set(effect.id, index);
    }
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  if (hasErrors) {
    return { status: "invalid", issues, metadata: null };
  }

  const metadata: CardGameMetadata = {
    schema_version: GAME_METADATA_SCHEMA_VERSION,
    id,
    name,
    class: cardClass,
    part,
    cost,
    value: visualValue,
    card_type: cardType,
    description,
    targeting,
    effects
  };
  return {
    status: issues.length === 0 ? "valid" : "warnings",
    issues,
    metadata
  };
}

export class GameMetadataValidationError extends Error {
  readonly issues: GameMetadataValidationIssue[];

  constructor(issues: GameMetadataValidationIssue[]) {
    const errors = issues.filter((issue) => issue.severity === "error");
    super(`Invalid game metadata: ${errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    this.name = "GameMetadataValidationError";
    this.issues = issues.map((issue) => ({ ...issue }));
  }
}

export function parseGameMetadataV2(value: unknown): CardGameMetadata {
  const validation = validateGameMetadataV2(value);
  if (validation.status === "invalid" || validation.metadata === null) {
    throw new GameMetadataValidationError(validation.issues);
  }
  return validation.metadata;
}

function parseV1(value: unknown): CardGameMetadataV1 {
  if (!isRecord(value)) {
    throw new Error("Invalid V1 game metadata: must be an object");
  }
  if (value.schema_version !== undefined && value.schema_version !== 1) {
    throw new Error("Invalid V1 game metadata: schema_version must be absent or 1");
  }

  const issues: GameMetadataValidationIssue[] = [];
  const result: CardGameMetadataV1 = {
    ...(value.schema_version === 1 ? { schema_version: 1 as const } : {}),
    id: readString(value, "id", "id", issues, { maxLength: 200 }),
    name: readString(value, "name", "name", issues, { maxLength: 200 }),
    class: readString(value, "class", "class", issues, { maxLength: 100 }),
    part: readString(value, "part", "part", issues, { maxLength: 100 }),
    cost: readNullableVisualNumber(value, "cost", issues),
    value: readNullableVisualNumber(value, "value", issues),
    card_type: readString(value, "card_type", "card_type", issues, { allowEmpty: true, maxLength: 100 }),
    description: readString(value, "description", "description", issues, {
      allowEmpty: true,
      maxLength: 10_000
    })
  };
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new GameMetadataValidationError(errors);
  }
  return result;
}

export function migrateGameMetadataV1(value: unknown): CardGameMetadata {
  const v1 = parseV1(value);
  return {
    schema_version: GAME_METADATA_SCHEMA_VERSION,
    id: v1.id,
    name: v1.name,
    class: v1.class,
    part: v1.part,
    cost: v1.cost,
    value: v1.value,
    card_type: v1.card_type,
    description: v1.description,
    targeting: { mode: "single_enemy" },
    effects: []
  };
}

export function parseOrMigrateGameMetadata(value: unknown): CardGameMetadata {
  if (isRecord(value) && value.schema_version === GAME_METADATA_SCHEMA_VERSION) {
    return parseGameMetadataV2(value);
  }
  return migrateGameMetadataV1(value);
}

/** Throwing boundary for IPC, persistence and exports. V1 documents are upgraded in memory. */
export function parseGameMetadata(value: unknown): CardGameMetadata {
  return parseOrMigrateGameMetadata(value);
}

/** Structured, non-throwing validation for editor feedback. */
export function validateGameMetadataDocument(value: unknown): GameMetadataValidationResult {
  return validateGameMetadataV2(value);
}

export function parseAdvancedGameMetadataJson(
  json: string,
  currentMetadata?: CardGameMetadata
): AdvancedJsonParseResult {
  const current = currentMetadata ? cloneGameMetadata(currentMetadata) : null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON error";
    return {
      ok: false,
      accepted: false,
      metadata: current,
      validation: {
        status: "invalid",
        issues: [{ path: "$", message: `Invalid JSON: ${message}`, severity: "error" }],
        metadata: null
      },
      error: `Invalid JSON: ${message}`
    };
  }

  const validation = validateGameMetadataV2(parsed);
  if (validation.status === "invalid" || validation.metadata === null) {
    const firstError = validation.issues.find((issue) => issue.severity === "error");
    const error = firstError ? `${firstError.path}: ${firstError.message}` : "Invalid game metadata";
    return { ok: false, accepted: false, metadata: current, validation, error };
  }
  return { ok: true, accepted: true, metadata: validation.metadata, validation, error: null };
}

export function parseAdvancedGameMetadata(
  json: string,
  currentMetadata?: CardGameMetadata
): AdvancedJsonParseResult {
  return parseAdvancedGameMetadataJson(json, currentMetadata);
}

function nextEffectId(type: CardEffectType, effects: readonly CardEffect[]): string {
  const used = new Set(effects.map((effect) => effect.id));
  for (let suffix = 1; suffix <= Number.MAX_SAFE_INTEGER; suffix += 1) {
    const candidate = `${type}_${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate an effect id for ${type}`);
}

function requireEffectIndex(metadata: CardGameMetadata, effectId: string): number {
  const index = metadata.effects.findIndex((effect) => effect.id === effectId);
  if (index === -1) throw new Error(`Effect not found: ${effectId}`);
  return index;
}

function defaultNewEffect(type: CardEffectType, target: TargetVocabulary): NewCardEffect {
  switch (type) {
    case "damage": return { type, target, amount: 1, hits: 1 };
    case "heal": return { type, target, amount: 1 };
    case "shield": return { type, target, amount: 1 };
    case "buff": return { type, target, status: "status", stacks: 1, duration: 1 };
    case "debuff": return { type, target, status: "status", stacks: 1, duration: 1 };
    case "cleanse": return { type, target, count: 1 };
  }
}

function effectIndex(metadata: CardGameMetadata, effectIdOrIndex: string | number): number {
  if (typeof effectIdOrIndex === "string") return requireEffectIndex(metadata, effectIdOrIndex);
  if (!Number.isInteger(effectIdOrIndex) || effectIdOrIndex < 0 || effectIdOrIndex >= metadata.effects.length) {
    throw new Error(`Effect index is out of bounds: ${effectIdOrIndex}`);
  }
  return effectIdOrIndex;
}

export function addCardEffect(
  metadata: CardGameMetadata,
  effectOrType: NewCardEffect | CardEffectType
): CardGameMetadata {
  const current = parseGameMetadataV2(metadata);
  const effect = typeof effectOrType === "string"
    ? defaultNewEffect(effectOrType, current.targeting.mode)
    : effectOrType;
  if (!EFFECT_TYPE_SET.has(effect.type)) {
    throw new Error(`Unsupported effect type: ${String(effect.type)}`);
  }
  const candidate = {
    ...effect,
    id: nextEffectId(effect.type, current.effects)
  } as CardEffect;
  return parseGameMetadataV2({ ...current, effects: [...current.effects, candidate] });
}

export function moveCardEffect(
  metadata: CardGameMetadata,
  effectIdOrIndex: string | number,
  destination: number | EffectMoveDirection
): CardGameMetadata {
  const current = cloneGameMetadata(metadata);
  const fromIndex = effectIndex(current, effectIdOrIndex);
  const toIndex = typeof destination === "number"
    ? destination
    : fromIndex + (destination === "up" ? -1 : 1);
  if (typeof destination === "string" && (toIndex < 0 || toIndex >= current.effects.length)) {
    return cloneGameMetadata(current);
  }
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= current.effects.length) {
    throw new Error(`Effect destination index is out of bounds: ${toIndex}`);
  }
  const effects = current.effects.map(cloneEffect);
  const [effect] = effects.splice(fromIndex, 1);
  effects.splice(toIndex, 0, effect!);
  return { ...current, targeting: { ...current.targeting }, effects };
}

export function duplicateCardEffect(
  metadata: CardGameMetadata,
  effectIdOrIndex: string | number
): CardGameMetadata {
  const current = cloneGameMetadata(metadata);
  const sourceIndex = effectIndex(current, effectIdOrIndex);
  const source = current.effects[sourceIndex]!;
  const duplicate = { ...source, id: nextEffectId(source.type, current.effects) };
  const effects = current.effects.map(cloneEffect);
  effects.splice(sourceIndex + 1, 0, duplicate);
  return { ...current, effects };
}

export function deleteCardEffect(
  metadata: CardGameMetadata,
  effectIdOrIndex: string | number
): CardGameMetadata {
  const current = cloneGameMetadata(metadata);
  const index = effectIndex(current, effectIdOrIndex);
  const effects = current.effects.filter((_, effectIndex) => effectIndex !== index).map(cloneEffect);
  return { ...current, targeting: { ...current.targeting }, effects };
}
