import Database from "better-sqlite3";
import type { SavedDeviceState, SavedState } from "../types/index.js";

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

export const savesService = new SavesService();
