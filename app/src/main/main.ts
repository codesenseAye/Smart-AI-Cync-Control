import { app, BrowserWindow, nativeImage } from "electron";
import path from "node:path";
import { loadConfig } from "./env-loader";
import { ServiceManager } from "./services";
import { registerIpcHandlers } from "./ipc-handlers";

const APP_TITLE = "Smart AI Cync Control";

const config = loadConfig();
const services = new ServiceManager(config);

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function getAppIcon(): Electron.NativeImage {
  const iconPath = path.join(__dirname, "..", "..", "assets", "smart-cync-ai-control-logo.png");
  return nativeImage.createFromPath(iconPath);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    title: APP_TITLE,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.setMenuBarVisibility(false);

  services.setWindow(mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  createWindow();
  registerIpcHandlers(services, config);

  // Start all services after window is ready
  services.startAll().catch((err) => {
    console.error("[main] Service startup error:", err);
  });
});

// Graceful shutdown: intercept quit, stop services, then quit for real
app.on("before-quit", (event) => {
  if (!isQuitting) {
    isQuitting = true;
    event.preventDefault();

    services
      .stopAll()
      .catch((err) => console.error("[main] Shutdown error:", err))
      .finally(() => {
        app.quit();
      });
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
