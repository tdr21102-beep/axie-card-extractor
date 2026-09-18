import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import electronPath from "electron";

const smokeCase = process.env.AXIE_GUI_SMOKE_CASE ?? "gui_v3";
const smokeDir = resolve("output/acceptance", smokeCase);
const screenshotPath = resolve(smokeDir, "card_studio.png");
const smokeRoot = resolve(smokeDir, "studio_root");
const exportRoot = resolve(smokeDir, "export_root");
const electronProfile = resolve(smokeDir, "electron-profile");
const metadataPath = resolve(smokeRoot, "cards/data/beast/furball.json");
const antMetadataPath = resolve(smokeRoot, "cards/data/bug/ant.json");
const setPath = resolve(smokeRoot, "cards/sets/first_battle_set.json");
const gameCardPath = resolve(exportRoot, "furball.png");
const gameMetadataPath = resolve(exportRoot, "furball.json");
const setManifestPath = resolve(exportRoot, "game_export/first_battle_set/manifest.json");
const setFurballPath = resolve(exportRoot, "game_export/first_battle_set/cards/beast/furball/card.png");
await rm(smokeDir, { recursive: true, force: true });
await mkdir(dirname(metadataPath), { recursive: true });
await writeFile(metadataPath, `${JSON.stringify({
  id: "furball",
  name: "Furball",
  class: "beast",
  part: "back",
  cost: 1,
  value: 40,
  card_type: "attack",
  description: "Deal 2 hits."
}, null, 2)}\n`);
await mkdir(dirname(antMetadataPath), { recursive: true });
await writeFile(antMetadataPath, `${JSON.stringify({
  schema_version: 2,
  id: "ant",
  name: "Ant",
  class: "bug",
  part: "tail",
  cost: 1,
  value: 30,
  card_type: "skill",
  description: "GUI seed metadata.",
  targeting: { mode: "single_enemy" },
  effects: []
}, null, 2)}\n`);
const child = spawn(electronPath, [".", `--user-data-dir=${electronProfile}`], {
  stdio: "inherit",
  env: {
    ...process.env,
    AXIE_GUI_SMOKE_OUTPUT: screenshotPath,
    AXIE_GUI_SMOKE_ROOT: smokeRoot,
    AXIE_GUI_SMOKE_EXPORT_ROOT: exportRoot,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
  }
});

const exitCode = await new Promise((resolveExit, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    readFile(`${screenshotPath}.stage`, "utf8").catch(() => "not started").then((stage) => {
      reject(new Error(`Electron GUI smoke test timed out (stage: ${stage.trim()})`));
    });
  }, 120_000);
  child.once("error", (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once("exit", (code) => {
    clearTimeout(timeout);
    resolveExit(code ?? 1);
  });
});
if (exitCode !== 0) throw new Error(`Electron exited with code ${exitCode}`);

const report = JSON.parse(await readFile(`${screenshotPath}.json`, "utf8"));
if (!report.ok) throw new Error(report.error ?? "Card Studio GUI smoke test failed");
for (const expected of ["Card Catalog", "Batch Export", "Card Studio", "Production workspace", "Card Sets", "First Battle Set", "Axie Slot", "Production browser", "Furball", "Source Metadata", "Game Metadata", "Gameplay", "Advanced JSON", "Undo", "Redo", "Copy Gameplay", "Save & Next", "Original / Placeholder", "Clean Base unavailable", "Export Game Card", "Export Game Set", "Original placeholder"]) {
  if (!report.text.includes(expected)) throw new Error(`GUI smoke report is missing: ${expected}`);
}
const savedMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
if (savedMetadata.schema_version !== 2 || savedMetadata.effects?.[0]?.type !== "damage" || savedMetadata.effects[0].target !== "selected" || savedMetadata.effects[0].amount !== 20 || savedMetadata.effects[0].hits !== 3) {
  throw new Error("V2 GUI effect edits were not persisted through Save Metadata");
}
if (report.amount !== "20" || report.initialHits !== "2" || report.editedHits !== "3") {
  throw new Error("GUI did not demonstrate the Damage amount 20, Hits 2→3 flow");
}
if (report.setId !== "first_battle_set" || report.slotId !== "axie_01" || !report.saveAndNext || !report.gameSetExported || !report.browserControlsVisible || !report.allCardsCountVerified || !report.searchResultVisible || !report.searchResultClickable || !report.listFirstReachable || !report.listLastReachable || !report.cardListScrolled || !report.layoutReloaded) {
  throw new Error("GUI did not complete the V3 Set/Slot/Save & Next/Game Set export flow");
}
const savedAntMetadata = JSON.parse(await readFile(antMetadataPath, "utf8"));
if (savedAntMetadata.schema_version !== 2 || savedAntMetadata.description !== "GUI Save & Next accepted.") {
  throw new Error("Save & Next did not persist Ant metadata before navigating");
}
const savedSet = JSON.parse(await readFile(setPath, "utf8"));
if (savedSet.schema_version !== 1 || savedSet.cards.length !== 2 || savedSet.axies.length !== 1 || savedSet.axies[0].cards.length !== 2) {
  throw new Error("V3 GUI Card Set/Axie Slot persistence is incomplete");
}
const gamePng = await readFile(gameCardPath);
const exportedMetadata = JSON.parse(await readFile(gameMetadataPath, "utf8"));
const gamePngHash = createHash("sha256").update(gamePng).digest("hex");
if (exportedMetadata.schema_version !== 2 || exportedMetadata.visual?.source !== "original_placeholder" || exportedMetadata.effects?.[0]?.hits !== 3) {
  throw new Error("Export Game Card did not write the expected V2 placeholder package");
}
if (!report.originalPreviewHash || gamePngHash !== report.originalPreviewHash || exportedMetadata.visual.sha256 !== gamePngHash) {
  throw new Error("Placeholder export did not preserve the original preview bytes/hash");
}
const setManifest = JSON.parse(await readFile(setManifestPath, "utf8"));
const setFurball = await readFile(setFurballPath);
const manifestFurball = setManifest.cards.find((card) => card.card_id === "furball");
if (setManifest.schema_version !== 1 || setManifest.cards.length !== 2 || setManifest.axies[0].cards.length !== 2 || !manifestFurball || createHash("sha256").update(setFurball).digest("hex") !== manifestFurball.sha256) {
  throw new Error("V3 GUI Game Set manifest or SHA-256 verification failed");
}
console.log(JSON.stringify({
  ok: true,
  screenshot: screenshotPath,
  checked: ["three existing tabs", "Card Set creation", "Axie Slot creation", "set/slot assignment", "All Cards 192 / 192", "visible and clickable Furball search result", "first and last result list reachability", "Furball V1→V2 migration notice", "Gameplay effect editor", "Reload Layout", "Damage amount 20", "Hits 2→3", "Save & Next", "false Clean disabled", "original placeholder mode", "Export Game Card through UI", "byte-identical placeholder hash", "Export Game Set through UI", "portable manifest and SHA-256"],
  original_preview_sha256: report.originalPreviewHash,
  card_set: setPath,
  game_set_manifest: setManifestPath,
  metadata: metadataPath,
  game_card: gameCardPath,
  game_metadata: gameMetadataPath
}, null, 2));
