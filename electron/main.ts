import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { registerIpc } from "./ipc.ts";

let mainWindow: BrowserWindow | null = null;

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

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void mainWindow.loadURL(devServer);
  else void mainWindow.loadFile(join(__dirname, "../dist/index.html"));
}

app.whenReady().then(() => {
  const userData = app.getPath("userData");
  registerIpc({
    catalogCache: join(userData, "cache", "sanity_card_catalog_source.json"),
    imageCache: join(userData, "cache", "images"),
    logFile: join(userData, "logs", "app.log")
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
