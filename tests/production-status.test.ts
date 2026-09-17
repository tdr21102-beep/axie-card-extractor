import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { toCatalogCard } from "../src/catalog.ts";
import { cardStudioPaths, defaultGameMetadata, saveGameMetadata } from "../src/card-studio.ts";
import {
  buildProductionDashboard,
  inspectProductionCard,
  productionCounts,
  requireAttackGameplayRule,
  requireEffectsRule
} from "../src/production-status.ts";
import type { CardSetDocument } from "../src/production-contract.ts";
import { card } from "./fixtures.ts";

const source = () => toCatalogCard(card({ _id: "sanity-furball", title: "Furball", slug: "furball" }));
function validPng(): Buffer {
  const canvas = createCanvas(2, 2);
  const context = canvas.getContext("2d");
  context.fillStyle = "#126b8c";
  context.fillRect(0, 0, 2, 2);
  return canvas.toBuffer("image/png");
}

test("production status derives UNCONFIGURED and cold source availability without requiring cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-status-cold-"));
  const state = await inspectProductionCard(source(), { root, imageCache: join(root, "empty-cache") });
  assert.equal(state.status, "UNCONFIGURED");
  assert.equal(state.metadata_exists, false);
  assert.equal(state.original_available, true);
  assert.deepEqual(state.exportable_visual_sources, ["original"]);
  assert.equal(state.clean_available, false);
  assert.equal(state.rendered_available, false);
});

test("valid V2 metadata with warnings is GAME_READY when an original source is exportable", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-status-ready-"));
  const catalogCard = source();
  await saveGameMetadata(catalogCard, defaultGameMetadata(catalogCard), root);
  const state = await inspectProductionCard(catalogCard, { root });
  assert.equal(state.status, "GAME_READY");
  assert.equal(state.game_ready, true);
  assert.ok(state.warnings > 0);
  assert.equal(state.errors, 0);
  assert.equal(state.effect_count, 0);
});

test("Attack cards need explicit gameplay while non-Attack drafts keep the extensible policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-status-attack-policy-"));
  const catalogCard = source();
  const emptyAttack = { ...defaultGameMetadata(catalogCard), card_type: "attack", value: 30, description: "Deal 30 damage.", effects: [] };
  await saveGameMetadata(catalogCard, emptyAttack, root);
  const blocked = await inspectProductionCard(catalogCard, { root });
  assert.equal(blocked.status, "DRAFT");
  assert.equal(blocked.game_ready, false);
  assert.equal(blocked.errors, 1);
  assert.match(blocked.issues.find((issue) => issue.severity === "error")?.message ?? "", /Attack card requires at least one gameplay effect/);

  const validAttack = { ...emptyAttack, effects: [{ id: "damage_1", type: "damage" as const, target: "all_enemies" as const, amount: 30, hits: 1 }] };
  await saveGameMetadata(catalogCard, validAttack, root);
  const ready = await inspectProductionCard(catalogCard, { root });
  assert.equal(ready.status, "GAME_READY");
  assert.equal(ready.game_ready, true);

  await saveGameMetadata(catalogCard, { ...emptyAttack, card_type: "skill" }, root);
  const skill = await inspectProductionCard(catalogCard, { root });
  assert.equal(skill.status, "GAME_READY");
  assert.equal(skill.game_ready, true);
  assert.equal(requireAttackGameplayRule.evaluate(defaultGameMetadata(catalogCard), catalogCard), null);
});

test("readiness rule errors derive DRAFT while warnings do not block GAME_READY", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-status-policy-"));
  const catalogCard = source();
  await saveGameMetadata(catalogCard, defaultGameMetadata(catalogCard), root);
  const blocked = await inspectProductionCard(catalogCard, { root, readinessRules: [requireEffectsRule] });
  assert.equal(blocked.status, "DRAFT");
  assert.equal(blocked.game_ready, false);
  assert.equal(blocked.errors, 1);
  const warningOnly = await inspectProductionCard(catalogCard, {
    root,
    readinessRules: [{
      id: "warning_only",
      evaluate: () => ({ path: "effects", message: "Review recommended", severity: "warning" })
    }]
  });
  assert.equal(warningOnly.status, "GAME_READY");
  assert.equal(warningOnly.game_ready, true);
  assert.ok(warningOnly.warnings > 0);
  const withEffect = {
    ...defaultGameMetadata(catalogCard),
    effects: [{ id: "damage_1", type: "damage" as const, target: "selected" as const, amount: 20, hits: 2 }]
  };
  await saveGameMetadata(catalogCard, withEffect, root);
  assert.equal((await inspectProductionCard(catalogCard, { root, readinessRules: [requireEffectsRule] })).status, "GAME_READY");
});

test("corrupt or identity-mismatched metadata is DRAFT and does not crash the dashboard", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-status-draft-"));
  const catalogCard = source();
  const path = cardStudioPaths(catalogCard, root).data;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{broken");
  let state = await inspectProductionCard(catalogCard, { root });
  assert.equal(state.status, "DRAFT");
  assert.equal(state.errors, 1);
  await writeFile(path, JSON.stringify({ ...defaultGameMetadata(catalogCard), id: "other" }));
  state = await inspectProductionCard(catalogCard, { root });
  assert.equal(state.status, "DRAFT");
  assert.match(state.issues.at(-1)?.message ?? "", /identity/i);
});

test("clean and rendered indicators require real PNG files and never fall back to original", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-status-visual-"));
  const catalogCard = source();
  const paths = cardStudioPaths(catalogCard, root);
  await mkdir(dirname(paths.clean), { recursive: true });
  await mkdir(dirname(paths.rendered), { recursive: true });
  await writeFile(paths.clean, "not a png");
  await writeFile(paths.rendered, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]));
  let state = await inspectProductionCard(catalogCard, { root });
  assert.equal(state.original_available, true);
  assert.equal(state.clean_available, false);
  assert.equal(state.rendered_available, false);
  assert.deepEqual(state.exportable_visual_sources, ["original"]);
  const png = validPng();
  await writeFile(paths.clean, png);
  await writeFile(paths.rendered, png);
  state = await inspectProductionCard(catalogCard, { root });
  assert.equal(state.clean_available, true);
  assert.equal(state.rendered_available, true);
  assert.deepEqual(state.exportable_visual_sources, ["original", "rendered"]);
});

test("dashboard scopes cards by stable catalog IDs and derives all counters", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-dashboard-"));
  const first = source();
  const second = { ...source(), id: "sanity-ant", name: "Ant", slug: "ant", local_name: "ant" };
  const outside = { ...source(), id: "sanity-cottontail", name: "Cottontail", slug: "cottontail", local_name: "cottontail" };
  await saveGameMetadata(first, defaultGameMetadata(first), root);
  const set: CardSetDocument = {
    schema_version: 1,
    id: "first_battle_set",
    name: "First Battle Set",
    cards: [first.id, second.id],
    axies: []
  };
  const dashboard = await buildProductionDashboard({ catalog: [first, second, outside], sets: [set], currentSetId: set.id, options: { root } });
  assert.deepEqual(dashboard.cards.map((state) => state.card_id), [first.id, second.id, outside.id]);
  assert.deepEqual(dashboard.counts, {
    total: 2,
    unconfigured: 1,
    draft: 0,
    valid: 0,
    game_ready: 1,
    warnings: dashboard.cards[0]!.warnings,
    blocked: 1
  });
  assert.deepEqual(productionCounts(dashboard.cards.slice(0, 2)), dashboard.counts);
});

test("metadata without any exportable source remains VALID rather than falsely GAME_READY", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-status-no-visual-"));
  const catalogCard = { ...source(), image_url: null, image_asset_id: null };
  await saveGameMetadata(catalogCard, defaultGameMetadata(catalogCard), root);
  const state = await inspectProductionCard(catalogCard, { root });
  assert.equal(state.status, "VALID");
  assert.equal(state.game_ready, false);
  assert.deepEqual(state.exportable_visual_sources, []);
});
