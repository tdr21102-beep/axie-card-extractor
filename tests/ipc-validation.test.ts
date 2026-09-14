import assert from "node:assert/strict";
import test from "node:test";
import { validateBatchRequest, validateCardId, validateFilters } from "../src/ipc-validation.ts";

test("IPC validation accepts supported values", () => {
  assert.equal(validateCardId("card-id"), "card-id");
  assert.deepEqual(validateFilters({ search: "teal", className: "Aqua", part: "Horn" }), { search: "teal", className: "Aqua", part: "Horn" });
  assert.equal(validateBatchRequest({ filters: { search: "", className: null, part: null }, layout: "flat", exportMetadata: true }).layout, "flat");
});

test("IPC validation rejects unsupported filters and layouts", () => {
  assert.throws(() => validateCardId(""), /Invalid card id/);
  assert.throws(() => validateFilters({ search: "", className: "Secret", part: null }), /Invalid class/);
  assert.throws(() => validateBatchRequest({ filters: {}, layout: "elsewhere", exportMetadata: true }), /Invalid output layout/);
});
