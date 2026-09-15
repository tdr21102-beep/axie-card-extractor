import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import electronPath from "electron";

const screenshotPath = resolve("output/acceptance/gui_v2/card_studio.png");
const smokeRoot = resolve("output/acceptance/gui_v2/studio_root");
const exportRoot = resolve("output/acceptance/gui_v2/export_root");
const cleanPath = resolve(smokeRoot, "cards/clean/beast/furball.png");
const metadataPath = resolve(smokeRoot, "cards/data/beast/furball.json");
const gameCardPath = resolve(exportRoot, "game_export/beast/furball/card.png");
const gameMetadataPath = resolve(exportRoot, "game_export/beast/furball/card.json");
await rm(`${screenshotPath}.json`, { force: true });
await rm(screenshotPath, { force: true });
await rm(`${screenshotPath}.stage`, { force: true });
const canvas = createCanvas(900, 1350);
const context = canvas.getContext("2d");
context.fillStyle = "#ead6a5";
context.fillRect(0, 0, 900, 1350);
context.fillStyle = "#7b3f2d";
context.fillRect(105, 150, 690, 810);
await mkdir(dirname(cleanPath), { recursive: true });
await mkdir(dirname(metadataPath), { recursive: true });
await writeFile(cleanPath, canvas.toBuffer("image/png"));
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
const child = spawn(electronPath, ["."], {
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
for (const expected of ["Card Catalog", "Batch Export", "Card Studio", "Card browser", "Furball", "Source Metadata", "Game Metadata", "Gameplay", "Advanced JSON", "Add Effect", "Original / Placeholder", "Export Game Card", "Original placeholder"]) {
  if (!report.text.includes(expected)) throw new Error(`GUI smoke report is missing: ${expected}`);
}
const savedMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
if (savedMetadata.schema_version !== 2 || savedMetadata.effects?.[0]?.type !== "damage" || savedMetadata.effects[0].target !== "selected" || savedMetadata.effects[0].amount !== 20 || savedMetadata.effects[0].hits !== 3) {
  throw new Error("V2 GUI effect edits were not persisted through Save Metadata");
}
if (report.amount !== "20" || report.initialHits !== "2" || report.editedHits !== "3") {
  throw new Error("GUI did not demonstrate the Damage amount 20, Hits 2→3 flow");
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
console.log(JSON.stringify({
  ok: true,
  screenshot: screenshotPath,
  checked: ["three existing tabs", "Furball V1→V2 migration notice", "Gameplay effect editor", "Damage amount 20", "Hits 2→3", "save/reload-compatible V2 JSON", "original placeholder mode", "Export Game Card through UI", "byte-identical placeholder hash"],
  original_preview_sha256: report.originalPreviewHash,
  metadata: metadataPath,
  game_card: gameCardPath,
  game_metadata: gameMetadataPath
}, null, 2));
