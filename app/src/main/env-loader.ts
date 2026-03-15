import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DATA_DIR, DATA_PATHS } from "./data-dir";

export interface AppConfig {
  apiKey: string;
  port: number;
  dataDir: string;
  /** All env vars parsed from config.env — passed to server process */
  env: Record<string, string>;
  /** Project root for dev mode (npx tsx watch) */
  devProjectRoot: string;
}

export function loadConfig(): AppConfig {
  const env = loadEnvFile(DATA_PATHS.configEnv);
  return {
    apiKey: env.API_KEY || "",
    port: parseInt(env.LIGHTS_PORT || "3001", 10),
    dataDir: DATA_DIR,
    env,
    devProjectRoot: resolve(dirname(__dirname), "..", ".."),
  };
}

function loadEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    console.error(`[env-loader] config not found at ${filePath}`);
    return {};
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}
