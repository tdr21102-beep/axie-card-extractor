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
      let result: { ok: boolean; text: string; error?: string; originalPreviewHash?: string; amount?: string; initialHits?: string; editedHits?: string; setId?: string; slotId?: string; saveAndNext?: boolean; gameSetExported?: boolean; browserScrolled?: boolean; browserControlsVisible?: boolean; allCardsCountVerified?: boolean; searchResultVisible?: boolean; searchResultClickable?: boolean; listFirstReachable?: boolean; listLastReachable?: boolean; cardListScrolled?: boolean; layoutReloaded?: boolean; dialogInteractionRecovered?: boolean };
      try {
        result = await window.webContents.executeJavaScript(`new Promise((resolve) => {
          const deadline = Date.now() + 60000;
          let stage = 0;
          let initialHits = null;
          let originalPreviewHash = null;
          let setId = null;
          let slotId = null;
          let browserScrolled = false;
          let layoutReloaded = false;
          let browserControlsVisible = false;
          let allCardsCountVerified = false;
          let searchResultVisible = false;
          let searchResultClickable = false;
          let listFirstReachable = false;
          let listLastReachable = false;
          let dialogInteractionRecovered = false;
          let interactionDiagnostic = "";
          window.confirm = () => true;
          const field = (scope, label) => Array.from(scope.querySelectorAll("label.field"))
            .find((item) => item.querySelector("span")?.textContent?.trim() === label)
            ?.querySelector("input, textarea, select");
          const button = (label) => Array.from(document.querySelectorAll("button"))
            .find((item) => item.textContent?.trim().includes(label));
          const visible = (element, container = null) => {
            if (!(element instanceof HTMLElement)) return false;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return false;
            if (!container) return true;
            const containerRect = container.getBoundingClientRect();
            return rect.top >= containerRect.top - 1 && rect.bottom <= containerRect.bottom + 1
              && rect.left >= containerRect.left - 1 && rect.right <= containerRect.right + 1;
          };
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
          const selectView = (value) => {
            const view = field(document, "View");
            if (view) setReactValue(view, value);
          };
          const selectCard = (name) => {
            const card = Array.from(document.querySelectorAll(".studio-card-list .card-row"))
              .find((item) => item.textContent?.includes(name));
            if (card && !card.classList.contains("selected")) card.click();
            return card;
          };
          const selectedCardName = () => document.querySelector(".studio-card-list .card-row.selected .card-name")?.textContent?.trim();
          const dialog = (title) => Array.from(document.querySelectorAll('[role="dialog"]')).find((item) => item.textContent?.includes(title));
          const submitDialog = (title, value) => {
            const current = dialog(title);
            const input = current?.querySelector("input");
            if (!current || !input) return false;
            setReactValue(input, value);
            current.querySelector("button[type=submit]")?.click();
            return true;
          };
          const beginWorkspaceInteraction = () => {
            const searchInput = field(document, "Search");
            const view = field(document, "View");
            const classFilter = field(document, "Class");
            if (!(searchInput instanceof HTMLInputElement) || !(view instanceof HTMLSelectElement) || !(classFilter instanceof HTMLSelectElement)) { interactionDiagnostic = "required controls missing"; return false; }
            if (searchInput.disabled || view.disabled || classFilter.disabled || document.querySelector(".production-dialog-backdrop")) { interactionDiagnostic = "disabled=" + searchInput.disabled + "/" + view.disabled + "/" + classFilter.disabled + ", backdrop=" + Boolean(document.querySelector(".production-dialog-backdrop")); return false; }
            const canReceivePointer = (element) => {
              const rect = element.getBoundingClientRect();
              const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              return Boolean(target && (target === element || element.contains(target)));
            };
            if (!canReceivePointer(searchInput) || !canReceivePointer(view) || !canReceivePointer(classFilter)) { interactionDiagnostic = "pointer=" + canReceivePointer(searchInput) + "/" + canReceivePointer(view) + "/" + canReceivePointer(classFilter); return false; }
            searchInput.focus();
            if (document.activeElement !== searchInput) { interactionDiagnostic = "search input did not receive focus"; return false; }
            setReactValue(searchInput, "Furball");
            setReactValue(classFilter, "Beast");
            return true;
          };
          const completeWorkspaceInteraction = () => {
            const searchInput = field(document, "Search");
            const classFilter = field(document, "Class");
            const changed = searchInput?.value === "Furball" && classFilter?.value === "Beast";
            interactionDiagnostic = "changed=" + changed + ", search=" + searchInput?.value + ", class=" + classFilter?.value;
            document.querySelector(".clear-production-filters")?.click();
            return changed;
          };
          const inspect = () => {
            try {
            const buttons = Array.from(document.querySelectorAll("nav button"));
            const studio = buttons.find((button) => button.textContent?.trim() === "Card Studio");
            if (studio) studio.click();
            const text = document.body.innerText;
            const editorReady = ["Source Metadata", "Game Metadata", "Gameplay", "Advanced JSON", "Export Game Card"]
              .every((label) => text.includes(label));
            const effect = document.querySelector(".effect-card");
            if (stage === 0 && text.includes("Production workspace") && text.includes("Card Sets") && text.includes("Production browser")) {
              button("+ Create")?.click();
              stage = 1;
            } else if (stage === 1 && submitDialog("Create Card Set", "First Battle Set")) {
              stage = 1.5;
            } else if (stage === 1.5 && text.includes("Card Set “First Battle Set” created")) {
              button("Rename")?.click();
              stage = 1.6;
            } else if (stage === 1.6 && submitDialog("Rename Card Set", "First Battle Set Verified")) {
              stage = 1.7;
            } else if (stage === 1.7 && text.includes("Card Set renamed to “First Battle Set Verified”")) {
              if (!beginWorkspaceInteraction()) {
                resolve({ ok: false, text, setId, error: "Workspace controls did not recover after confirming Rename Card Set: " + interactionDiagnostic });
                return;
              }
              stage = 1.71;
            } else if (stage === 1.71) {
              if (!completeWorkspaceInteraction()) {
                resolve({ ok: false, text, setId, error: "Search/Class did not accept interaction after confirming Rename Card Set: " + interactionDiagnostic });
                return;
              }
              button("Rename")?.click();
              stage = 1.8;
            } else if (stage === 1.8 && dialog("Rename Card Set")) {
              dialog("Rename Card Set")?.querySelector("button[type=button]")?.click();
              stage = 1.9;
            } else if (stage === 1.9 && !dialog("Rename Card Set")) {
              if (!beginWorkspaceInteraction()) {
                resolve({ ok: false, text, setId, error: "Workspace controls did not recover after cancelling Rename Card Set." });
                return;
              }
              stage = 1.91;
            } else if (stage === 1.91) {
              if (!completeWorkspaceInteraction()) {
                resolve({ ok: false, text, setId, error: "Search/Class did not accept interaction after cancelling Rename Card Set: " + interactionDiagnostic });
                return;
              }
              button("+ Create")?.click();
              stage = 1.95;
            } else if (stage === 1.95 && submitDialog("Create Card Set", "Disposable Smoke Set")) {
              stage = 1.96;
            } else if (stage === 1.96 && text.includes("Card Set “Disposable Smoke Set” created")) {
              window.confirm = () => false;
              button("Delete")?.click();
              stage = 1.97;
            } else if (stage === 1.97) {
              if (!beginWorkspaceInteraction() || field(document, "Current Set")?.value !== "disposable_smoke_set") {
                resolve({ ok: false, text, setId, error: "Workspace controls did not remain interactive after cancelling Delete Card Set." });
                return;
              }
              stage = 1.971;
            } else if (stage === 1.971) {
              if (!completeWorkspaceInteraction()) {
                resolve({ ok: false, text, setId, error: "Search/Class did not accept interaction after cancelling Delete Card Set: " + interactionDiagnostic });
                return;
              }
              window.confirm = () => true;
              button("Delete")?.click();
              stage = 1.98;
            } else if (stage === 1.98 && text.includes("Card Set deleted")) {
              if (!beginWorkspaceInteraction() || document.querySelector(".production-dialog-backdrop")) {
                resolve({ ok: false, text, setId, error: "Workspace controls did not recover after confirming Delete Card Set." });
                return;
              }
              stage = 1.981;
            } else if (stage === 1.981) {
              if (!completeWorkspaceInteraction()) {
                resolve({ ok: false, text, setId, error: "Search/Class did not accept interaction after confirming Delete Card Set: " + interactionDiagnostic });
                return;
              }
              dialogInteractionRecovered = true;
              setId = field(document, "Current Set")?.value ?? null;
              const browser = document.querySelector(".studio-browser");
              if (browser) { browser.scrollTop = browser.scrollHeight; }
              const clear = document.querySelector(".clear-production-filters");
              const browserRect = browser?.getBoundingClientRect();
              const clearRect = clear?.getBoundingClientRect();
              browserScrolled = Boolean(browser && browser.scrollHeight > browser.clientHeight && browser.scrollTop > 0 && clearRect && browserRect && clearRect.bottom <= browserRect.bottom + 1);
              browserControlsVisible = Boolean(clear && visible(clear, browser));
              clear?.click();
              selectView("all");
              stage = browserControlsVisible ? 2 : 1.75;
            } else if (stage === 1.75 && text.includes("Card Set “First Battle Set” created")) {
              resolve({ ok: false, text, setId, browserScrolled: false, browserControlsVisible: false, error: "Production browser final filter control is not visible." });
              return;
            } else if (stage === 2 && document.querySelector(".count-pill")?.textContent?.replace(/\s+/g, " ").trim() === "192 / 192") {
              allCardsCountVerified = true;
              const searchInput = field(document, "Search");
              if (searchInput) {
                setReactValue(searchInput, "Furball");
                stage = 2.5;
              }
            } else if (stage === 2.5) {
              const cardList = document.querySelector(".studio-card-list");
              const matchingRows = Array.from(document.querySelectorAll(".studio-card-list .card-row"))
                .filter((item) => item.textContent?.includes("Furball"));
              const matchingRow = matchingRows.length === 1 ? matchingRows[0] : null;
              searchResultVisible = Boolean(matchingRow && cardList && visible(matchingRow, cardList));
              searchResultClickable = Boolean(matchingRow && !matchingRow.disabled && visible(matchingRow, cardList));
              if (searchResultVisible && searchResultClickable) {
                matchingRow.click();
                stage = 3;
              }
            } else if (stage === 3 && editorReady && selectedCardName() === "Furball" && visible(button("Reload Layout")) && !button("Reload Layout")?.disabled) {
              button("Reload Layout")?.click();
              stage = 3.25;
            } else if (stage === 3.25 && text.includes("Layout reloaded.")) {
              layoutReloaded = true;
              stage = 3.5;
            } else if (stage === 3.5 && editorReady && selectedCardName() === "Furball" && visible(button("Add to Current Set")) && !button("Add to Current Set")?.disabled) {
              button("Add to Current Set")?.click();
              stage = 4;
            } else if (stage === 4 && button("Remove from Set")) {
              button("+ Slot")?.click();
              stage = 5;
            } else if (stage === 5 && submitDialog("Create Axie Slot", "Axie 1")) {
              stage = 5.5;
            } else if (stage === 5.5 && text.includes("Axie Slot created")) {
              slotId = field(document, "Axie Slot")?.value ?? null;
              const membershipSelect = document.querySelector(".membership-row select");
              const assignButton = button("Assign");
              if (visible(membershipSelect) && !membershipSelect.disabled && visible(assignButton) && !assignButton.disabled) {
                assignButton.click();
                stage = 6;
              }
            } else if (stage === 6 && text.includes("Card assigned to Axie Slot")) {
              document.querySelector(".clear-production-filters")?.click();
              selectView("all");
              stage = 7;
            } else if (stage === 7 && selectCard("Ant")) {
              stage = 8;
            } else if (stage === 8 && editorReady && selectedCardName() === "Ant" && button("Add to Current Set")) {
              button("Add to Current Set")?.click();
              stage = 9;
            } else if (stage === 9 && button("Remove from Set")) {
              button("Assign")?.click();
              stage = 10;
            } else if (stage === 10 && text.includes("Card assigned to Axie Slot")) {
              selectView("set");
              stage = 11;
            } else if (stage === 11 && selectCard("Furball")) {
              stage = 12;
            } else if (stage === 12 && selectedCardName() === "Furball" && editorReady && text.includes("Loaded from V1")) {
              document.querySelector(".add-effect-row button")?.click();
              stage = 13;
            } else if (stage === 13 && effect) {
              setReactValue(field(effect, "Target"), "selected");
              stage = 14;
            } else if (stage === 14 && field(effect, "Target")?.value === "selected") {
              setReactValue(field(effect, "Amount"), "20");
              stage = 15;
            } else if (stage === 15 && field(effect, "Amount")?.value === "20") {
              setReactValue(field(effect, "Hits"), "2");
              initialHits = "2";
              stage = 16;
            } else if (stage === 16 && field(effect, "Hits")?.value === "2") {
              setReactValue(field(effect, "Hits"), "3");
              stage = 17;
            } else if (stage === 17 && field(effect, "Hits")?.value === "3" && text.includes("Unsaved")) {
              document.querySelector(".studio-editor-actions .primary")?.click();
              stage = 18;
            } else if (stage === 18 && text.includes("Game metadata saved")) {
              Array.from(document.querySelectorAll(".visual-source-switch button")).find((button) => button.textContent?.includes("Original"))?.click();
              stage = 19;
            } else if (stage === 19 && originalHash() && !originalHash().includes("Available") && text.includes("Original placeholder")) {
              originalPreviewHash = originalHash();
              document.querySelector(".studio-editor-actions .game-export")?.click();
              stage = 20;
            } else if (stage === 20 && (text.includes("Game card exported") || text.includes("Identical game card files"))) {
              selectCard("Ant");
              stage = 21;
            } else if (stage === 21 && selectedCardName() === "Ant" && editorReady) {
              setReactValue(field(document.querySelector(".game-metadata"), "Description"), "GUI Save & Next accepted.");
              stage = 22;
            } else if (stage === 22 && text.includes("Unsaved") && !button("Save & Next")?.disabled) {
              button("Save & Next")?.click();
              stage = 23;
            } else if (stage === 23 && selectedCardName() === "Furball" && button("Review Plan & Export") && !button("Review Plan & Export")?.disabled) {
              button("Review Plan & Export")?.click();
              stage = 24;
            } else if (stage === 24 && text.includes("Game Set export complete")) {
              document.querySelector(".studio-editor").scrollTop = document.querySelector(".studio-editor").scrollHeight;
              selectView("all");
              stage = 25;
            } else if (stage === 25 && document.querySelectorAll(".studio-card-list .card-row").length === 192) {
              const cardList = document.querySelector(".studio-card-list");
              const browser = document.querySelector(".studio-browser");
              if (browser) browser.scrollTop = 0;
              stage = 25.5;
            } else if (stage === 25.5) {
              const browser = document.querySelector(".studio-browser");
              const firstCard = document.querySelector(".studio-card-list .card-row:first-child");
              firstCard?.scrollIntoView({ block: "nearest" });
              listFirstReachable = Boolean(browser && firstCard && visible(firstCard, browser));
              if (browser) browser.scrollTop = browser.scrollHeight;
              stage = 25.75;
            } else if (stage === 25.75) {
              const finalEffect = document.querySelector(".effect-card");
              const browser = document.querySelector(".studio-browser");
              const lastCard = Array.from(document.querySelectorAll(".studio-card-list .card-row")).at(-1);
              listLastReachable = Boolean(browser && lastCard && browser.scrollHeight > browser.clientHeight && browser.scrollTop > 0 && visible(lastCard, browser));
              const cardListScrolled = listFirstReachable && listLastReachable;
              resolve({ ok: true, text, originalPreviewHash, amount: field(finalEffect, "Amount")?.value, initialHits, editedHits: field(finalEffect, "Hits")?.value, setId, slotId, saveAndNext: true, gameSetExported: true, browserScrolled, browserControlsVisible, allCardsCountVerified, searchResultVisible, searchResultClickable, listFirstReachable, listLastReachable, cardListScrolled, layoutReloaded, dialogInteractionRecovered });
              return;
            } else if (Date.now() >= deadline) {
              resolve({ ok: false, text, originalPreviewHash, initialHits, setId, slotId, error: "Card Studio V3 GUI production flow did not finish before timeout (stage " + stage + ")" });
              return;
            }
            setTimeout(inspect, 100);
            } catch (error) {
              resolve({ ok: false, text: document.body.innerText, error: String(error) });
            }
          };
          inspect();
        })`, true);
        await new Promise((resolvePaint) => setTimeout(resolvePaint, 300));
        await mkdir(dirname(screenshotPath), { recursive: true });
        try {
          const image = await window.webContents.capturePage();
          await writeFile(screenshotPath, image.toPNG());
        } catch (error) {
          await writeFile(`${screenshotPath}.capture-error`, error instanceof Error ? error.message : String(error), "utf8");
        }
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
    width: Number(process.env.AXIE_GUI_SMOKE_WIDTH ?? 1400),
    height: Number(process.env.AXIE_GUI_SMOKE_HEIGHT ?? 850),
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
