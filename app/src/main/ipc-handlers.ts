import { ipcMain, shell } from "electron";
import https from "node:https";
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ServiceManager } from "./services";
import { AppConfig } from "./env-loader";
import { DATA_PATHS } from "./data-dir";

export function registerIpcHandlers(
  services: ServiceManager,
  config: AppConfig
): void {
  // Send a command to the wrapper server's POST /command endpoint
  ipcMain.handle("command:send", async (_event, text: string) => {
    try {
      const result = await postCommand(text, config);
      return { ok: true, ...result };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // Get current statuses of all services
  ipcMain.handle("services:status", async () => {
    return services.getAllStatuses();
  });

  // Poll current device states from the wrapper server
  ipcMain.handle("devices:poll", async () => {
    return getDeviceStates(config);
  });

  // Return room configuration for device ID resolution
  ipcMain.handle("rooms:get", async () => {
    try {
      const raw = readFileSync(DATA_PATHS.roomsJson, "utf-8");
      return JSON.parse(raw);
    } catch {
      return { home_id: "", rooms: {} };
    }
  });

  // Settings: read cync_mesh.yaml and return parsed devices
  ipcMain.handle("settings:getMesh", async () => {
    try {
      const raw = readFileSync(DATA_PATHS.cyncMesh, "utf-8");
      return { ok: true, devices: parseCyncMesh(raw), path: DATA_PATHS.cyncMesh };
    } catch {
      return { ok: false, devices: [], path: DATA_PATHS.cyncMesh };
    }
  });

  // Settings: read config.env and return key-value pairs
  ipcMain.handle("settings:getConfig", async () => {
    try {
      const raw = readFileSync(DATA_PATHS.configEnv, "utf-8");
      return { ok: true, entries: parseConfigEnv(raw), path: DATA_PATHS.configEnv };
    } catch {
      return { ok: false, entries: [], path: DATA_PATHS.configEnv };
    }
  });

  // Settings: read rooms.json and reload server config
  ipcMain.handle("settings:getRooms", async () => {
    try {
      const raw = readFileSync(DATA_PATHS.roomsJson, "utf-8");
      await reloadServerRooms(config);
      return { ok: true, data: JSON.parse(raw), path: DATA_PATHS.roomsJson };
    } catch {
      return { ok: false, data: null, path: DATA_PATHS.roomsJson };
    }
  });

  // Settings: open a file in the system default editor
  ipcMain.handle("settings:openFile", async (_event, filePath: string) => {
    const allowed = [DATA_PATHS.configEnv, DATA_PATHS.roomsJson, DATA_PATHS.cyncMesh];
    if (!allowed.includes(filePath)) return { ok: false, error: "Not allowed" };
    if (!existsSync(filePath)) return { ok: false, error: "File not found" };
    await shell.openPath(filePath);
    return { ok: true };
  });

  // Cloud sync step 1: request OTP
  ipcMain.handle("cloud:requestOtp", async (_event, email: string) => {
    try {
      await cyncRequestOtp(email);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // Cloud sync step 2: authenticate, fetch devices, write mesh yaml + rooms json
  ipcMain.handle("cloud:sync", async (_event, email: string, password: string, otp: string) => {
    try {
      const result = await cyncExportAndScan(email, password, otp);
      await reloadServerRooms(config);
      return { ok: true, ...result };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // Move a device between rooms (drag-and-drop)
  ipcMain.handle("settings:moveDevice", async (_event, deviceId: string, fromRoom: string, toRoom: string) => {
    try {
      const raw = readFileSync(DATA_PATHS.roomsJson, "utf-8");
      const cfg = JSON.parse(raw);
      const rooms = cfg.rooms || {};

      const srcRoom = rooms[fromRoom];
      if (!srcRoom || !srcRoom.devices) return { ok: false, error: "Source room not found" };

      const deviceInfo = srcRoom.devices[deviceId];
      if (!deviceInfo) return { ok: false, error: "Device not in source room" };

      // Remove from source
      delete srcRoom.devices[deviceId];

      // Add to target (create room if needed)
      if (!rooms[toRoom]) rooms[toRoom] = { devices: {}, aliases: [] };
      rooms[toRoom].devices[deviceId] = deviceInfo;

      cfg.rooms = rooms;
      writeFileSync(DATA_PATHS.roomsJson, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
      await reloadServerRooms(config);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });
}

function postCommand(
  text: string,
  config: AppConfig
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text });
    const req = http.request(
      {
        hostname: "localhost",
        port: config.port,
        path: "/command",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data });
          }
        });
      }
    );
    req.on("error", (err) => reject(err));
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error("Command request timed out"));
    });
    req.write(body);
    req.end();
  });
}

interface MeshDevice {
  id: string;
  name: string;
  enabled: boolean;
  mac: string;
  supports_rgb: boolean;
  supports_temperature: boolean;
  fw: string;
  type: number;
}

function parseCyncMesh(raw: string): MeshDevice[] {
  const devices: MeshDevice[] = [];
  const lines = raw.split("\n");
  let currentDevice: Partial<MeshDevice> | null = null;
  let inDevices = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    // Detect "devices:" section (indented under a home)
    if (/^\s+devices:\s*$/.test(trimmed)) {
      inDevices = true;
      continue;
    }
    if (!inDevices) continue;

    // Device ID line: "      17:" (6+ spaces, then number:)
    const idMatch = trimmed.match(/^\s{6}(\d+):\s*$/);
    if (idMatch) {
      if (currentDevice && currentDevice.id) devices.push(currentDevice as MeshDevice);
      currentDevice = { id: idMatch[1] };
      continue;
    }

    // Property line: "        name: Ceiling Light I" (8+ spaces)
    if (currentDevice) {
      const propMatch = trimmed.match(/^\s{8}(\w+):\s*(.*)$/);
      if (propMatch) {
        const [, key, val] = propMatch;
        const clean = val.replace(/^["']|["']$/g, "");
        if (key === "name") currentDevice.name = clean;
        else if (key === "enabled") currentDevice.enabled = clean === "true";
        else if (key === "mac") currentDevice.mac = clean;
        else if (key === "supports_rgb") currentDevice.supports_rgb = clean === "true";
        else if (key === "supports_temperature") currentDevice.supports_temperature = clean === "true";
        else if (key === "fw") currentDevice.fw = clean;
        else if (key === "type") currentDevice.type = parseInt(clean, 10);
      } else if (!/^\s{7,}/.test(trimmed)) {
        // Left the device block
        inDevices = false;
      }
    }
  }
  if (currentDevice && currentDevice.id) devices.push(currentDevice as MeshDevice);
  return devices;
}

function parseConfigEnv(raw: string): Array<{ key: string; value: string; comment: boolean }> {
  const entries: Array<{ key: string; value: string; comment: boolean }> = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      entries.push({ key: trimmed, value: "", comment: true });
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Mask sensitive values
    const sensitive = ["API_KEY", "MQTT_PASSWORD", "TECHNITIUM_PASSWORD"];
    const masked = sensitive.includes(key) ? value.slice(0, 3) + "***" : value;
    entries.push({ key, value: masked, comment: false });
  }
  return entries;
}

// ── Cync Cloud API ──────────────────────────────────────────────────

const CYNC_API = "https://api.gelighting.com/v2";
const CYNC_CORP_ID = "1007d2ad150c4000";

const PLUG_TYPES = new Set([64, 65, 66, 67, 68]);
const RGB_TYPES = new Set([
  6,7,8,21,22,23,30,31,32,33,34,35,41,42,43,47,71,72,76,
  107,131,132,133,137,138,139,140,141,142,143,146,147,153,154,156,158,159,160,161,162,163,164,165,169,
]);
const TEMP_TYPES = new Set([
  5,6,7,8,10,11,14,15,19,20,21,22,23,25,26,28,29,30,31,32,
  33,34,35,41,42,43,47,71,72,76,80,82,83,85,107,129,130,131,
  132,133,135,136,137,138,139,140,141,142,143,144,145,146,147,
  153,154,156,158,159,160,161,162,163,164,165,169,
]);

function fetchJson(url: string, opts: { method?: string; headers?: Record<string,string>; body?: string } = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    };
    const req = https.request(reqOpts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error("Request timed out")); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function cyncRequestOtp(email: string): Promise<void> {
  await fetchJson(`${CYNC_API}/two_factor/email/verifycode`, {
    method: "POST",
    body: JSON.stringify({ corp_id: CYNC_CORP_ID, email, local_lang: "en-us" }),
  });
}

async function cyncExportAndScan(email: string, password: string, otp: string): Promise<{ deviceCount: number; roomCount: number }> {
  // Authenticate
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let resource = "";
  for (let i = 0; i < 16; i++) resource += chars[Math.floor(Math.random() * chars.length)];

  const auth = await fetchJson(`${CYNC_API}/user_auth/two_factor`, {
    method: "POST",
    body: JSON.stringify({ corp_id: CYNC_CORP_ID, email, password, two_factor: otp, resource }),
  });

  // Fetch homes
  const homes = await fetchJson(`${CYNC_API}/user/${auth.user_id}/subscribe/devices`, {
    headers: { "Access-Token": auth.access_token },
  });

  const validHomes = (homes as any[]).filter((h: any) => h.name && h.name.length > 0);
  if (validHomes.length === 0) throw new Error("No homes found in your Cync account");

  // Build mesh YAML manually (avoid yaml dependency)
  const allDevices: Array<{ id: number; name: string; homeId: number; supports_rgb: boolean; supports_temperature: boolean }> = [];
  let yamlLines = ["account data:"];

  for (const home of validHomes) {
    const props = await fetchJson(`${CYNC_API}/product/${home.product_id}/device/${home.id}/property`, {
      headers: { "Access-Token": auth.access_token },
    }).catch(() => ({}));

    const bulbs = (props as any).bulbsArray ?? [];
    yamlLines.push(`  ${home.name}:`);
    yamlLines.push(`    id: ${home.id}`);
    yamlLines.push(`    access_key: ${home.access_key}`);
    yamlLines.push(`    mac: ${home.mac}`);
    yamlLines.push("    devices:");

    for (const bulb of bulbs) {
      if (!bulb.deviceID || !bulb.displayName || !bulb.mac || !bulb.wifiMac) continue;
      const rawId = String(bulb.deviceID);
      const homeIdStr = rawId.slice(0, 9);
      const rawDev = rawId.split(homeIdStr)[1];
      if (!rawDev || rawDev.length > 3) continue;

      const devId = parseInt(rawDev.slice(-3), 10);
      const devType = bulb.deviceType;
      const isRgb = RGB_TYPES.has(devType);
      const isTemp = TEMP_TYPES.has(devType);
      const isPlug = PLUG_TYPES.has(devType);

      yamlLines.push(`      ${devId}:`);
      yamlLines.push(`        name: ${bulb.displayName}`);
      yamlLines.push(`        enabled: true`);
      yamlLines.push(`        mac: ${bulb.mac}`);
      yamlLines.push(`        wifi_mac: ${bulb.wifiMac}`);
      yamlLines.push(`        is_plug: ${isPlug}`);
      yamlLines.push(`        supports_rgb: ${isRgb}`);
      yamlLines.push(`        supports_temperature: ${isTemp}`);
      yamlLines.push(`        fw: ${bulb.firmwareVersion || '""'}`);
      yamlLines.push(`        type: ${devType}`);

      allDevices.push({ id: devId, name: bulb.displayName, homeId: home.id, supports_rgb: isRgb, supports_temperature: isTemp });
    }
  }

  // Write cync_mesh.yaml
  mkdirSync(dirname(DATA_PATHS.cyncMesh), { recursive: true });
  writeFileSync(DATA_PATHS.cyncMesh, yamlLines.join("\n") + "\n", "utf-8");

  // Auto-generate rooms.json from the mesh
  const homeId = String(validHomes[0].id);
  const SUFFIXES = ["lamp","light","lights","bulb","plug","switch","dimmer","strip","led","overhead","ceiling","fan","sconce","fixture","left","right","1","2","3","4"];
  const sortedSuffixes = [...SUFFIXES].sort((a, b) => b.length - a.length);

  function guessRoom(name: string): string {
    let n = name.toLowerCase().trim();
    for (const s of sortedSuffixes) {
      if (n.endsWith(` ${s}`)) n = n.slice(0, -(s.length + 1)).trim();
    }
    if (!n || /^\d+$/.test(n)) n = name.toLowerCase().trim();
    return n;
  }

  // Try to preserve existing room assignments and aliases
  let existingRooms: Record<string, any> = {};
  try {
    const existing = JSON.parse(readFileSync(DATA_PATHS.roomsJson, "utf-8"));
    existingRooms = existing.rooms || {};
  } catch { /* no existing */ }

  // Build a map of deviceId -> existing room name
  const existingDeviceRoom = new Map<string, string>();
  for (const [roomName, roomCfg] of Object.entries(existingRooms) as [string, any][]) {
    const devs = roomCfg.devices || {};
    for (const id of Object.keys(devs)) {
      existingDeviceRoom.set(id, roomName);
    }
  }

  const rooms: Record<string, { devices: Record<string, any>; aliases: string[] }> = {};
  // Seed existing rooms structure (preserving aliases)
  for (const [rn, rc] of Object.entries(existingRooms) as [string, any][]) {
    rooms[rn] = { devices: {}, aliases: rc.aliases || [] };
  }

  for (const dev of allDevices) {
    const idStr = String(dev.id);
    const existingRoom = existingDeviceRoom.get(idStr);
    const roomName = existingRoom || guessRoom(dev.name);

    if (!rooms[roomName]) rooms[roomName] = { devices: {}, aliases: [] };
    rooms[roomName].devices[idStr] = {
      name: dev.name,
      supports_rgb: dev.supports_rgb,
      supports_temperature: dev.supports_temperature,
    };
  }

  // Remove empty rooms
  for (const [rn, rc] of Object.entries(rooms)) {
    if (Object.keys(rc.devices).length === 0) delete rooms[rn];
  }

  writeFileSync(DATA_PATHS.roomsJson, JSON.stringify({ home_id: homeId, rooms }, null, 2) + "\n", "utf-8");

  const roomCount = Object.keys(rooms).length;
  return { deviceCount: allDevices.length, roomCount };
}

/** Tell the running wrapper server to reload rooms.json from disk. */
function reloadServerRooms(config: AppConfig): Promise<void> {
  return new Promise((resolve) => {
    const body = "";
    const req = http.request(
      {
        hostname: "localhost",
        port: config.port,
        path: "/reload-rooms",
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}` },
      },
      () => resolve()
    );
    req.on("error", () => resolve()); // best-effort
    req.setTimeout(5_000, () => { req.destroy(); resolve(); });
    req.end(body);
  });
}

function getDeviceStates(config: AppConfig): Promise<unknown> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: config.port,
        path: "/status",
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(5_000, () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

