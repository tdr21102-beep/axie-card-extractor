import assert from "node:assert/strict";
import test from "node:test";
import { validateAxieSlotCardRequest, validateAxieSlotCreateRequest, validateAxieSlotRenameRequest, validateAxieSlotRequest, validateBatchRequest, validateCardId, validateCardSetCardRequest, validateCardSetId, validateCardSetNameRequest, validateCardSetRenameRequest, validateFilters, validateGameSetExportRequest, validateProductionDashboardRequest, validateStudioDraftSaveRequest, validateStudioGameExportRequest, validateStudioMetadataRequest } from "../src/ipc-validation.ts";

const studioMetadata = {
  id: "furball",
  name: "Furball",
  class: "beast",
  part: "back",
  cost: 1,
  value: 40,
  card_type: "attack",
  description: "Deal 2 hits."
};

test("IPC validation accepts supported values", () => {
  assert.equal(validateCardId("card-id"), "card-id");
  assert.deepEqual(validateFilters({ search: "teal", className: "Aqua", part: "Horn" }), { search: "teal", className: "Aqua", part: "Horn" });
  assert.equal(validateBatchRequest({ filters: { search: "", className: null, part: null }, layout: "flat", exportMetadata: true }).layout, "flat");
  const migrated = validateStudioMetadataRequest({ cardId: "source-id", metadata: studioMetadata }).metadata;
  assert.equal(migrated.schema_version, 2);
  assert.deepEqual(migrated.effects, []);
  assert.deepEqual(
    validateStudioMetadataRequest({ cardId: "source-id", metadata: migrated, visualLayoutOverrides: { schema_version: 1, fields: { name: { x: 501 } } } }).visualLayoutOverrides,
    { schema_version: 1, fields: { name: { x: 501 } } }
  );
  assert.equal(validateStudioGameExportRequest({ cardId: "source-id", metadata: migrated, visualSource: "original" }).visualSource, "original");
  assert.equal(validateCardSetId("first_battle_set"), "first_battle_set");
  assert.deepEqual(validateCardSetNameRequest({ name: " First Battle Set " }), { name: "First Battle Set" });
  assert.equal(validateCardSetRenameRequest({ setId: "first_battle_set", name: "Battle One" }).setId, "first_battle_set");
  assert.equal(validateCardSetCardRequest({ setId: "first_battle_set", cardId: "source-id" }).cardId, "source-id");
  assert.deepEqual(validateAxieSlotCreateRequest({ setId: "first_battle_set" }), { setId: "first_battle_set", name: null });
  assert.equal(validateAxieSlotRequest({ setId: "first_battle_set", slotId: "axie_01" }).slotId, "axie_01");
  assert.equal(validateAxieSlotRenameRequest({ setId: "first_battle_set", slotId: "axie_01", name: null }).name, null);
  assert.equal(validateAxieSlotCardRequest({ setId: "first_battle_set", slotId: "axie_01", cardId: "furball" }).cardId, "furball");
  assert.deepEqual(validateProductionDashboardRequest({ setId: null }), { setId: null });
  assert.equal(validateStudioDraftSaveRequest({ cardId: "furball", metadata: { ...migrated, cost: -1 } }).cardId, "furball");
  assert.deepEqual(validateGameSetExportRequest({ setId: "first_battle_set", visualSource: "original", readyOnly: true }), { setId: "first_battle_set", visualSource: "original", readyOnly: true });
});

test("IPC validation rejects unsupported filters and layouts", () => {
  assert.throws(() => validateCardId(""), /Invalid card id/);
  assert.throws(() => validateFilters({ search: "", className: "Secret", part: null }), /Invalid class/);
  assert.throws(() => validateBatchRequest({ filters: {}, layout: "elsewhere", exportMetadata: true }), /Invalid output layout/);
  assert.throws(() => validateStudioMetadataRequest({ cardId: "", metadata: studioMetadata }), /Invalid card id/);
  assert.throws(() => validateStudioMetadataRequest({ cardId: "source-id", metadata: { ...studioMetadata, cost: -1 } }), /cost/i);
  assert.throws(() => validateStudioMetadataRequest({ cardId: "source-id", metadata: studioMetadata, visualLayoutOverrides: { schema_version: 1, fields: { name: { unsupported: 2 } } } }), /unsupported property/i);
  assert.throws(() => validateStudioGameExportRequest({ cardId: "source-id", metadata: studioMetadata, visualSource: "raw" }), /visual source/i);
  assert.throws(() => validateCardSetNameRequest({ name: "  " }), /card set name/i);
  assert.throws(() => validateCardSetRenameRequest({ setId: "../escape", name: "Set" }), /card set id/i);
  assert.throws(() => validateCardSetId("../escape"), /card set id/i);
  assert.throws(() => validateAxieSlotRequest({ setId: "valid_set", slotId: "C:\\escape" }), /Axie slot id/i);
  assert.throws(() => validateStudioDraftSaveRequest({ cardId: "furball", metadata: "not-an-object" }), /draft metadata/i);
  assert.throws(() => validateGameSetExportRequest({ setId: "valid_set", visualSource: "original", readyOnly: "yes" }), /ready-only/i);
});
