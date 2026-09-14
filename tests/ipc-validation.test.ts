import assert from "node:assert/strict";
import test from "node:test";
import { validateBatchRequest, validateCardId, validateFilters, validateStudioMetadataRequest } from "../src/ipc-validation.ts";

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
  assert.deepEqual(validateStudioMetadataRequest({ cardId: "source-id", metadata: studioMetadata }).metadata, studioMetadata);
});

test("IPC validation rejects unsupported filters and layouts", () => {
  assert.throws(() => validateCardId(""), /Invalid card id/);
  assert.throws(() => validateFilters({ search: "", className: "Secret", part: null }), /Invalid class/);
  assert.throws(() => validateBatchRequest({ filters: {}, layout: "elsewhere", exportMetadata: true }), /Invalid output layout/);
  assert.throws(() => validateStudioMetadataRequest({ cardId: "", metadata: studioMetadata }), /Invalid card id/);
  assert.throws(() => validateStudioMetadataRequest({ cardId: "source-id", metadata: { ...studioMetadata, cost: -1 } }), /cost/i);
});
