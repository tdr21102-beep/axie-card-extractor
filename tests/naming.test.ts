import assert from "node:assert/strict";
import test from "node:test";
import { classDirectory, snakeCase } from "../src/naming.ts";

test("snake_case conversion", () => {
  assert.equal(snakeCase("Teal Shell"), "teal_shell");
  assert.equal(snakeCase("Cucumber Slice"), "cucumber_slice");
  assert.equal(snakeCase("Nut Cracker"), "nut_cracker");
  assert.equal(snakeCase("Grandma's Fan"), "grandmas_fan");
  assert.equal(snakeCase("  Cute bunny  "), "cute_bunny");
});

test("class directory conversion", () => {
  assert.equal(classDirectory("Aqua"), "aqua");
  assert.equal(classDirectory(null), "unknown");
});
