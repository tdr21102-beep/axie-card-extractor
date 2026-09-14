import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, BrowserWindow } from "electron";
import { registerIpc } from "./ipc.ts";

let mainWindow: BrowserWindow | null = null;

function installSmokeCheck(window: BrowserWindow): void {
  const screenshotPath = process.env.AXIE_GUI_SMOKE_OUTPUT;
  if (!screenshotPath) return;
  void mkdir(dirname(screenshotPath), { recursive: true })
    .then(() => writeFile(`${screenshotPath}.stage`, "installed\n", "utf8"));
  window.webContents.once("did-finish-load", () => {
    void (async () => {
      await writeFile(`${screenshotPath}.stage`, "loaded\n", "utf8");
      let result: { ok: boolean; text: string; error?: string; initialPreviewHash?: string; editedPreviewHash?: string };
      try {
        result = await window.webContents.executeJavaScript(`new Promise((resolve) => {
          const deadline = Date.now() + 15000;
          let initialPreviewHash = null;
          let edited = false;
          let saved = false;
          let exported = false;
          const field = (label) => Array.from(document.querySelectorAll(".game-metadata label.field"))
            .find((item) => item.querySelector("span")?.textContent?.trim() === label)
            ?.querySelector("input, textarea");
          const setReactValue = (element, value) => {
            const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
            element.dispatchEvent(new Event("input", { bubbles: true }));
          };
          const previewHash = () => Array.from(document.querySelectorAll(".studio-preview-meta span"))
            .find((item) => item.querySelector("b")?.textContent?.includes("Preview"))
            ?.querySelector("code")?.textContent?.trim();
          const inspect = () => {
            const buttons = Array.from(document.querySelectorAll("nav button"));
            const studio = buttons.find((button) => button.textContent?.trim() === "Card Studio");
            if (studio) studio.click();
            const cards = Array.from(document.querySelectorAll(".studio-card-list .card-row"));
            const furball = cards.find((button) => button.textContent?.includes("Furball"));
            if (furball && !furball.classList.contains("selected")) furball.click();
            const text = document.body.innerText;
            const editorReady = ["Source Metadata", "Game Metadata", "Save Metadata", "Reset Unsaved Changes", "Export Rendered Card"]
              .every((label) => text.includes(label));
            const currentHash = previewHash();
            if (!edited && text.includes("Card browser") && text.includes("Furball") && editorReady && text.includes("Clean ready") && currentHash && !currentHash.includes("Available")) {
              initialPreviewHash = currentHash;
              setReactValue(field("Value"), "55");
              setReactValue(field("Description"), "Deal 3 hits from GUI smoke.");
              edited = true;
              setTimeout(inspect, 100);
            } else if (edited && !saved && text.includes("Unsaved") && currentHash && currentHash !== initialPreviewHash) {
              document.querySelector(".studio-editor-actions .primary")?.click();
              saved = true;
              setTimeout(inspect, 100);
            } else if (saved && !exported && text.includes("Game metadata saved") && document.querySelector(".game-metadata .section-title .status-pill")?.textContent?.trim() === "Saved") {
              document.querySelector(".studio-editor-actions .export-rendered")?.click();
              exported = true;
              setTimeout(inspect, 100);
            } else if (exported && text.includes("Rendered card exported")) {
              resolve({ ok: true, text, initialPreviewHash, editedPreviewHash: currentHash });
            } else if (Date.now() >= deadline) {
              resolve({ ok: false, text, initialPreviewHash, editedPreviewHash: currentHash, error: "Furball GUI edit/save/export flow did not finish before timeout" });
            } else {
              setTimeout(inspect, 100);
            }
          };
          inspect();
        })`, true);
        await new Promise((resolvePaint) => setTimeout(resolvePaint, 300));
        await mkdir(dirname(screenshotPath), { recursive: true });
        const image = await window.webContents.capturePage();
        await writeFile(screenshotPath, image.toPNG());
      } catch (error) {
        result = { ok: false, text: "", error: error instanceof Error ? error.message : String(error) };
      }
      await mkdir(dirname(screenshotPath), { recursive: true });
      await writeFile(`${screenshotPath}.json`, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      app.exit(result.ok ? 0 : 1);
    })();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: "AXIE / CARD EXTRACTOR",
    width: 1400,
    height: 850,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#10151d",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  installSmokeCheck(mainWindow);

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void mainWindow.loadURL(devServer);
  else void mainWindow.loadFile(join(__dirname, "../dist/index.html"));
}

app.whenReady().then(() => {
  const userData = app.getPath("userData");
  registerIpc({
    catalogCache: join(userData, "cache", "sanity_card_catalog_source.json"),
    imageCache: join(userData, "cache", "images"),
    logFile: join(userData, "logs", "app.log"),
    studioRoot: process.env.AXIE_GUI_SMOKE_ROOT ?? userData,
    layoutConfig: join(app.getAppPath(), "config", "card_layout.json")
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
