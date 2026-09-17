import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  addCardToSet,
  assignCardToAxieSlot,
  createAxieSlot,
  createCardSet,
  getCardSet
} from "../src/card-sets.ts";
import { cardStudioPaths, defaultGameMetadata } from "../src/card-studio.ts";
import { buildCatalog, findCard, type CatalogCard } from "../src/catalog.ts";
import { acquireCardImage, sha256 } from "../src/downloader.ts";
import {
  adjacentCardId,
  copyGameplay,
  createEditorHistory,
  pasteGameplay,
  pushEditorHistory,
  redoEditorHistory,
  undoEditorHistory
} from "../src/editor-session.ts";
import { exportGameSet } from "../src/game-set-exporter.ts";
import { validateGameCardDocument } from "../src/game-card-exporter.ts";
import { buildProductionDashboard, inspectProductionCard } from "../src/production-status.ts";
import { fetchCards } from "../src/source.ts";
import { discardStudioDraft, loadStudioDraft, saveStudioDraft } from "../src/studio-drafts.ts";
import { createCardStudioService } from "../src/studio-service.ts";

const workingRoot = await mkdtemp(join(tmpdir(), "axie-card-studio-v3-"));
const reportPath = resolve("output/acceptance/card_studio_v3/acceptance_report.json");

try {
  const source = await fetchCards();
  const catalog = buildCatalog(source.cards);
  const selected = [findCard(catalog, "Furball"), findCard(catalog, "Ant"), findCard(catalog, "Teal Shell")];
  const sourceSnapshot = JSON.stringify(selected);
  const studio = createCardStudioService({
    root: workingRoot,
    layoutPath: resolve("config/card_layout.json"),
    imageCache: resolve("cache/images")
  });

  let set = await createCardSet(workingRoot, "First Battle Set");
  for (const card of selected) set = await addCardToSet(workingRoot, set.id, card.id);
  set = await createAxieSlot(workingRoot, set.id, "Starter Beast");
  set = await createAxieSlot(workingRoot, set.id, "Starter Mixed");
  set = await assignCardToAxieSlot(workingRoot, set.id, set.axies[0]!.id, selected[0]!.id);
  set = await assignCardToAxieSlot(workingRoot, set.id, set.axies[0]!.id, selected[1]!.id);
  set = await assignCardToAxieSlot(workingRoot, set.id, set.axies[1]!.id, selected[2]!.id);

  const furball = selected[0]!;
  const furballMetadata = {
    ...defaultGameMetadata(furball),
    cost: 1,
    value: 40,
    card_type: "attack",
    description: "Deal 2 hits.",
    targeting: { mode: "single_enemy" as const },
    effects: [{ id: "damage_1", type: "damage" as const, target: "selected" as const, amount: 20, hits: 2 }]
  };
  await studio.saveMetadata(furball, furballMetadata);

  let history = createEditorHistory(furballMetadata);
  const changedDescription = { ...history.present, description: "Acceptance edit before Undo." };
  history = pushEditorHistory(history, changedDescription);
  history = undoEditorHistory(history);
  if (!isDeepStrictEqual(history.present, furballMetadata)) throw new Error("Undo did not restore Furball metadata");
  history = redoEditorHistory(history);
  if (history.present.description !== changedDescription.description) throw new Error("Redo did not restore the accepted edit");

  const ant = selected[1]!;
  const antBase = {
    ...defaultGameMetadata(ant),
    cost: 1,
    value: 30,
    card_type: "skill",
    description: "Acceptance target metadata."
  };
  const pastedAnt = pasteGameplay(antBase, copyGameplay(furballMetadata));
  const expectedAntIdentity = defaultGameMetadata(ant);
  if (pastedAnt.id !== expectedAntIdentity.id || pastedAnt.class !== expectedAntIdentity.class || pastedAnt.part !== expectedAntIdentity.part) {
    throw new Error("Paste Gameplay changed destination identity");
  }
  if (pastedAnt.name !== antBase.name || pastedAnt.cost !== antBase.cost || pastedAnt.value !== antBase.value || pastedAnt.description !== antBase.description) {
    throw new Error("Paste Gameplay changed non-gameplay fields");
  }
  if (!isDeepStrictEqual(pastedAnt.effects, furballMetadata.effects) || !isDeepStrictEqual(pastedAnt.targeting, furballMetadata.targeting)) {
    throw new Error("Paste Gameplay did not copy targeting and effects");
  }
  await studio.saveMetadata(ant, pastedAnt);

  const tealShell = selected[2]!;
  const tealMetadata = {
    ...defaultGameMetadata(tealShell),
    cost: 1,
    value: 35,
    card_type: "attack",
    description: "Acceptance configured card.",
    targeting: { mode: "all_enemies" as const },
    effects: [{ id: "damage_1", type: "damage" as const, target: "all_enemies" as const, amount: 35, hits: 1 }]
  };
  await studio.saveMetadata(tealShell, tealMetadata);
  const navigationStart = set.cards[0]!;
  const navigationNext = adjacentCardId(set.cards, navigationStart, "next");
  if (!navigationNext || navigationNext === navigationStart) throw new Error("Save & Next navigation did not resolve the following set card");

  const confirmedBeforeDraft = await readFile(cardStudioPaths(furball, workingRoot).data, "utf8");
  await saveStudioDraft(furball, { ...furballMetadata, cost: -1 }, workingRoot);
  const recoveredDraft = await loadStudioDraft(furball, workingRoot);
  if (!recoveredDraft.available || (recoveredDraft.draft?.metadata as { cost?: number }).cost !== -1) {
    throw new Error("Draft recovery did not restore the unconfirmed snapshot");
  }
  if (await readFile(cardStudioPaths(furball, workingRoot).data, "utf8") !== confirmedBeforeDraft) {
    throw new Error("Draft recovery modified confirmed metadata");
  }
  await discardStudioDraft(furball, workingRoot);
  if ((await loadStudioDraft(furball, workingRoot)).available) throw new Error("Discard Draft left a recovery file");

  const production = await Promise.all(selected.map(async (card) => ({
    card,
    production: await inspectProductionCard(card, { root: workingRoot, imageCache: resolve("cache/images") })
  })));
  if (production.some(({ production: state }) => !state.game_ready || state.clean_available || state.rendered_available)) {
    throw new Error("Production status or false Clean/Rendered availability is incorrect");
  }
  const dashboard = await buildProductionDashboard({
    catalog: selected,
    sets: [await getCardSet(workingRoot, set.id)],
    currentSetId: set.id,
    options: { root: workingRoot, imageCache: resolve("cache/images") }
  });
  if (dashboard.counts.total !== selected.length || dashboard.counts.game_ready !== selected.length || dashboard.counts.blocked !== 0) {
    throw new Error("Production Dashboard counts do not match the set");
  }

  const originals = new Map<string, Uint8Array>();
  for (const card of selected) originals.set(card.id, (await acquireCardImage(card, { cacheDir: resolve("cache/images") })).bytes);
  const rawHashesBefore = Object.fromEntries([...originals].map(([id, bytes]) => [id, sha256(bytes)]));
  const exportRoot = resolve(workingRoot, "export");
  const exported = await exportGameSet({
    set: await getCardSet(workingRoot, set.id),
    candidates: production,
    visualSource: "original",
    readyOnly: false,
    exportRoot,
    exportOne: async (card, visualSource, temporaryRoot) => {
      const loaded = await studio.load(card);
      return studio.exportGameCard(card, loaded.metadata, visualSource, temporaryRoot);
    }
  });
  if (exported.report.failed !== 0 || exported.report.skipped !== 0 || exported.report.success !== selected.length) {
    throw new Error("First Battle Set export did not complete successfully");
  }
  if (exported.manifest.cards.some((card) => card.card_json.includes("\\") || card.card_png.includes("\\") || /^[A-Za-z]:/u.test(card.card_json))) {
    throw new Error("Manifest contains a non-portable path");
  }

  const sourceByLocalId = new Map<string, CatalogCard>(selected.map((card) => [defaultGameMetadata(card).id, card]));
  for (const entry of exported.manifest.cards) {
    const png = await readFile(resolve(exported.directory, ...entry.card_png.split("/")));
    const json = validateGameCardDocument(JSON.parse(await readFile(resolve(exported.directory, ...entry.card_json.split("/")), "utf8")) as unknown);
    if (sha256(png) !== entry.sha256 || json.visual.sha256 !== entry.sha256) throw new Error(`Manifest hash mismatch for ${entry.card_id}`);
    const card = sourceByLocalId.get(entry.card_id);
    const original = card ? originals.get(card.id) : undefined;
    if (!original || !Buffer.from(png).equals(Buffer.from(original))) throw new Error(`Original placeholder changed bytes for ${entry.card_id}`);
  }
  const rawHashesAfter: Record<string, string> = {};
  for (const card of selected) rawHashesAfter[card.id] = sha256((await acquireCardImage(card, { cacheDir: resolve("cache/images") })).bytes);
  if (!isDeepStrictEqual(rawHashesAfter, rawHashesBefore)) throw new Error("RAW bytes changed during V3 acceptance");
  if (JSON.stringify(selected) !== sourceSnapshot) throw new Error("Source catalog objects changed during V3 acceptance");

  const report = {
    set: { id: set.id, name: set.name, cards: set.cards.length, axies: set.axies.length },
    cards: selected.map((card) => ({ sanity_id: card.id, id: defaultGameMetadata(card).id, name: card.name })),
    production: dashboard.counts,
    checks: {
      card_set_created: true,
      two_axie_slots_created: set.axies.length === 2,
      cards_added_and_assigned: set.cards.length === selected.length && set.axies.every((slot) => slot.cards.length > 0),
      furball_v2_damage_amount_20_hits_2: furballMetadata.effects[0].amount === 20 && furballMetadata.effects[0].hits === 2,
      undo_redo: true,
      gameplay_copy_paste_preserved_identity: true,
      draft_recovery_confirmed_metadata_untouched: true,
      original_placeholder_byte_identical: true,
      no_false_clean_or_rendered: true,
      save_and_next_navigation: true,
      production_dashboard_backend_derived: true,
      batch_game_export: true,
      manifest_relative_posix_paths: true,
      manifest_hashes_verified: true,
      raw_byte_identical: true,
      source_metadata_unchanged: true
    },
    export: {
      set_id: exported.manifest.set_id,
      card_count: exported.manifest.export.card_count,
      success: exported.report.success,
      failed: exported.report.failed,
      skipped: exported.report.skipped
    },
    raw_sha256: rawHashesAfter
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, report_path: reportPath }, null, 2));
} finally {
  await rm(workingRoot, { recursive: true, force: true });
}
