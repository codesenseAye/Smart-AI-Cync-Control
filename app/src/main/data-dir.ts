import { app } from "electron";
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync } from "node:fs";
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
  stateDb: join(DATA_DIR, "state.db"),
  cyncLanDir: join(DATA_DIR, "cync-lan"),
  dockerCompose: join(DATA_DIR, "cync-lan", "docker-compose.yaml"),
  cyncLanConfig: join(DATA_DIR, "cync-lan", "config"),
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
  mkdirSync(DATA_PATHS.cyncLanDir, { recursive: true });
  mkdirSync(DATA_PATHS.cyncLanConfig, { recursive: true });

  const defaults = getBundledDefaultsDir();

  if (!existsSync(DATA_PATHS.configEnv)) {
    seedFile(join(defaults, "config.env"), DATA_PATHS.configEnv, FALLBACK_CONFIG_ENV);
  }

  if (!existsSync(DATA_PATHS.roomsJson)) {
    seedFile(join(defaults, "rooms.json"), DATA_PATHS.roomsJson, FALLBACK_ROOMS_JSON);
  }

  if (!existsSync(DATA_PATHS.dockerCompose)) {
    seedFile(join(defaults, "docker-compose.yaml"), DATA_PATHS.dockerCompose, FALLBACK_DOCKER_COMPOSE);
  }

  // Seed cync-lan config (cync_mesh.yaml) if the config dir is empty
  seedCyncLanConfig(defaults);

  return { firstRun };
}

/** Copy bundled cync-lan config files (cync_mesh.yaml etc.) into the data dir config folder. */
function seedCyncLanConfig(defaults: string): void {
  const bundledConfigDir = join(defaults, "cync-lan-config");
  if (!existsSync(bundledConfigDir)) return;

  for (const entry of readdirSync(bundledConfigDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const dest = join(DATA_PATHS.cyncLanConfig, entry.name);
    if (!existsSync(dest)) {
      copyFileSync(join(bundledConfigDir, entry.name), dest);
    }
  }
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
# MQTT_BROKER_URL=mqtt://homeassistant.local:1883
# MQTT_USERNAME=
# MQTT_PASSWORD=

# LLM model loaded in LM Studio
# LLM_MODEL=google/gemma-3-4b

# MQTT topic prefix (must match cync-lan config)
# CYNC_MQTT_TOPIC=cync_lan

# LAN IP for DNS override (machine running cync-lan)
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

const FALLBACK_DOCKER_COMPOSE = `services:
  cync-lan:
    container_name: cync-lan
    image: baudneo/cync-lan:latest
    restart: unless-stopped
    ports:
      - "23779:23779"
      - "23778:23778"
    volumes:
      - ./config:/root/cync-lan/config
    environment:
      TZ: "America/Chicago"
      CYNC_ENABLE_EXPORTER: "no"
      CYNC_MQTT_HOST: "\${CYNC_MQTT_HOST:-homeassistant.local}"
      CYNC_MQTT_PORT: "\${CYNC_MQTT_PORT:-1883}"
      CYNC_MQTT_USER: "\${CYNC_MQTT_USER:-}"
      CYNC_MQTT_PASS: "\${CYNC_MQTT_PASS:-}"
      CYNC_TOPIC: "\${CYNC_TOPIC:-cync_lan}"
    networks:
      - cync-lan

networks:
  cync-lan:
    driver: bridge
`;
