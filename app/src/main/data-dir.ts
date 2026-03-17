import { app } from "electron";
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

/**
 * All user data lives in %LOCALAPPDATA%/Smart AI Cync Control/.
 * On first launch, files are seeded from bundled defaults (your actual
 * .env and rooms.json baked in at build time) or generic templates.
 */
const APP_NAME = "Smart AI Cync Control";
export const DATA_DIR = join(process.env.LOCALAPPDATA || "", APP_NAME);

export const DATA_PATHS = {
  configEnv: join(DATA_DIR, "config.env"),
  roomsJson: join(DATA_DIR, "rooms.json"),
  cyncMesh: join(DATA_DIR, "cync-lan", "config", "cync_mesh.yaml"),
} as const;

/** Directory containing configs bundled at build time (inside extraResources) */
function getBundledDefaultsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "server", "defaults");
  }
  // Dev mode: look in the built dist/server/defaults
  return join(__dirname, "..", "server", "defaults");
}

export function ensureDataDir(): { firstRun: boolean } {
  const firstRun = !existsSync(DATA_DIR);

  mkdirSync(DATA_DIR, { recursive: true });

  const defaults = getBundledDefaultsDir();

  if (!existsSync(DATA_PATHS.configEnv)) {
    seedFile(join(defaults, "config.env"), DATA_PATHS.configEnv, FALLBACK_CONFIG_ENV);
  }

  if (!existsSync(DATA_PATHS.roomsJson)) {
    seedFile(join(defaults, "rooms.json"), DATA_PATHS.roomsJson, FALLBACK_ROOMS_JSON);
  }

  return { firstRun };
}

/** Copy the bundled default if it exists, otherwise write the fallback template. */
function seedFile(bundledPath: string, destPath: string, fallback: string): void {
  if (existsSync(bundledPath)) {
    copyFileSync(bundledPath, destPath);
  } else {
    writeFileSync(destPath, fallback, "utf-8");
  }
}

// ---------- Fallback templates (used only if build-time configs weren't bundled) ----------

const FALLBACK_CONFIG_ENV = `# Smart AI Cync Control Configuration
# Edit this file then restart the app.

# Required: API key for authenticating requests
API_KEY=changeme

# Server port
# LIGHTS_PORT=3001

# MQTT broker
# MQTT_BROKER_URL=mqtt://localhost:1883
# MQTT_USERNAME=
# MQTT_PASSWORD=

# LLM model loaded in LM Studio
# LLM_MODEL=google/gemma-3-4b

# MQTT topic prefix
# CYNC_MQTT_TOPIC=cync_lan

# LAN IP for DNS override (this machine)
# CYNC_LAN_IP=

# Technitium DNS Server
# TECHNITIUM_URL=http://localhost:5380
# TECHNITIUM_USERNAME=admin
# TECHNITIUM_PASSWORD=admin
`;

const FALLBACK_ROOMS_JSON = JSON.stringify(
  {
    home_id: "000000000",
    rooms: {
      "example-room": {
        devices: [1],
        aliases: ["example"],
      },
    },
  },
  null,
  2,
);
