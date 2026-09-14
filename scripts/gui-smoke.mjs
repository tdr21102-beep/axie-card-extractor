import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";
import electronPath from "electron";

const screenshotPath = resolve("output/acceptance/gui/card_studio.png");
const smokeRoot = resolve("output/acceptance/gui/studio_root");
const cleanPath = resolve(smokeRoot, "cards/clean/beast/furball.png");
const metadataPath = resolve(smokeRoot, "cards/data/beast/furball.json");
const renderedPath = resolve(smokeRoot, "cards/rendered/beast/furball.png");
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
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
  }
});

const exitCode = await new Promise((resolveExit, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    readFile(`${screenshotPath}.stage`, "utf8").catch(() => "not started").then((stage) => {
      reject(new Error(`Electron GUI smoke test timed out (stage: ${stage.trim()})`));
    });
  }, 45_000);
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
for (const expected of ["Card Catalog", "Batch Export", "Card Studio", "Card browser", "Furball", "Source Metadata", "Game Metadata", "Save Metadata", "Reset Unsaved Changes", "Export Rendered Card", "Clean ready"]) {
  if (!report.text.includes(expected)) throw new Error(`GUI smoke report is missing: ${expected}`);
}
const savedMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
if (savedMetadata.value !== 55 || savedMetadata.description !== "Deal 3 hits from GUI smoke.") {
  throw new Error("GUI edits were not persisted through Save Metadata");
}
await readFile(renderedPath);
if (!report.initialPreviewHash || report.initialPreviewHash === report.editedPreviewHash) {
  throw new Error("GUI edit did not update the rendered preview hash");
}
console.log(JSON.stringify({
  ok: true,
  screenshot: screenshotPath,
  checked: ["three tabs", "Furball source/game metadata", "clean visual", "live 40→55 preview", "description preview", "save through UI", "rendered export through UI"],
  initial_preview_sha256: report.initialPreviewHash,
  edited_preview_sha256: report.editedPreviewHash,
  metadata: metadataPath,
  rendered: renderedPath
}, null, 2));
