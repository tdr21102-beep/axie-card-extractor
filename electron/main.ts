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
      let result: { ok: boolean; text: string; error?: string; originalPreviewHash?: string; amount?: string; initialHits?: string; editedHits?: string };
      try {
        result = await window.webContents.executeJavaScript(`new Promise((resolve) => {
          const deadline = Date.now() + 60000;
          let stage = 0;
          let initialHits = null;
          const field = (scope, label) => Array.from(scope.querySelectorAll("label.field"))
            .find((item) => item.querySelector("span")?.textContent?.trim() === label)
            ?.querySelector("input, textarea, select");
          const setReactValue = (element, value) => {
            const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
              : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
              : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          };
          const originalHash = () => Array.from(document.querySelectorAll(".studio-preview-meta span"))
            .find((item) => item.querySelector("b")?.textContent?.includes("Original"))
            ?.querySelector("code")?.textContent?.trim();
          const inspect = () => {
            const buttons = Array.from(document.querySelectorAll("nav button"));
            const studio = buttons.find((button) => button.textContent?.trim() === "Card Studio");
            if (studio) studio.click();
            const cards = Array.from(document.querySelectorAll(".studio-card-list .card-row"));
            const furball = cards.find((button) => button.textContent?.includes("Furball"));
            if (furball && !furball.classList.contains("selected")) furball.click();
            const text = document.body.innerText;
            const editorReady = ["Source Metadata", "Game Metadata", "Gameplay", "Advanced JSON", "Export Game Card"]
              .every((label) => text.includes(label));
            const effect = document.querySelector(".effect-card");
            if (stage === 0 && text.includes("Card browser") && text.includes("Furball") && editorReady && text.includes("Loaded from V1")) {
              document.querySelector(".add-effect-row button")?.click();
              stage = 1;
            } else if (stage === 1 && effect) {
              setReactValue(field(effect, "Target"), "selected");
              stage = 2;
            } else if (stage === 2 && field(effect, "Target")?.value === "selected") {
              setReactValue(field(effect, "Amount"), "20");
              stage = 3;
            } else if (stage === 3 && field(effect, "Amount")?.value === "20") {
              setReactValue(field(effect, "Hits"), "2");
              initialHits = "2";
              stage = 4;
            } else if (stage === 4 && field(effect, "Hits")?.value === "2") {
              setReactValue(field(effect, "Hits"), "3");
              stage = 5;
            } else if (stage === 5 && field(effect, "Hits")?.value === "3" && text.includes("Unsaved")) {
              document.querySelector(".studio-editor-actions .primary")?.click();
              stage = 6;
            } else if (stage === 6 && text.includes("Game metadata saved")) {
              Array.from(document.querySelectorAll(".visual-source-switch button")).find((button) => button.textContent?.includes("Original"))?.click();
              stage = 7;
            } else if (stage === 7 && originalHash() && !originalHash().includes("Available") && text.includes("Original placeholder")) {
              document.querySelector(".studio-editor-actions .game-export")?.click();
              stage = 8;
            } else if (stage === 8 && (text.includes("Game card package exported") || text.includes("Identical game card package"))) {
              const finalEffect = document.querySelector(".effect-card");
              document.querySelector(".studio-editor").scrollTop = document.querySelector(".studio-editor").scrollHeight;
              resolve({ ok: true, text, originalPreviewHash: originalHash(), amount: field(finalEffect, "Amount")?.value, initialHits, editedHits: field(finalEffect, "Hits")?.value });
              return;
            } else if (Date.now() >= deadline) {
              resolve({ ok: false, text, originalPreviewHash: originalHash(), initialHits, error: "Furball V2 GUI edit/save/placeholder-export flow did not finish before timeout (stage " + stage + ")" });
              return;
            }
            setTimeout(inspect, 100);
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
    layoutConfig: join(app.getAppPath(), "config", "card_layout.json"),
    initialExportRoot: process.env.AXIE_GUI_SMOKE_EXPORT_ROOT
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
