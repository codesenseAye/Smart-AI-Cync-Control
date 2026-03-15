#!/usr/bin/env tsx
/**
 * export-cync.ts
 *
 * Exports device config from the Cync Cloud API and writes cync_mesh.yaml.
 *
 * Two modes:
 *
 *   Interactive (run directly in terminal):
 *     npx tsx scripts/export-cync.ts
 *
 *   CLI (used by Claude Code skill):
 *     npx tsx scripts/export-cync.ts request-otp --email <email>
 *     npx tsx scripts/export-cync.ts export --email <email> --password <pass> --otp <code>
 */

import { writeFileSync, existsSync } from "fs";
import { stringify as stringifyYaml } from "yaml";
import { join, resolve } from "path";
import { createInterface } from "readline";

// ── Constants ──────────────────────────────────────────────────────────

const API_BASE = "https://api.gelighting.com/v2";
const CORP_ID = "1007d2ad150c4000";

const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "..");
const OUTPUT_PATH = join(PROJECT_ROOT, "cync-lan", "cync_mesh.yaml");

// Device type → capability lookup (from cync-lan metadata/model_info.py)
const PLUG_TYPES = new Set([64, 65, 66, 67, 68]);

const RGB_TYPES = new Set([
  6, 7, 8, 21, 22, 23, 30, 31, 32, 33, 34, 35, 41, 42, 43, 47, 71, 72, 76,
  107, 131, 132, 133, 137, 138, 139, 140, 141, 142, 143, 146, 147, 153, 154,
  156, 158, 159, 160, 161, 162, 163, 164, 165, 169,
]);

const TEMP_TYPES = new Set([
  5, 6, 7, 8, 10, 11, 14, 15, 19, 20, 21, 22, 23, 25, 26, 28, 29, 30, 31, 32,
  33, 34, 35, 41, 42, 43, 47, 71, 72, 76, 80, 82, 83, 85, 107, 129, 130, 131,
  132, 133, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147,
  153, 154, 156, 158, 159, 160, 161, 162, 163, 164, 165, 169,
]);

// ── CLI helpers ────────────────────────────────────────────────────────

function parseFlags(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      result[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return result;
}

function ask(prompt: string): Promise<string> {
  const r = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    r.question(prompt, (answer) => {
      r.close();
      resolve(answer.trim());
    });
  });
}

async function askPassword(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");
    let password = "";
    const onData = (ch: string) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r" || c === "\u0004") {
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(password);
      } else if (c === "\u007f" || c === "\b") {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (c === "\u0003") {
        process.exit(0);
      } else {
        password += c;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

// ── Cync Cloud API ─────────────────────────────────────────────────────

async function requestOtp(email: string): Promise<void> {
  const res = await fetch(`${API_BASE}/two_factor/email/verifycode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ corp_id: CORP_ID, email, local_lang: "en-us" }),
  });
  if (!res.ok) {
    throw new Error(`Failed to request OTP (${res.status}): ${await res.text()}`);
  }
}

interface AuthResponse {
  access_token: string;
  user_id: string | number;
}

async function authenticate(email: string, password: string, otp: string): Promise<AuthResponse> {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let resource = "";
  for (let i = 0; i < 16; i++) resource += chars[Math.floor(Math.random() * chars.length)];

  const res = await fetch(`${API_BASE}/user_auth/two_factor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ corp_id: CORP_ID, email, password, two_factor: otp, resource }),
  });
  if (!res.ok) {
    throw new Error(`Authentication failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as AuthResponse;
}

interface RawHome {
  id: number;
  name: string;
  product_id: string;
  access_key: number;
  mac: string;
}

async function getHomes(userId: string | number, token: string): Promise<RawHome[]> {
  const res = await fetch(`${API_BASE}/user/${userId}/subscribe/devices`, {
    headers: { "Access-Token": token },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch homes (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as RawHome[];
}

interface RawDevice {
  deviceID: string;
  displayName: string;
  mac: string;
  wifiMac: string;
  deviceType: number;
  firmwareVersion: string;
}

async function getHomeProperties(
  productId: string,
  homeId: number,
  token: string
): Promise<{ bulbsArray?: RawDevice[] }> {
  const res = await fetch(`${API_BASE}/product/${productId}/device/${homeId}/property`, {
    headers: { "Access-Token": token },
  });
  if (!res.ok) return {};
  return (await res.json()) as { bulbsArray?: RawDevice[] };
}

// ── Export logic ───────────────────────────────────────────────────────

async function exportDevices(email: string, password: string, otp: string): Promise<void> {
  console.log("  Authenticating...");
  const auth = await authenticate(email, password, otp);
  console.log("  Authenticated successfully.\n");

  console.log("  Fetching homes...");
  const homes = await getHomes(auth.user_id, auth.access_token);
  const validHomes = homes.filter((h) => h.name && h.name.length > 0);
  console.log(`  Found ${validHomes.length} home(s)\n`);

  if (validHomes.length === 0) {
    console.error("  No homes found in your Cync account.");
    process.exit(1);
  }

  const accountData: Record<string, unknown> = {};

  for (const home of validHomes) {
    console.log(`  Fetching devices for "${home.name}"...`);
    const props = await getHomeProperties(home.product_id, home.id, auth.access_token);
    const bulbs = props.bulbsArray ?? [];

    if (bulbs.length === 0) {
      console.log("    No devices found, skipping.");
      continue;
    }

    const devices: Record<number, Record<string, unknown>> = {};

    for (const bulb of bulbs) {
      if (!bulb.deviceID || !bulb.displayName || !bulb.mac || !bulb.wifiMac) continue;

      const rawId = String(bulb.deviceID);
      const homeIdStr = rawId.slice(0, 9);
      const rawDev = rawId.split(homeIdStr)[1];
      if (!rawDev) continue;

      const devId = parseInt(rawDev.slice(-3), 10);

      // Skip sub-devices (multi-endpoint children)
      if (rawDev.length > 3) continue;

      const devType = bulb.deviceType;
      devices[devId] = {
        name: bulb.displayName,
        enabled: true,
        mac: bulb.mac,
        wifi_mac: bulb.wifiMac,
        is_plug: PLUG_TYPES.has(devType),
        supports_rgb: RGB_TYPES.has(devType),
        supports_temperature: TEMP_TYPES.has(devType),
        fw: bulb.firmwareVersion,
        type: devType,
      };
    }

    console.log(`    ${Object.keys(devices).length} device(s)`);

    accountData[home.name] = {
      id: home.id,
      access_key: home.access_key,
      mac: home.mac,
      devices,
    };
  }

  if (Object.keys(accountData).length === 0) {
    console.error("\n  No homes with devices found.");
    process.exit(1);
  }

  const yamlContent = stringifyYaml({ "account data": accountData }, { indent: 2 });

  if (existsSync(OUTPUT_PATH)) {
    console.log(`\n  Overwriting existing ${OUTPUT_PATH}`);
  }

  writeFileSync(OUTPUT_PATH, yamlContent, "utf-8");
  console.log(`\n  Written to ${OUTPUT_PATH}`);
  console.log("  Run '/scan-rooms' to generate rooms.json from this config.\n");
}

// ── Entry points ──────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const command = argv[0];

async function main() {
  if (command === "request-otp") {
    // CLI mode: just request OTP
    const flags = parseFlags(argv.slice(1));
    const email = flags.email;
    if (!email) {
      console.error("  Usage: export-cync.ts request-otp --email <email>");
      process.exit(1);
    }
    console.log("\n  export-cync — Requesting OTP...\n");
    await requestOtp(email);
    console.log("  OTP sent! Check your email for the verification code.\n");
  } else if (command === "export") {
    // CLI mode: authenticate and export
    const flags = parseFlags(argv.slice(1));
    const { email, password, otp } = flags;
    if (!email || !password || !otp) {
      console.error("  Usage: export-cync.ts export --email <email> --password <pass> --otp <code>");
      process.exit(1);
    }
    console.log("\n  export-cync — Exporting devices from Cync Cloud\n");
    await exportDevices(email, password, otp);
  } else {
    // Interactive mode: prompt for everything
    console.log("\n  export-cync — Export devices from Cync Cloud API\n");

    const email = await ask("  Email: ");
    const password = await askPassword("  Password: ");

    console.log("\n  Requesting OTP...");
    await requestOtp(email);
    console.log("  Check your email for the verification code.\n");

    const otp = await ask("  OTP Code: ");
    if (!otp || !/^\d+$/.test(otp)) {
      console.error("  Invalid OTP code.");
      process.exit(1);
    }

    console.log();
    await exportDevices(email, password, otp);
  }
}

main().catch((e) => {
  console.error("\n  Error:", e.message ?? e);
  process.exit(1);
});
