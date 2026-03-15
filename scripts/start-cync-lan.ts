#!/usr/bin/env npx tsx

/**
 * Start the cync-lan Docker container.
 *
 * Reads MQTT connection details from the project .env so the docker-compose
 * environment stays in sync automatically.  Passes them as env vars that
 * override the compose file defaults, so you never need to hand-edit the
 * docker-compose.yaml.
 *
 * Usage:
 *   npx tsx scripts/start-cync-lan.ts [--restart] [--stop] [--logs] [--status]
 *
 * Flags:
 *   --restart  Force-recreate the container (picks up config changes)
 *   --stop     Stop the running container
 *   --logs     Tail container logs (Ctrl-C to exit)
 *   --status   Show whether the container is running
 */

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const COMPOSE_FILE = resolve(PROJECT_ROOT, "cync-lan", "docker", "docker-compose.yaml");
const ENV_FILE = resolve(PROJECT_ROOT, ".env");
const CONTAINER_NAME = "cync-lan";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) {
    console.error(`[start-cync-lan] .env not found at ${ENV_FILE}`);
    process.exit(1);
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

function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function containerStatus(): string | null {
  try {
    const out = execSync(
      `docker inspect --format={{.State.Status}} ${CONTAINER_NAME}`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    return out;
  } catch {
    return null;
  }
}

function run(cmd: string, opts?: { inherit?: boolean }) {
  console.log(`> ${cmd}`);
  if (opts?.inherit) {
    spawnSync(cmd, { shell: true, stdio: "inherit" });
  } else {
    try {
      const out = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      if (out.trim()) console.log(out.trim());
    } catch (e: any) {
      console.error(e.stderr?.trim() || e.message);
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = args[0];

if (!dockerAvailable()) {
  console.error("[start-cync-lan] Docker is not running. Please start Docker Desktop first.");
  process.exit(1);
}

if (flag === "--stop") {
  const status = containerStatus();
  if (!status) {
    console.log(`[start-cync-lan] Container "${CONTAINER_NAME}" does not exist.`);
  } else {
    console.log(`[start-cync-lan] Stopping ${CONTAINER_NAME}...`);
    run(`docker compose -f "${COMPOSE_FILE}" down`);
    console.log("[start-cync-lan] Stopped.");
  }
  process.exit(0);
}

if (flag === "--logs") {
  console.log(`[start-cync-lan] Tailing logs for ${CONTAINER_NAME} (Ctrl-C to exit)...`);
  run(`docker logs ${CONTAINER_NAME} -f --tail 100`, { inherit: true });
  process.exit(0);
}

if (flag === "--status") {
  const status = containerStatus();
  if (!status) {
    console.log(`[start-cync-lan] Container "${CONTAINER_NAME}" does not exist.`);
  } else {
    console.log(`[start-cync-lan] Container "${CONTAINER_NAME}" status: ${status}`);
  }
  process.exit(0);
}

// -- Start / Restart --------------------------------------------------------

const env = loadEnv();

// Map project .env keys to cync-lan env vars
const mqttHost = env.MQTT_BROKER_URL?.replace(/^mqtt:\/\//, "").replace(/:\d+$/, "") || "homeassistant.local";
const mqttPortMatch = env.MQTT_BROKER_URL?.match(/:(\d+)$/);
const mqttPort = mqttPortMatch ? mqttPortMatch[1] : "1883";
const mqttUser = env.MQTT_USERNAME || "";
const mqttPass = env.MQTT_PASSWORD || "";
const mqttTopic = env.CYNC_MQTT_TOPIC || "cync_lan";

console.log("[start-cync-lan] MQTT config from .env:");
console.log(`  Host:  ${mqttHost}`);
console.log(`  Port:  ${mqttPort}`);
console.log(`  User:  ${mqttUser || "(none)"}`);
console.log(`  Topic: ${mqttTopic}`);

// Build env overrides to pass into docker compose
const composeEnv: Record<string, string> = {
  ...process.env as Record<string, string>,
  CYNC_MQTT_HOST: mqttHost,
  CYNC_MQTT_PORT: mqttPort,
  CYNC_MQTT_USER: mqttUser,
  CYNC_MQTT_PASS: mqttPass,
  CYNC_TOPIC: mqttTopic,
};

const forceRecreate = flag === "--restart" ? " --force-recreate" : "";

const status = containerStatus();
if (status === "running" && !forceRecreate) {
  console.log(`[start-cync-lan] Container "${CONTAINER_NAME}" is already running.`);
  console.log("  Use --restart to force-recreate, --logs to tail logs.");
  process.exit(0);
}

console.log(`[start-cync-lan] Starting ${CONTAINER_NAME}...`);

const cmd = `docker compose -f "${COMPOSE_FILE}" up -d${forceRecreate}`;
console.log(`> ${cmd}`);
try {
  const out = execSync(cmd, {
    encoding: "utf-8",
    env: composeEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (out.trim()) console.log(out.trim());
} catch (e: any) {
  // docker compose often writes normal output to stderr
  const output = (e.stdout?.trim() || "") + "\n" + (e.stderr?.trim() || "");
  if (output.includes("Started") || output.includes("Running") || output.includes("Created")) {
    console.log(output.trim());
  } else {
    console.error(output.trim());
    process.exit(1);
  }
}

// Verify it came up
const newStatus = containerStatus();
if (newStatus === "running") {
  console.log(`[start-cync-lan] Container "${CONTAINER_NAME}" is running.`);
} else {
  console.error(`[start-cync-lan] Container status: ${newStatus ?? "not found"}. Check logs with --logs.`);
  process.exit(1);
}
