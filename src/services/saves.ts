import Database from "better-sqlite3";
import { config } from "../config.js";
import type { DeviceState, SavedDeviceState, SavedState } from "../types/index.js";
import { mqttService } from "./mqtt.js";

class SavesService {
  private db: Database.Database | null = null;

  init(db: Database.Database): void {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS saves (
        name TEXT PRIMARY KEY,
        room TEXT NOT NULL,
        states TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }

  save(name: string, room: string, specificDeviceIds?: number[]): SavedState {
    if (!this.db) throw new Error("SavesService not initialized");

    const deviceIds = resolveDeviceIds(room, specificDeviceIds);
    const states: SavedDeviceState[] = [];

    for (const deviceId of deviceIds) {
      const current = mqttService.getState(deviceId);
      if (current) {
        states.push({
          device_id: deviceId,
          state: current.state,
          brightness: current.brightness,
          color_mode: current.color_mode,
          color_temp: current.color_temp,
          r: current.color?.r,
          g: current.color?.g,
          b: current.color?.b,
        });
      }
    }

    if (states.length === 0) {
      throw new Error(
        `No device states available to save for room "${room}". Devices may not have reported state yet.`
      );
    }

    const now = new Date().toISOString();
    const saved: SavedState = { name, room, states, created_at: now };

    this.db
      .prepare(
        "INSERT OR REPLACE INTO saves (name, room, states, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(name, room, JSON.stringify(states), now);

    console.log(`[saves] Saved "${name}" with ${states.length} device states`);
    return saved;
  }

  recall(name: string): SavedState | null {
    if (!this.db) throw new Error("SavesService not initialized");

    const row = this.db
      .prepare("SELECT name, room, states, created_at FROM saves WHERE name = ?")
      .get(name) as { name: string; room: string; states: string; created_at: string } | undefined;

    if (!row) return null;

    return {
      name: row.name,
      room: row.room,
      states: JSON.parse(row.states) as SavedDeviceState[],
      created_at: row.created_at,
    };
  }

  listNames(): string[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT name FROM saves ORDER BY name")
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  listAll(): SavedState[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT name, room, states, created_at FROM saves ORDER BY name")
      .all() as Array<{ name: string; room: string; states: string; created_at: string }>;
    return rows.map((r) => ({
      name: r.name,
      room: r.room,
      states: JSON.parse(r.states) as SavedDeviceState[],
      created_at: r.created_at,
    }));
  }

  delete(name: string): boolean {
    if (!this.db) throw new Error("SavesService not initialized");
    const result = this.db
      .prepare("DELETE FROM saves WHERE name = ?")
      .run(name);
    return result.changes > 0;
  }
}

function resolveDeviceIds(room: string, specificDeviceIds?: number[]): string[] {
  const homeId = config.rooms.home_id;

  if (specificDeviceIds && specificDeviceIds.length > 0) {
    return specificDeviceIds.map((d) => `${homeId}-${d}`);
  }

  if (room === "all") {
    const ids: string[] = [];
    for (const r of Object.values(config.rooms.rooms)) {
      for (const devId of Object.keys(r.devices)) {
        ids.push(`${homeId}-${devId}`);
      }
    }
    return ids;
  }

  // Match by room name or alias
  for (const [name, roomCfg] of Object.entries(config.rooms.rooms)) {
    if (
      name === room ||
      roomCfg.aliases.some((a) => a.toLowerCase() === room.toLowerCase())
    ) {
      return Object.keys(roomCfg.devices).map((d) => `${homeId}-${d}`);
    }
  }

  console.warn(`[saves] Unknown room "${room}", treating as "all"`);
  return resolveDeviceIds("all");
}

export const savesService = new SavesService();
