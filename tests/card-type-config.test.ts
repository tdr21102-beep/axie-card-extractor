import assert from "node:assert/strict";
import test from "node:test";
import { loadCardTypeConfig, parseCardTypeConfig } from "../src/card-type-config.ts";

test("loads versioned extensible card type visuals without requiring icons", () => {
  const config = loadCardTypeConfig();
  assert.equal(config.version, 1);
  assert.deepEqual(Object.keys(config.types), ["attack", "skill", "secret", "power"]);
  assert.equal(config.types.attack?.icon_reference, null);
});

test("rejects unsafe icon references while allowing future card type keys", () => {
  const future = parseCardTypeConfig({ version: 1, types: { poison_attack: { label: "Poison Attack", icon_reference: "assets/icons/poison.png", style_key: "poison" } } });
  assert.equal(future.types.poison_attack?.style_key, "poison");
  assert.throws(() => parseCardTypeConfig({ version: 1, types: { attack: { label: "Attack", icon_reference: "../secret.png", style_key: "attack" } } }), /stay within/);
});
