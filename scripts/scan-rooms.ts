#!/usr/bin/env tsx
/**
 * scan-rooms.ts
 *
 * Parses a cync_mesh.yaml config file and generates src/data/rooms.json.
 *
 * Usage:
 *   npx tsx scripts/scan-rooms.ts [path-to-cync_mesh.yaml]
 *
 * If no path is given, searches for cync_mesh.yaml in the project root.
 *
 * Modes:
 *   --auto       Skip prompts, auto-group by device name prefix
 *   --list       Just list discovered devices, don't write anything
 *   --merge      Merge into existing rooms.json instead of overwriting
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { join, resolve } from "path";
import { createInterface } from "readline";

// ── Types ──────────────────────────────────────────────────────────────

interface CyncDevice {
  id: number;
  name: string;
  enabled: boolean;
  is_plug: boolean;
  supports_rgb: boolean;
  supports_temperature: boolean;
  type: number;
  mac: string;
}

interface DeviceInfo {
  name: string;
  supports_rgb: boolean;
  supports_temperature: boolean;
}

interface RoomEntry {
  devices: Record<string, DeviceInfo>;
  aliases: string[];
}

interface RoomsConfig {
  home_id: string;
  rooms: Record<string, RoomEntry>;
}

// ── CLI helpers ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const AUTO = flags.has("--auto");
const LIST_ONLY = flags.has("--list");
const MERGE = flags.has("--merge");

const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "..");
const ROOMS_JSON_PATH = join(PROJECT_ROOT, "src", "data", "rooms.json");

function rl() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(prompt: string): Promise<string> {
  const r = rl();
  return new Promise((resolve) => {
    r.question(prompt, (answer) => {
      r.close();
      resolve(answer.trim());
    });
  });
}

// ── Find cync_mesh.yaml ───────────────────────────────────────────────

function findMeshYaml(): string {
  if (positional.length > 0) {
    const p = resolve(positional[0]);
    if (!existsSync(p)) {
      console.error(`File not found: ${p}`);
      process.exit(1);
    }
    return p;
  }

  // Search common locations
  const candidates = [
    join(PROJECT_ROOT, "cync_mesh.yaml"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }

  console.error(
    "Could not find cync_mesh.yaml. Pass the path as an argument:\n" +
      "  npx tsx scripts/scan-rooms.ts /path/to/cync_mesh.yaml"
  );
  process.exit(1);
}

// ── Parse YAML ────────────────────────────────────────────────────────

function parseMesh(filePath: string): { homeId: string; devices: CyncDevice[] } {
  const raw = readFileSync(filePath, "utf-8");
  const doc = parseYaml(raw);

  const accountData = doc["account data"];
  if (!accountData || typeof accountData !== "object") {
    console.error("No 'account data' found in YAML");
    process.exit(1);
  }

  // Get the first (or only) home
  const homeNames = Object.keys(accountData);
  if (homeNames.length === 0) {
    console.error("No homes found under 'account data'");
    process.exit(1);
  }

  const homeName = homeNames[0];
  const home = accountData[homeName];
  const homeId = String(home.id);

  const devicesRaw = home.devices;
  if (!devicesRaw || typeof devicesRaw !== "object") {
    console.error(`No devices found under home "${homeName}"`);
    process.exit(1);
  }

  const devices: CyncDevice[] = [];
  for (const [idStr, dev] of Object.entries(devicesRaw)) {
    const d = dev as Record<string, unknown>;
    const enabled = d.enabled !== "no" && d.enabled !== false;

    devices.push({
      id: parseInt(idStr, 10),
      name: String(d.name ?? `Device ${idStr}`),
      enabled,
      is_plug: d.is_plug === true || d.is_plug === "true",
      supports_rgb: d.supports_rgb === true || d.supports_rgb === "true",
      supports_temperature: d.supports_temperature === true || d.supports_temperature === "true",
      type: typeof d.type === "number" ? d.type : parseInt(String(d.type ?? "0"), 10),
      mac: String(d.mac ?? ""),
    });
  }

  return { homeId, devices };
}

// ── Room grouping heuristic ───────────────────────────────────────────

// Common suffixes to strip when extracting room name from device name
const DEVICE_SUFFIXES = [
  "lamp",
  "light",
  "lights",
  "bulb",
  "plug",
  "switch",
  "dimmer",
  "motion dimmer",
  "strip",
  "led",
  "overhead",
  "ceiling",
  "fan",
  "sconce",
  "fixture",
  "left",
  "right",
  "1",
  "2",
  "3",
  "4",
];

function guessRoom(deviceName: string): string {
  let name = deviceName.toLowerCase().trim();

  // Try removing suffixes from the end, longest match first
  const sortedSuffixes = [...DEVICE_SUFFIXES].sort((a, b) => b.length - a.length);
  for (const suffix of sortedSuffixes) {
    if (name.endsWith(` ${suffix}`)) {
      name = name.slice(0, -(suffix.length + 1)).trim();
    }
  }

  // If nothing left or just a number, use the original name
  if (name.length === 0 || /^\d+$/.test(name)) {
    name = deviceName.toLowerCase().trim();
  }

  return name;
}

function autoGroup(devices: CyncDevice[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();

  for (const dev of devices) {
    if (!dev.enabled) continue;
    const room = guessRoom(dev.name);
    const existing = groups.get(room) ?? [];
    existing.push(dev.id);
    groups.set(room, existing);
  }

  return groups;
}

// ── Display ───────────────────────────────────────────────────────────

function printDeviceTable(devices: CyncDevice[]): void {
  console.log("\n  ID  │ Name                          │ Enabled │ RGB │ Temp │ Plug");
  console.log("  ────┼───────────────────────────────┼─────────┼─────┼──────┼─────");
  for (const d of devices) {
    const id = String(d.id).padStart(3);
    const name = d.name.padEnd(29);
    const en = d.enabled ? " yes   " : " NO    ";
    const rgb = d.supports_rgb ? " yes" : "  - ";
    const temp = d.supports_temperature ? " yes " : "  -  ";
    const plug = d.is_plug ? " yes" : "  - ";
    console.log(`  ${id} │ ${name} │${en}│${rgb} │${temp}│${plug}`);
  }
  console.log();
}

function printGrouping(groups: Map<string, number[]>, devices: CyncDevice[]): void {
  const devMap = new Map(devices.map((d) => [d.id, d]));
  console.log("\n  Proposed room grouping:\n");
  let i = 1;
  for (const [room, ids] of groups) {
    const names = ids.map((id) => {
      const d = devMap.get(id);
      return d ? `${d.name} (${id})` : `Device ${id}`;
    });
    console.log(`  ${i}. "${room}"`);
    for (const n of names) {
      console.log(`       - ${n}`);
    }
    i++;
  }
  console.log();
}

// ── Interactive editing ───────────────────────────────────────────────

async function interactiveEdit(
  groups: Map<string, number[]>,
  devices: CyncDevice[]
): Promise<Map<string, number[]>> {
  const result = new Map(groups);

  console.log("  Commands:");
  console.log("    rename <room> <new_name>    Rename a room");
  console.log("    merge <room1> <room2>       Merge room1 into room2");
  console.log("    move <device_id> <room>     Move a device to a different room");
  console.log("    remove <device_id>          Remove a device from all rooms");
  console.log("    add <device_id> <room>      Add a device to a room");
  console.log("    alias <room> <alias>        Add an alias for a room (stored later)");
  console.log("    done                        Accept and write rooms.json");
  console.log("    quit                        Exit without writing\n");

  const aliases = new Map<string, string[]>();

  while (true) {
    const input = await ask("  > ");
    const parts = input.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    if (!cmd || cmd === "done") break;
    if (cmd === "quit") process.exit(0);

    if (cmd === "rename" && parts.length >= 3) {
      const oldName = parts[1].toLowerCase();
      const newName = parts.slice(2).join(" ").toLowerCase();
      const ids = result.get(oldName);
      if (!ids) {
        console.log(`    Room "${oldName}" not found`);
        continue;
      }
      result.delete(oldName);
      result.set(newName, ids);
      // Move aliases too
      const a = aliases.get(oldName);
      if (a) {
        aliases.delete(oldName);
        aliases.set(newName, a);
      }
      console.log(`    Renamed "${oldName}" -> "${newName}"`);
    } else if (cmd === "merge" && parts.length >= 3) {
      const src = parts[1].toLowerCase();
      const dst = parts[2].toLowerCase();
      const srcIds = result.get(src);
      const dstIds = result.get(dst);
      if (!srcIds) {
        console.log(`    Room "${src}" not found`);
        continue;
      }
      if (!dstIds) {
        console.log(`    Room "${dst}" not found`);
        continue;
      }
      result.set(dst, [...dstIds, ...srcIds]);
      result.delete(src);
      console.log(`    Merged "${src}" into "${dst}"`);
    } else if (cmd === "move" && parts.length >= 3) {
      const devId = parseInt(parts[1], 10);
      const targetRoom = parts.slice(2).join(" ").toLowerCase();
      // Remove from all rooms
      for (const [room, ids] of result) {
        result.set(room, ids.filter((id) => id !== devId));
      }
      // Clean empty rooms
      for (const [room, ids] of result) {
        if (ids.length === 0) result.delete(room);
      }
      // Add to target
      const existing = result.get(targetRoom) ?? [];
      existing.push(devId);
      result.set(targetRoom, existing);
      const dev = devices.find((d) => d.id === devId);
      console.log(`    Moved ${dev?.name ?? `device ${devId}`} to "${targetRoom}"`);
    } else if (cmd === "remove" && parts.length >= 2) {
      const devId = parseInt(parts[1], 10);
      for (const [room, ids] of result) {
        result.set(room, ids.filter((id) => id !== devId));
      }
      for (const [room, ids] of result) {
        if (ids.length === 0) result.delete(room);
      }
      console.log(`    Removed device ${devId} from all rooms`);
    } else if (cmd === "add" && parts.length >= 3) {
      const devId = parseInt(parts[1], 10);
      const targetRoom = parts.slice(2).join(" ").toLowerCase();
      const existing = result.get(targetRoom) ?? [];
      if (!existing.includes(devId)) existing.push(devId);
      result.set(targetRoom, existing);
      console.log(`    Added device ${devId} to "${targetRoom}"`);
    } else if (cmd === "alias" && parts.length >= 3) {
      const room = parts[1].toLowerCase();
      const alias = parts.slice(2).join(" ").toLowerCase();
      if (!result.has(room)) {
        console.log(`    Room "${room}" not found`);
        continue;
      }
      const a = aliases.get(room) ?? [];
      a.push(alias);
      aliases.set(room, a);
      console.log(`    Added alias "${alias}" for "${room}"`);
    } else {
      console.log("    Unknown command. Type 'done' to finish or 'quit' to cancel.");
    }

    printGrouping(result, devices);
  }

  // Attach aliases to a return structure — we'll extract them when writing
  (result as Map<string, number[]> & { _aliases?: Map<string, string[]> })._aliases = aliases;
  return result;
}

// ── Write rooms.json ──────────────────────────────────────────────────

function writeRoomsJson(
  homeId: string,
  groups: Map<string, number[]>,
  aliases: Map<string, string[]>,
  allDevices: CyncDevice[]
): void {
  const devMap = new Map(allDevices.map((d) => [d.id, d]));

  let existing: RoomsConfig | null = null;
  if (MERGE && existsSync(ROOMS_JSON_PATH)) {
    try {
      existing = JSON.parse(readFileSync(ROOMS_JSON_PATH, "utf-8")) as RoomsConfig;
    } catch {
      // ignore parse errors, overwrite
    }
  }

  const rooms: Record<string, RoomEntry> = {};

  for (const [room, deviceIds] of groups) {
    const existingRoom = existing?.rooms[room];
    const existingAliases = existingRoom?.aliases ?? [];
    const newAliases = aliases.get(room) ?? [];
    const merged = [...new Set([...existingAliases, ...newAliases])];

    const devices: Record<string, DeviceInfo> = {};
    for (const id of deviceIds.sort((a, b) => a - b)) {
      const dev = devMap.get(id);
      devices[String(id)] = {
        name: dev?.name ?? `Device ${id}`,
        supports_rgb: dev?.supports_rgb ?? false,
        supports_temperature: dev?.supports_temperature ?? false,
      };
    }

    rooms[room] = { devices, aliases: merged };
  }

  // If merging, keep rooms from existing that weren't touched
  if (existing) {
    for (const [room, entry] of Object.entries(existing.rooms)) {
      if (!rooms[room]) {
        rooms[room] = entry;
      }
    }
  }

  const config: RoomsConfig = { home_id: homeId, rooms };
  const json = JSON.stringify(config, null, 2) + "\n";
  writeFileSync(ROOMS_JSON_PATH, json, "utf-8");
  const deviceCount = Object.values(rooms).reduce((s, r) => s + Object.keys(r.devices).length, 0);
  console.log(`\n  Written to ${ROOMS_JSON_PATH}`);
  console.log(`  ${Object.keys(rooms).length} rooms, ${deviceCount} devices\n`);
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("\n  scan-rooms — Generate rooms.json from cync_mesh.yaml\n");

  const meshPath = findMeshYaml();
  console.log(`  Reading: ${meshPath}`);

  const { homeId, devices } = parseMesh(meshPath);
  console.log(`  Home ID: ${homeId}`);
  console.log(`  Found ${devices.length} devices (${devices.filter((d) => d.enabled).length} enabled)\n`);

  printDeviceTable(devices);

  if (LIST_ONLY) {
    process.exit(0);
  }

  const enabledDevices = devices.filter((d) => d.enabled);
  let groups = autoGroup(enabledDevices);

  printGrouping(groups, enabledDevices);

  let aliases = new Map<string, string[]>();

  if (!AUTO) {
    console.log("  Review the grouping above. Edit or type 'done' to accept.\n");
    groups = await interactiveEdit(groups, enabledDevices);
    aliases =
      (groups as Map<string, number[]> & { _aliases?: Map<string, string[]> })._aliases ??
      new Map();
  }

  writeRoomsJson(homeId, groups, aliases, enabledDevices);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
