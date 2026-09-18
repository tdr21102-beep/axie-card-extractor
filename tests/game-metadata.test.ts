import assert from "node:assert/strict";
import test from "node:test";
import {
  GAME_METADATA_SCHEMA_VERSION,
  TARGET_VOCABULARY,
  GameMetadataValidationError,
  addCardEffect,
  deleteCardEffect,
  duplicateCardEffect,
  migrateGameMetadataV1,
  moveCardEffect,
  parseAdvancedGameMetadata,
  parseAdvancedGameMetadataJson,
  parseGameMetadata,
  parseGameMetadataV2,
  parseOrMigrateGameMetadata,
  validateGameMetadataForGameReady,
  validateGameMetadataDocument,
  validateGameMetadataV2,
  type CardEffect,
  type CardGameMetadata,
  type CardGameMetadataV1
} from "../src/game-metadata.ts";

const v1: CardGameMetadataV1 = {
  id: "furball",
  name: "Furball",
  class: "beast",
  part: "back",
  cost: 1,
  value: 40,
  card_type: "attack",
  description: "Deal 2 hits."
};

const effects: CardEffect[] = [
  { id: "damage_1", type: "damage", target: "single_enemy", amount: 20, hits: 2 },
  { id: "heal_1", type: "heal", target: "single_ally", amount: 15 },
  { id: "shield_1", type: "shield", target: "self", amount: 10 },
  { id: "buff_1", type: "buff", target: "all_allies", status: "morale_up", stacks: 1, duration: 2 },
  { id: "debuff_1", type: "debuff", target: "all_enemies", status: "slow", stacks: 2, duration: 1 },
  { id: "cleanse_1", type: "cleanse", target: "selected", count: 1 }
];

const complete = (): CardGameMetadata => ({
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
  effects: effects.map((effect) => ({ ...effect }))
});

test("accepts schema V2, every target and every discriminated effect without sharing nested state", () => {
  assert.deepEqual(TARGET_VOCABULARY, [
    "self",
    "selected",
    "single_enemy",
    "single_ally",
    "all_enemies",
    "all_allies"
  ]);
  const input = complete();
  const validation = validateGameMetadataV2(input);
  assert.equal(validation.status, "valid");
  assert.deepEqual(validation.issues, []);
  assert.deepEqual(validation.metadata, input);
  assert.notEqual(validation.metadata, input);
  assert.notEqual(validation.metadata?.targeting, input.targeting);
  assert.notEqual(validation.metadata?.effects, input.effects);
  assert.notEqual(validation.metadata?.effects[0], input.effects[0]);

  for (const target of TARGET_VOCABULARY) {
    assert.equal(validateGameMetadataV2({ ...complete(), targeting: { mode: target } }).status, "valid");
  }
});

test("reports incomplete but structurally valid metadata as non-blocking warnings", () => {
  const result = validateGameMetadataV2({
    ...complete(),
    cost: null,
    value: null,
    card_type: "",
    description: "",
    effects: []
  });
  assert.equal(result.status, "warnings");
  assert.ok(result.metadata);
  assert.deepEqual(
    result.issues.map((issue) => issue.path),
    ["cost", "value", "card_type", "description", "effects"]
  );
  assert.ok(result.issues.every((issue) => issue.severity === "warning"));
  assert.doesNotThrow(() => parseGameMetadataV2(result.metadata));
});

test("requires explicit gameplay for Attack readiness without inferring it from visual fields", () => {
  const emptyAttack = {
    ...complete(),
    value: 30,
    description: "Deal 30 damage to all enemies.",
    effects: []
  };
  const structural = validateGameMetadataV2(emptyAttack);
  assert.equal(structural.status, "warnings");
  assert.deepEqual(structural.metadata?.effects, []);

  const readiness = validateGameMetadataForGameReady(emptyAttack);
  assert.equal(readiness.status, "invalid");
  assert.equal(readiness.metadata, null);
  assert.ok(readiness.issues.some((issue) => issue.message === "Attack card requires at least one gameplay effect."));

  const validAttack = validateGameMetadataForGameReady({
    ...emptyAttack,
    effects: [{ id: "damage_1", type: "damage", target: "all_enemies", amount: 30, hits: 1 }]
  });
  assert.equal(validAttack.status, "valid");
  assert.equal(validAttack.metadata?.effects[0]?.type, "damage");
  assert.equal((validAttack.metadata?.effects[0] as { amount: number }).amount, 30);

  const nonAttack = validateGameMetadataForGameReady({ ...emptyAttack, card_type: "skill" });
  assert.equal(nonAttack.status, "warnings");
  assert.deepEqual(nonAttack.metadata?.effects, []);
});

test("rejects invalid schema, fields and unknown top-level data", () => {
  const invalid = {
    ...complete(),
    schema_version: 1,
    name: "",
    cost: -1,
    source_metadata: { sanity_id: "must-not-leak" }
  };
  const result = validateGameMetadataV2(invalid);
  assert.equal(result.status, "invalid");
  assert.equal(result.metadata, null);
  assert.ok(result.issues.some((issue) => issue.path === "schema_version" && issue.severity === "error"));
  assert.ok(result.issues.some((issue) => issue.path === "name"));
  assert.ok(result.issues.some((issue) => issue.path === "cost"));
  assert.ok(result.issues.some((issue) => issue.path === "source_metadata" && issue.severity === "error"));
  assert.throws(() => parseGameMetadataV2(invalid), GameMetadataValidationError);
});

test("rejects unknown top-level fields instead of silently discarding extensions", () => {
  const result = validateGameMetadataV2({ ...complete(), sanity_id: "source-only" });
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.path === "sanity_id" && issue.severity === "error"));
  assert.equal(result.metadata, null);
  assert.throws(() => parseGameMetadataV2({ ...complete(), sanity_id: "source-only" }), GameMetadataValidationError);
});

test("enforces target vocabulary, unique snake_case ids and effect-specific fields", () => {
  const invalidEffects = [
    { id: "Damage One", type: "damage", target: "random_enemy", amount: 0, hits: 0, status: "extra" },
    { id: "same_id", type: "heal", target: "self", amount: 0 },
    { id: "same_id", type: "shield", target: "self", amount: -1 },
    { id: "buff_bad", type: "buff", target: "self", status: " ", stacks: 0, duration: 0 },
    { id: "debuff_bad", type: "debuff", target: "self", status: "", stacks: 1.5, duration: -1 },
    { id: "cleanse_bad", type: "cleanse", target: "self", count: 0 }
  ];
  const result = validateGameMetadataV2({
    ...complete(),
    targeting: { mode: "random" },
    effects: invalidEffects
  });
  assert.equal(result.status, "invalid");
  const paths = new Set(result.issues.map((issue) => issue.path));
  for (const path of [
    "targeting.mode",
    "effects[0].id",
    "effects[0].target",
    "effects[0].amount",
    "effects[0].hits",
    "effects[0].status",
    "effects[1].amount",
    "effects[2].id",
    "effects[2].amount",
    "effects[3].status",
    "effects[3].stacks",
    "effects[3].duration",
    "effects[4].status",
    "effects[4].stacks",
    "effects[4].duration",
    "effects[5].count"
  ]) {
    assert.ok(paths.has(path), `missing validation issue for ${path}`);
  }
});

test("rejects missing or unsupported effect discriminators", () => {
  const missing = validateGameMetadataV2({ ...complete(), effects: [{ id: "x", target: "self" }] });
  const unsupported = validateGameMetadataV2({
    ...complete(),
    effects: [{ id: "draw_1", type: "draw", target: "self", count: 1 }]
  });
  assert.equal(missing.status, "invalid");
  assert.equal(unsupported.status, "invalid");
  assert.ok(missing.issues.some((issue) => issue.path === "effects[0].type"));
  assert.ok(unsupported.issues.some((issue) => issue.path === "effects[0].type"));
});

test("splash damage keeps one primary target and explicit adjacent-enemy distribution", () => {
  const splash = {
    id: "splash_damage_1", type: "splash_damage", target: "selected", amount: 40,
    splash_ratio: 0.5, target_scope: "other_enemies", distribution: { mode: "adjacent" }
  };
  const parsed = parseGameMetadataV2({ ...complete(), targeting: { mode: "single_enemy" }, effects: [splash] });
  assert.deepEqual(parsed.effects[0], splash);
  assert.notEqual((parsed.effects[0] as typeof splash).distribution, splash.distribution);
  const duplicated = duplicateCardEffect(parsed, "splash_damage_1");
  assert.notEqual(duplicated.effects[1], duplicated.effects[0]);
  assert.notEqual((duplicated.effects[1] as typeof splash).distribution, (duplicated.effects[0] as typeof splash).distribution);
  assert.deepEqual(addCardEffect({ ...complete(), effects: [] }, "splash_damage").effects[0], {
    ...splash, target: "single_enemy", amount: 1, splash_ratio: 0.5
  });
  assert.equal(validateGameMetadataV2({ ...complete(), effects: [
    { id: "damage_1", type: "damage", target: "all_enemies", amount: 20, hits: 2 },
    { id: "heal_1", type: "heal", target: "single_ally", amount: 10 },
    { id: "cleanse_1", type: "cleanse", target: "self", count: 1 }
  ] }).status, "valid");
});

test("splash damage rejects collective targets, invalid ratios and unsupported distributions", () => {
  const splash = {
    id: "splash_damage_1", type: "splash_damage", target: "all_enemies", amount: 0,
    splash_ratio: 0, target_scope: "all_enemies", distribution: { mode: "uniform", weight: 1 }, hits: 2
  };
  const invalid = validateGameMetadataV2({ ...complete(), targeting: { mode: "all_enemies" }, effects: [splash] });
  assert.equal(invalid.status, "invalid");
  for (const path of ["targeting.mode", "effects[0].target", "effects[0].amount", "effects[0].splash_ratio", "effects[0].target_scope", "effects[0].distribution.mode", "effects[0].distribution.weight", "effects[0].hits"]) {
    assert.ok(invalid.issues.some((issue) => issue.path === path), `missing ${path}`);
  }
  for (const ratio of [-0.1, 1.01, NaN, Infinity, "0.5"]) {
    const result = validateGameMetadataV2({ ...complete(), effects: [{ ...splash, target: "selected", amount: 10, splash_ratio: ratio, target_scope: "other_enemies", distribution: { mode: "adjacent" }, hits: undefined }] });
    assert.ok(result.issues.some((issue) => issue.path === "effects[0].splash_ratio"), `ratio ${ratio}`);
  }
});

test("migrates V1 deterministically in memory and parseOrMigrate handles both schemas", () => {
  const original = structuredClone(v1);
  const first = migrateGameMetadataV1(v1);
  const second = migrateGameMetadataV1(v1);
  assert.deepEqual(v1, original);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    schema_version: 2,
    ...v1,
    targeting: { mode: "single_enemy" },
    effects: []
  });
  assert.notEqual(first.targeting, second.targeting);
  assert.notEqual(first.effects, second.effects);
  assert.deepEqual(parseOrMigrateGameMetadata(v1), first);
  assert.deepEqual(parseOrMigrateGameMetadata(complete()), complete());
  assert.throws(() => migrateGameMetadataV1({ ...v1, schema_version: 2 }), /V1/);
  assert.throws(() => migrateGameMetadataV1({ ...v1, cost: "1" }), GameMetadataValidationError);
});

test("effect helpers preserve order, immutability and deterministic unique ids", () => {
  const initial: CardGameMetadata = { ...complete(), effects: [effects[0]!, effects[1]!].map((effect) => ({ ...effect })) };
  const snapshot = structuredClone(initial);
  const added = addCardEffect(initial, { type: "damage", target: "all_enemies", amount: 5, hits: 1 });
  assert.deepEqual(initial, snapshot);
  assert.deepEqual(added.effects.map((effect) => effect.id), ["damage_1", "heal_1", "damage_2"]);
  assert.deepEqual(
    addCardEffect(initial, { type: "damage", target: "all_enemies", amount: 5, hits: 1 }),
    added
  );

  const duplicated = duplicateCardEffect(added, "damage_1");
  assert.deepEqual(duplicated.effects.map((effect) => effect.id), ["damage_1", "damage_3", "heal_1", "damage_2"]);
  assert.deepEqual(duplicated.effects[1], { ...duplicated.effects[0], id: "damage_3" });

  const moved = moveCardEffect(duplicated, "damage_2", 0);
  assert.deepEqual(moved.effects.map((effect) => effect.id), ["damage_2", "damage_1", "damage_3", "heal_1"]);
  const deleted = deleteCardEffect(moved, "damage_3");
  assert.deepEqual(deleted.effects.map((effect) => effect.id), ["damage_2", "damage_1", "heal_1"]);
  assert.deepEqual(initial, snapshot);
  assert.throws(() => duplicateCardEffect(initial, "missing"), /not found/);
  assert.throws(() => moveCardEffect(initial, "damage_1", 10), /out of bounds/);
  assert.throws(() => deleteCardEffect(initial, "missing"), /not found/);

  const defaultEffect = addCardEffect({ ...complete(), effects: [] }, "buff");
  assert.deepEqual(defaultEffect.effects, [{
    id: "buff_1",
    type: "buff",
    target: "single_enemy",
    status: "status",
    stacks: 1,
    duration: 1
  }]);
  const movedByIndex = moveCardEffect(added, 2, "up");
  assert.deepEqual(movedByIndex.effects.map((effect) => effect.id), ["damage_1", "damage_2", "heal_1"]);
  const duplicatedByIndex = duplicateCardEffect(movedByIndex, 0);
  assert.deepEqual(duplicatedByIndex.effects.map((effect) => effect.id), ["damage_1", "damage_3", "damage_2", "heal_1"]);
  assert.deepEqual(deleteCardEffect(duplicatedByIndex, 1).effects.map((effect) => effect.id), ["damage_1", "damage_2", "heal_1"]);
  const invalidDraft = { ...initial, effects: [{ ...initial.effects[0]!, amount: 0 }] };
  assert.deepEqual(deleteCardEffect(invalidDraft, 0).effects, []);
});

test("advanced JSON accepts valid/warning documents and preserves valid state on every failure", () => {
  const current = complete();
  const snapshot = structuredClone(current);
  const edited = { ...complete(), value: 55 };
  const accepted = parseAdvancedGameMetadataJson(JSON.stringify(edited), current);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.validation.status, "valid");
  assert.deepEqual(accepted.metadata, edited);

  const warningDocument = { ...complete(), description: "" };
  const warning = parseAdvancedGameMetadataJson(JSON.stringify(warningDocument), current);
  assert.equal(warning.accepted, true);
  assert.equal(warning.validation.status, "warnings");

  const malformed = parseAdvancedGameMetadataJson("{ nope", current);
  assert.equal(malformed.accepted, false);
  assert.equal(malformed.validation.status, "invalid");
  assert.deepEqual(malformed.metadata, snapshot);
  assert.notEqual(malformed.metadata, current);

  const invalidSchema = parseAdvancedGameMetadataJson(JSON.stringify({ ...complete(), schema_version: 1 }), current);
  assert.equal(invalidSchema.accepted, false);
  assert.deepEqual(invalidSchema.metadata, snapshot);
  invalidSchema.metadata.effects[0]!.id = "local_edit";
  assert.deepEqual(current, snapshot);
});

test("integration aliases preserve the strict, structured and transactional contracts", () => {
  assert.deepEqual(parseGameMetadata(v1), migrateGameMetadataV1(v1));
  assert.deepEqual(validateGameMetadataDocument(complete()), validateGameMetadataV2(complete()));
  const advanced = parseAdvancedGameMetadata(JSON.stringify(complete()));
  assert.equal(advanced.ok, true);
  assert.deepEqual(advanced.metadata, complete());
});
