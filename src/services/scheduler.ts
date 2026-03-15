import cron from "node-cron";
import Database from "better-sqlite3";
import type { ParsedCommand, Schedule } from "../types/index.js";

type ExecuteFn = (command: ParsedCommand) => Promise<unknown>;

class SchedulerService {
  private db: Database.Database | null = null;
  private jobs = new Map<string, cron.ScheduledTask>();
  private executeFn: ExecuteFn | null = null;

  init(db: Database.Database, executeFn: ExecuteFn): void {
    this.db = db;
    this.executeFn = executeFn;

    db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        name TEXT PRIMARY KEY,
        cron TEXT NOT NULL,
        room TEXT NOT NULL,
        command TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
      )
    `);

    this.loadAll();
  }

  private loadAll(): void {
    if (!this.db) return;

    const rows = this.db
      .prepare("SELECT * FROM schedules WHERE enabled = 1")
      .all() as Array<{
      name: string;
      cron: string;
      room: string;
      command: string;
      enabled: number;
      created_at: string;
    }>;

    for (const row of rows) {
      this.registerJob(row.name, row.cron, JSON.parse(row.command) as ParsedCommand);
    }

    console.log(`[scheduler] Loaded ${rows.length} schedules`);
  }

  private registerJob(name: string, cronExpr: string, command: ParsedCommand): void {
    // Stop existing job if any
    const existing = this.jobs.get(name);
    if (existing) {
      existing.stop();
    }

    const task = cron.schedule(cronExpr, async () => {
      console.log(`[scheduler] Firing schedule "${name}"`);
      try {
        await this.executeFn?.(command);
      } catch (e) {
        console.error(`[scheduler] Error executing schedule "${name}":`, e);
      }
    });

    this.jobs.set(name, task);
    console.log(`[scheduler] Registered job "${name}" with cron: ${cronExpr}`);
  }

  create(
    name: string,
    room: string,
    time: string,
    days: string,
    command: ParsedCommand
  ): Schedule {
    if (!this.db) throw new Error("SchedulerService not initialized");

    const cronExpr = toCron(time, days);
    if (!cron.validate(cronExpr)) {
      throw new Error(`Invalid cron expression: ${cronExpr}`);
    }

    const now = new Date().toISOString();
    const schedule: Schedule = {
      name,
      cron: cronExpr,
      room,
      command,
      enabled: true,
      created_at: now,
    };

    this.db
      .prepare(
        "INSERT OR REPLACE INTO schedules (name, cron, room, command, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)"
      )
      .run(name, cronExpr, room, JSON.stringify(command), now);

    this.registerJob(name, cronExpr, command);

    console.log(`[scheduler] Created schedule "${name}": ${cronExpr}`);
    return schedule;
  }

  delete(name: string): boolean {
    if (!this.db) throw new Error("SchedulerService not initialized");

    const existing = this.jobs.get(name);
    if (existing) {
      existing.stop();
      this.jobs.delete(name);
    }

    const result = this.db
      .prepare("DELETE FROM schedules WHERE name = ?")
      .run(name);
    return result.changes > 0;
  }

  listAll(): Schedule[] {
    if (!this.db) return [];

    const rows = this.db
      .prepare("SELECT * FROM schedules ORDER BY name")
      .all() as Array<{
      name: string;
      cron: string;
      room: string;
      command: string;
      enabled: number;
      created_at: string;
    }>;

    return rows.map((r) => ({
      name: r.name,
      cron: r.cron,
      room: r.room,
      command: JSON.parse(r.command) as ParsedCommand,
      enabled: r.enabled === 1,
      created_at: r.created_at,
    }));
  }
}

function toCron(time: string, days: string): string {
  const [hour, minute] = time.split(":").map(Number);

  let dayOfWeek: string;
  switch (days.toLowerCase()) {
    case "daily":
      dayOfWeek = "*";
      break;
    case "weekdays":
      dayOfWeek = "1-5";
      break;
    case "weekends":
      dayOfWeek = "0,6";
      break;
    default: {
      // Parse comma-separated day names: "mon,tue,fri"
      const dayMap: Record<string, string> = {
        sun: "0", mon: "1", tue: "2", wed: "3",
        thu: "4", fri: "5", sat: "6",
      };
      const parts = days
        .toLowerCase()
        .split(",")
        .map((d) => dayMap[d.trim()] ?? d.trim());
      dayOfWeek = parts.join(",");
    }
  }

  return `${minute} ${hour} * * ${dayOfWeek}`;
}

export const schedulerService = new SchedulerService();
