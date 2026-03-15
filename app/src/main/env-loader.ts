import { app } from "electron";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

const PROJECT_ROOT_CACHE = join(app.getPath("userData"), "project-root.txt");

function resolveProjectRoot(): string {
  // 1. Portable exe sets this env var via its self-extractor
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) {
    const root = resolve(portableDir, "..", "..");
    // Persist so taskbar/shortcut launches that bypass the wrapper still work
    try { writeFileSync(PROJECT_ROOT_CACHE, root, "utf-8"); } catch {}
    return root;
  }

  // 2. Packaged fallback: read persisted project root (covers taskbar pins)
  if (app.isPackaged) {
    try {
      const cached = readFileSync(PROJECT_ROOT_CACHE, "utf-8").trim();
      if (cached && existsSync(resolve(cached, ".env"))) {
        return cached;
      }
    } catch {}
  }

  // 3. Dev mode: __dirname is app/dist/main/, go up to project root
  return resolve(dirname(__dirname), "..", "..");
}

const PROJECT_ROOT = resolveProjectRoot();
const ENV_FILE = resolve(PROJECT_ROOT, ".env");

export interface AppConfig {
  apiKey: string;
  port: number;
  projectRoot: string;
}

export function loadConfig(): AppConfig {
  const env = loadEnvFile();
  return {
    apiKey: env.API_KEY || "",
    port: parseInt(env.LIGHTS_PORT || "3001", 10),
    projectRoot: PROJECT_ROOT,
  };
}

function loadEnvFile(): Record<string, string> {
  if (!existsSync(ENV_FILE)) {
    console.error(`[env-loader] .env not found at ${ENV_FILE}`);
    return {};
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}
