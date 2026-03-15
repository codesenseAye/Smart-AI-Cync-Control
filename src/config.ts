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

function loadRoomsConfig(): RoomsConfig {
  const path = join(__dirname, "..", "src", "data", "rooms.json");
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as RoomsConfig;
  } catch (e) {
    console.error(`Failed to load rooms.json from ${path}:`, e);
    process.exit(1);
  }
}

export const config = Object.freeze({
  port: parseInt(env("LIGHTS_PORT", "3001"), 10),
  apiKey: env("API_KEY"),

  mqtt: {
    brokerUrl: env("MQTT_BROKER_URL", "mqtt://homeassistant.local:1883"),
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

  rooms: loadRoomsConfig(),
});

export type Config = typeof config;
