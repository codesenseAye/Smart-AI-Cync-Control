import "dotenv/config";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { RoomsConfig } from "./types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

function getRoomsPath(): string {
  return process.env.ROOMS_JSON_PATH || join(__dirname, "..", "src", "data", "rooms.json");
}

function loadRoomsConfig(): RoomsConfig {
  const roomsPath = getRoomsPath();
  try {
    const raw = readFileSync(roomsPath, "utf-8");
    return JSON.parse(raw) as RoomsConfig;
  } catch (e) {
    console.error(`Failed to load rooms.json from ${roomsPath}:`, e);
    process.exit(1);
  }
}

/** Reload rooms.json from disk at runtime. */
export function reloadRooms(): RoomsConfig {
  const roomsPath = getRoomsPath();
  const raw = readFileSync(roomsPath, "utf-8");
  const rooms = JSON.parse(raw) as RoomsConfig;
  config.rooms = rooms;
  console.log(`[config] Reloaded rooms.json (${Object.keys(rooms.rooms).length} rooms)`);
  return rooms;
}

export const config: {
  readonly port: number;
  readonly apiKey: string;
  readonly mqtt: { readonly brokerUrl: string; readonly username: string | undefined; readonly password: string | undefined; readonly topic: string };
  readonly llm: { readonly model: string; readonly intentModel: string; readonly expressionModel: string; readonly complexModel: string };
  readonly cyncLanIp: string;
  readonly technitium: { readonly url: string; readonly username: string; readonly password: string };
  readonly proxy: { readonly port: number; readonly cloudDomain: string; readonly cloudPort: number; readonly dnsServer: string };
  rooms: RoomsConfig;
} = {
  port: parseInt(env("LIGHTS_PORT", "3001"), 10),
  apiKey: env("API_KEY"),

  mqtt: {
    brokerUrl: env("MQTT_BROKER_URL", "mqtt://localhost:1883"),
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    topic: env("CYNC_MQTT_TOPIC", "cync_lan"),
  },

  llm: {
    model: env("LLM_MODEL", "google/gemma-2-9b"),
    intentModel: process.env.LLM_MODEL_INTENT || env("LLM_MODEL", "google/gemma-2-9b"),
    expressionModel: process.env.LLM_MODEL_EXPRESSION || env("LLM_MODEL", "google/gemma-2-9b"),
    complexModel: process.env.LLM_MODEL_COMPLEX || env("LLM_MODEL", "google/gemma-2-9b"),
  },

  cyncLanIp: env("CYNC_LAN_IP", ""),

  technitium: {
    url: env("TECHNITIUM_URL", "http://localhost:5380"),
    username: env("TECHNITIUM_USERNAME", "admin"),
    password: env("TECHNITIUM_PASSWORD", "admin"),
  },

  proxy: {
    port: parseInt(env("PROXY_PORT", "23779"), 10),
    cloudDomain: env("PROXY_CLOUD_DOMAIN", "cm.gelighting.com"),
    cloudPort: parseInt(env("PROXY_CLOUD_PORT", "23779"), 10),
    dnsServer: env("PROXY_DNS_SERVER", "8.8.8.8"),
  },

  rooms: loadRoomsConfig(),
};

export type Config = typeof config;
