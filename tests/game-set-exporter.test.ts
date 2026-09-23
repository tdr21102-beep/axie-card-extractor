import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { toCatalogCard, type CatalogCard } from "../src/catalog.ts";
import { defaultGameMetadata } from "../src/card-studio.ts";
import { sha256 } from "../src/downloader.ts";
import { exportGameSetWithPackages, type GameSetExportCandidate } from "../src/game-set-exporter.ts";
import type { CardSetDocument, ProductionCardState } from "../src/production-contract.ts";
import { card } from "./fixtures.ts";

function source(id: string, name: string, slug: string): CatalogCard {
  return toCatalogCard(card({ _id: id, title: name, slug }));
}

function state(card: CatalogCard, ready = true): ProductionCardState {
  return {
    card_id: card.id,
    status: ready ? "GAME_READY" : "VALID",
    metadata_exists: true,
    effect_count: 0,
    errors: 0,
    warnings: 0,
    issues: [],
    original_available: ready,
    clean_available: false,
    rendered_available: false,
    game_ready: ready,
    exportable_visual_sources: ready ? ["original"] : []
  };
}

const imageById = new Map<string, Uint8Array>([
  ["catalog-a", new Uint8Array([1, 2, 3])],
  ["catalog-z", new Uint8Array([4, 5, 6])]
]);

function fixture() {
  const alpha = source("catalog-z", "Alpha", "alpha-card");
  const zeta = source("catalog-a", "Zeta", "zeta-card");
  const set: CardSetDocument = {
    schema_version: 1,
    id: "first_battle_set",
    name: "First Battle Set",
    cards: [alpha.id, zeta.id],
    axies: [
      { id: "axie_01", name: "Starter", cards: [alpha.id, zeta.id] },
      { id: "axie_02", name: null, cards: [] }
    ]
  };
  const candidates: GameSetExportCandidate[] = [
    { card: alpha, production: state(alpha) },
    { card: zeta, production: state(zeta) }
  ];
  return { alpha, zeta, set, candidates };
}

async function run(root: string, overrides: Partial<Parameters<typeof exportGameSetWithPackages>[0]> = {}) {
  const data = fixture();
  return exportGameSetWithPackages({
    set: data.set,
    candidates: data.candidates,
    visualSource: "original",
    readyOnly: true,
    exportRoot: root,
    metadataFor: (catalogCard) => defaultGameMetadata(catalogCard),
    imageBytesFor: (catalogCard) => imageById.get(catalogCard.id)!,
    ...overrides
  });
}

test("batch game set export writes deterministic portable manifest, report and hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set Windows Root "));
  const first = await run(root);
  assert.match(first.directory.replaceAll("\\", "/"), /game_export\/first_battle_set$/u);
  assert.deepEqual(first.manifest.cards.map((entry) => entry.card_id), ["alpha_card", "zeta_card"]);
  assert.deepEqual(first.report.cards.map((entry) => entry.card_id), ["catalog-a", "catalog-z"]);
  assert.equal(first.report.success, 2);
  assert.equal(first.report.failed, 0);
  assert.equal(first.manifest.export.card_count, 2);
  assert.deepEqual(first.manifest.axies[0]?.cards, ["alpha_card", "zeta_card"]);
  for (const entry of first.manifest.cards) {
    assert.equal(entry.card_png.includes("\\"), false);
    assert.equal(entry.card_json.includes("\\"), false);
    assert.equal(entry.card_png.startsWith("cards/"), true);
    const bytes = await readFile(join(first.directory, ...entry.card_png.split("/")));
    assert.equal(entry.sha256, sha256(bytes));
  }
  const manifestBefore = await readFile(first.manifest_path, "utf8");
  const reportBefore = await readFile(first.report_path, "utf8");
  const repeated = await run(root);
  assert.deepEqual(repeated.manifest, first.manifest);
  assert.equal(repeated.report.success, 0);
  assert.equal(repeated.report.skipped, 2);
  assert.deepEqual(repeated.report.cards.map((entry) => entry.status), ["skipped", "skipped"]);
  assert.match(first.report_path.replaceAll("\\", "/"), /report\.json$/u);
  assert.match(repeated.report_path.replaceAll("\\", "/"), /report_2\.json$/u);
  assert.equal(await readFile(first.manifest_path, "utf8"), manifestBefore);
  assert.equal(await readFile(first.report_path, "utf8"), reportBefore);
  assert.notEqual(await readFile(repeated.report_path, "utf8"), reportBefore);
  assert.doesNotMatch(manifestBefore, /[A-Z]:\\|[A-Z]:\//u);
  assert.doesNotMatch(reportBefore, /[A-Z]:\\|[A-Z]:\//u);
});

test("every batch execution gets a conflict-safe report without overwriting prior reports", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-report-"));
  const directory = join(root, "game_export", "first_battle_set");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "report.json"), "user-owned report\n");
  const first = await run(root);
  const second = await run(root);
  assert.match(first.report_path.replaceAll("\\", "/"), /report_2\.json$/u);
  assert.match(second.report_path.replaceAll("\\", "/"), /report_3\.json$/u);
  assert.equal(await readFile(join(directory, "report.json"), "utf8"), "user-owned report\n");
});

test("batch game set export preserves Card Type V2 and Damage Type V1", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-card-types-"));
  const result = await run(root, {
    metadataFor: (catalogCard) => ({
      ...defaultGameMetadata(catalogCard),
      card_type: "magical_attack",
      effects: [{ id: "damage_1", type: "damage", damage_type: "magical", target: "single_enemy", amount: 60, hits: 1 }]
    })
  });
  const entry = result.manifest.cards[0]!;
  const exported = JSON.parse(await readFile(join(result.directory, ...entry.card_json.split("/")), "utf8")) as { card_type: string; effects: Array<{ damage_type?: string }> };
  assert.equal(exported.card_type, "magical_attack");
  assert.equal(exported.effects[0]?.damage_type, "magical");
});

test("a conflicting manifest writes a new report but never publishes a newly-ready orphan package", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-manifest-snapshot-"));
  const data = fixture();
  const firstCandidates = [
    { card: data.alpha, production: state(data.alpha, false) },
    { card: data.zeta, production: state(data.zeta) }
  ];
  const first = await run(root, { candidates: firstCandidates });
  assert.equal(first.report.success, 1);
  assert.equal(first.report.skipped, 1);
  const manifestBefore = await readFile(first.manifest_path, "utf8");
  const newlyReadyPackage = join(first.directory, "cards", "aqua", "alpha_card", "card.png");
  await assert.rejects(run(root), /manifest\.json.*different contents/i);
  assert.equal(await readFile(first.manifest_path, "utf8"), manifestBefore);
  await assert.rejects(readFile(newlyReadyPackage), { code: "ENOENT" });
  const conflictReportPath = join(first.directory, "report_2.json");
  const conflictReport = JSON.parse(await readFile(conflictReportPath, "utf8"));
  assert.equal(conflictReport.cards.find((entry: { card_id: string }) => entry.card_id === data.alpha.id)?.status, "failed");
  assert.match(
    conflictReport.cards.find((entry: { card_id: string }) => entry.card_id === data.alpha.id)?.error ?? "",
    /manifest\.json.*different contents/i
  );
});

test("readyOnly is explicit and records blocked cards as skipped", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-ready-"));
  const data = fixture();
  data.candidates[0] = { card: data.alpha, production: state(data.alpha, false) };
  const result = await run(root, { candidates: data.candidates });
  assert.equal(result.report.success, 1);
  assert.equal(result.report.skipped, 1);
  assert.equal(result.report.failed, 0);
  assert.equal(result.manifest.cards.length, 1);
  assert.deepEqual(result.manifest.axies[0]?.cards, ["zeta_card"]);
});

test("Game Set Export never completes an invalid Attack and excludes it from the manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-invalid-attack-"));
  const data = fixture();
  const invalidAttack: ProductionCardState = {
    ...state(data.alpha, false),
    status: "DRAFT",
    errors: 1,
    issues: [{ path: "effects", message: "Attack card requires at least one gameplay effect.", severity: "error" }]
  };
  const metadataFor = (catalogCard: CatalogCard) => catalogCard.id === data.alpha.id
    ? { ...defaultGameMetadata(catalogCard), card_type: "attack", value: 30, description: "Deal 30 damage.", effects: [] }
    : defaultGameMetadata(catalogCard);
  const result = await run(root, { candidates: [{ card: data.alpha, production: invalidAttack }, data.candidates[1]!], metadataFor });
  assert.equal(result.report.success, 1);
  assert.equal(result.report.skipped, 1);
  assert.equal(result.manifest.cards.some((entry) => entry.card_id === "alpha_card"), false);
  assert.equal(result.report.cards.find((entry) => entry.card_id === data.alpha.id)?.status, "skipped");

  const strictRoot = await mkdtemp(join(tmpdir(), "axie-game-set-invalid-attack-strict-"));
  await assert.rejects(
    run(strictRoot, { candidates: [{ card: data.alpha, production: invalidAttack }, data.candidates[1]!], metadataFor, readyOnly: false }),
    /Game set export blocked before writing/iu
  );
});

test("readiness is enforced for the requested visual source before exporting", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-source-ready-"));
  const data = fixture();
  let calls = 0;
  await assert.rejects(exportGameSetWithPackages({
      set: data.set,
      candidates: data.candidates,
      visualSource: "rendered",
      readyOnly: false,
      exportRoot: root,
      metadataFor: (catalogCard) => defaultGameMetadata(catalogCard),
      imageBytesFor: () => {
        calls += 1;
        return new Uint8Array([1]);
      }
    }), /blocked before writing/i);
  assert.equal(calls, 0);
  await assert.rejects(readFile(join(root, "game_export", "first_battle_set", "manifest.json")), { code: "ENOENT" });
});

test("readyOnly false validates all output identities before any write", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-preflight-"));
  const data = fixture();
  data.candidates[1] = {
    card: { ...data.zeta, local_name: data.alpha.local_name, class: data.alpha.class },
    production: state(data.zeta)
  };
  let calls = 0;
  await assert.rejects(run(root, {
    candidates: data.candidates,
    readyOnly: false,
    imageBytesFor: () => {
      calls += 1;
      return new Uint8Array([1]);
    }
  }), /blocked before writing.*conflicts/iu);
  assert.equal(calls, 0);
  await assert.rejects(readdir(join(root, "game_export")), { code: "ENOENT" });
});

test("runtime Card Set validation rejects traversal before touching the export root", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-traversal-"));
  const data = fixture();
  await assert.rejects(run(root, { set: { ...data.set, id: "../escape" } }), /snake_case identifier/i);
  await assert.rejects(readdir(join(root, "game_export")), { code: "ENOENT" });
});

test("batch isolates per-card failures and still exports the remaining cards", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-isolation-"));
  const result = await run(root, {
    imageBytesFor: (catalogCard) => {
      if (catalogCard.id === "catalog-a") throw new Error("fixture render failed");
      return imageById.get(catalogCard.id)!;
    }
  });
  assert.equal(result.report.failed, 1);
  assert.equal(result.report.success, 1);
  assert.equal(result.report.cards[0]?.error, "fixture render failed");
  assert.deepEqual(result.manifest.cards.map((entry) => entry.card_id), ["alpha_card"]);
});

test("batch reports never persist absolute Windows paths from isolated failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-portable-error-"));
  const result = await run(root, {
    imageBytesFor: (catalogCard) => {
      if (catalogCard.id === "catalog-a") throw new Error("Could not read C:\\Users\\Example\\secret-card.png");
      return imageById.get(catalogCard.id)!;
    }
  });
  const error = result.report.cards.find((entry) => entry.card_id === "catalog-a")?.error ?? "";
  assert.equal(error.includes("<path>"), true);
  assert.doesNotMatch(error, /[A-Za-z]:[\\/]/u);
  assert.doesNotMatch(await readFile(result.report_path, "utf8"), /[A-Za-z]:[\\/]/u);
});

test("conflicting card output is reported and never overwritten", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-conflict-"));
  const conflict = join(root, "game_export", "first_battle_set", "cards", "aqua", "zeta_card", "card.png");
  await mkdir(dirname(conflict), { recursive: true });
  const existing = new Uint8Array([99, 98, 97]);
  await writeFile(conflict, existing);
  const result = await run(root);
  assert.equal(result.report.failed, 1);
  assert.equal(result.report.success, 1);
  assert.match(result.report.cards[0]?.error ?? "", /conflict/i);
  assert.deepEqual(new Uint8Array(await readFile(conflict)), existing);
  assert.equal(result.manifest.cards.some((entry) => entry.card_id === "zeta_card"), false);
});

test("missing catalog references become isolated failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "axie-game-set-missing-"));
  const data = fixture();
  data.set.cards.push("missing-catalog-id");
  const result = await run(root, { set: data.set });
  assert.equal(result.report.failed, 1);
  assert.equal(result.report.cards.find((entry) => entry.card_id === "missing-catalog-id")?.status, "failed");
  assert.equal(result.report.success, 2);
});
