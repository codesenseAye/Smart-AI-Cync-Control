# smart-ai-cync-control

Voice-controlled TypeScript server that wraps [cync-lan](./cync-lan/) to control Cync/GE smart lights over MQTT using natural language parsed by a local LLM.

## Quick Start

```bash
npm install
# Fill in .env (see Environment Variables below)
# Fill in src/data/rooms.json (see Room Config below)
# Start LM Studio with your model loaded
# Start cync-lan (separate process)
# Start MQTT broker (e.g. Mosquitto on Home Assistant)
npm run dev          # development (tsx watch)
npm run build        # compile to dist/
npm start            # production (node dist/index.js)
```

DNS override requires **Technitium DNS Server** running locally (see DNS Override section).

## Environment Variables (.env)

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_KEY` | **Yes** | — | Bearer token for all API endpoints |
| `LIGHTS_PORT` | No | `3001` | HTTP server port |
| `MQTT_BROKER_URL` | No | `mqtt://homeassistant.local:1883` | MQTT broker URL (same one cync-lan connects to) |
| `MQTT_USERNAME` | No | — | MQTT auth username |
| `MQTT_PASSWORD` | No | — | MQTT auth password |
| `LLM_MODEL` | No | `google/gemma-3-4b` | Model identifier loaded in LM Studio |
| `CYNC_MQTT_TOPIC` | No | `cync_lan` | MQTT topic prefix (must match cync-lan config) |
| `CYNC_LAN_IP` | No | — | LAN IP of the machine running cync-lan, used for DNS override |
| `TECHNITIUM_URL` | No | `http://localhost:5380` | Technitium DNS Server API URL |
| `TECHNITIUM_USERNAME` | No | `admin` | Technitium admin username |
| `TECHNITIUM_PASSWORD` | No | `admin` | Technitium admin password |

## Room Config (src/data/rooms.json)

Maps room names to cync-lan device IDs. Device IDs come from your `cync_mesh.yaml` (the numeric keys under `devices:`). The `home_id` is the numeric `id` field from your cync-lan config under `account data > Home > id`.

```json
{
  "home_id": "123456789",
  "rooms": {
    "kitchen": {
      "devices": [1, 2, 3],
      "aliases": ["ktchn"]
    },
    "bedroom": {
      "devices": [4, 5],
      "aliases": ["bed"]
    }
  }
}
```

- `devices`: array of device ID numbers from cync_mesh.yaml
- `aliases`: alternative names the LLM can recognize for this room
- The keyword `"all"` is handled in code (targets every device across all rooms)

MQTT topics are built as `{CYNC_MQTT_TOPIC}/set/{home_id}-{device_id}` (e.g. `cync_lan/set/123456789-1`).

## Architecture

```
Voice App  -->  POST /command {"text": "kitchen warm dim"}
                       |
                   LLM (LM Studio SDK)  -->  ParsedCommand JSON
                       |
                   Executor  -->  MQTT publish to cync-lan
                       |
                   cync-lan  -->  Cync devices on LAN
```

### Services

| Service | File | Purpose |
|---|---|---|
| **LLM** | `src/services/llm.ts` | Connects to LM Studio via `@lmstudio/sdk`. Sends voice text + system prompt, gets structured JSON back. Retries once on validation failure. |
| **MQTT** | `src/services/mqtt.ts` | Connects to MQTT broker, subscribes to `cync_lan/status/#`, maintains in-memory device state cache. Publishes commands to `cync_lan/set/{id}`. |
| **Executor** | `src/services/executor.ts` | Takes a `ParsedCommand`, resolves room -> device IDs, dispatches to the appropriate handler. Central command router. |
| **Effects** | `src/services/effects.ts` | Runs timed MQTT sequences for complex animations (e.g. "red slow flash"). Uses `AbortController` for cancellation. One active effect per device. Min step: 250ms. |
| **Saves** | `src/services/saves.ts` | SQLite. Snapshots current device states from MQTT cache and stores them by name. Recall replays the stored states. |
| **Scheduler** | `src/services/scheduler.ts` | SQLite + `node-cron`. Stores scheduled commands, converts `time`+`days` to cron expressions, re-registers all jobs on startup. |
| **DNS** | `src/services/dns.ts` | Manages Technitium DNS Server zones to redirect Cync cloud domains to the local cync-lan server network-wide. |

### Routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/command` | Main voice command endpoint. Body: `{"text": "..."}`. Returns parsed interpretation + execution result. |
| `GET` | `/status` | Current device states from MQTT cache |
| `GET` | `/devices` | Room-to-device mapping from rooms.json |
| `GET` | `/saves` | List saved light state shortcuts |
| `GET` | `/schedules` | List scheduled commands |
| `POST` | `/dns/enable` | Enable DNS override (redirects Cync cloud domains to `CYNC_LAN_IP`) |
| `POST` | `/dns/disable` | Disable DNS override (restores normal DNS) |
| `GET` | `/dns/status` | Check if DNS override is active |
| `GET` | `/health` | Health check (no auth required) |

All routes except `/health` require `Authorization: Bearer <API_KEY>` header.

## Command Types

The LLM parses voice text into one of 7 command types (discriminated union on `type` field):

| Type | Example Voice Input | LLM Output |
|---|---|---|
| `power` | "kitchen off", "on", "turn off bedroom" | `{"type":"power","room":"kitchen","state":"OFF"}` |
| `simple` | "kitchen warm dim", "bedroom red", "bright cool" | `{"type":"simple","room":"kitchen","brightness":25,"color_temp_kelvin":2700}` |
| `effect` | "kitchen rainbow", "candle", "bedroom aurora" | `{"type":"effect","room":"kitchen","effect":"rainbow"}` |
| `complex` | "red slow flash", "blue pulse every 2 seconds" | `{"type":"complex","room":"all","sequence":[...],"repeat":true,"transition_style":"fade"}` |
| `save` | "save chill", "save bedroom as relax" | `{"type":"save","name":"chill","room":"all"}` |
| `recall` | "chill", "recall relax" | `{"type":"recall","name":"chill"}` |
| `schedule` | "kitchen off at 11pm daily" | `{"type":"schedule","name":"...","room":"kitchen","time":"23:00","days":"daily","state":{...}}` |

### Color/Brightness Shortcuts in System Prompt

- `warm` = 2700K, `cool` = 5500K, `daylight` = 6500K, `white` = 4000K
- `dim` = 25%, `half` = 50%, `bright` = 100%
- Color names: red, blue, green, purple, orange, pink, teal, yellow -> RGB values
- `slow flash` = 2000ms, `flash` = 500ms, `fast flash` = 300ms, `pulse` = 1000ms fade

### Factory Effects (prefer over complex)

`candle`, `cyber`, `rainbow`, `fireworks`, `volcanic`, `aurora`, `happy_holidays`, `red_white_blue`, `vegas`, `party_time`

## MQTT Protocol Reference

cync-lan publishes device state to `cync_lan/status/{home_id}-{device_id}` and accepts commands on `cync_lan/set/{home_id}-{device_id}`.

### Command Payloads

```json
// Power
{"state": "ON"}
{"state": "OFF"}

// Brightness (0-100 scale)
{"state": "ON", "brightness": 75}

// Color temperature (2000-7000K)
{"state": "ON", "color_temp": 3500}

// RGB color
{"state": "ON", "color": {"r": 255, "g": 0, "b": 0}}

// Factory effect
{"state": "ON", "effect": "rainbow"}
```

### State Messages (from cync-lan)

```json
{
  "state": "ON",
  "brightness": 75,
  "color_mode": "color_temp",
  "color_temp": 3500
}
```

## DNS Override

Cync devices normally connect to cloud servers. cync-lan intercepts by redirecting these domains to the local server:

- `cm.gelighting.com`
- `cm-sec.gelighting.com`
- `cm-ge.xlink.cn`

The DNS service uses **Technitium DNS Server** (running locally on port 5380) to create primary zones for each domain with A records pointing to the cync-lan IP. This works **network-wide** — any device on the network using Technitium as its DNS server will resolve these domains to cync-lan.

### Setup

1. Install Technitium DNS Server (https://technitium.com/dns/)
2. Free up UDP port 53 so Technitium can bind to it. The Windows DNS Client (Dnscache) holds this port. **Do NOT disable the DNS Client service** — that kills all DNS resolution. Instead, stop it from binding to port 53 by disabling the built-in DNS stub listener:
   ```powershell
   # Run in Administrator PowerShell
   reg add "HKLM\SYSTEM\CurrentControlSet\Services\Dnscache\Parameters" /v EnableMDNS /t REG_DWORD /d 0 /f
   netsh interface ipv4 set dnsservers "Wi-Fi" static 127.0.0.1 primary
   ```
   Then restart the PC. If port 53 is still in use after restart, check with `netstat -ano | findstr ":53 "` and stop the conflicting process. As a last resort you can run Technitium in Docker, which avoids the port conflict entirely.
3. After Technitium is running, configure it to use upstream DNS (e.g. `8.8.8.8`, `1.1.1.1`) in its **Settings → Forwarders** so it can resolve normal domains
4. Set a static IP on the PC (Settings → Network → Wi-Fi/Ethernet → IP assignment → Manual) so the DNS settings remain stable
5. Set your router's DHCP DNS to your PC's static LAN IP so all network devices use Technitium
6. Set `CYNC_LAN_IP` in `.env` to the machine's LAN IP where cync-lan runs
7. Use `POST /dns/enable` or `/dns enable` to create the override zones
8. Use `POST /dns/disable` or `/dns disable` to remove them

### DNS Recovery Guide

If you lose internet or DNS stops working, follow these steps. You won't be able to Google anything, so **read this while you still have internet** or keep a copy on your phone.

**Symptom: No internet after restarting**

This usually means the DNS Client service was disabled or your DNS is pointed at a Technitium instance that isn't running.

1. Open **Administrator PowerShell** (right-click Start → Terminal (Admin))
2. Re-enable the DNS Client service:
   ```powershell
   reg add "HKLM\SYSTEM\CurrentControlSet\Services\Dnscache" /v Start /t REG_DWORD /d 2 /f
   ```
3. Re-enable mDNS (undo the port 53 fix if needed):
   ```powershell
   reg add "HKLM\SYSTEM\CurrentControlSet\Services\Dnscache\Parameters" /v EnableMDNS /t REG_DWORD /d 1 /f
   ```
4. Point DNS back to automatic/DHCP:
   ```powershell
   netsh interface ipv4 set dnsservers "Wi-Fi" dhcp
   netsh interface ipv4 set dnsservers "Ethernet" dhcp
   ```
5. Restart the PC

**Symptom: Internet works but specific sites don't load (or Cync domains resolve wrong)**

The Technitium override zones may still be active.

1. Open Technitium web UI at `http://localhost:5380`
2. Go to **Zones**, delete these if they exist:
   - `cm.gelighting.com`
   - `cm-sec.gelighting.com`
   - `cm-ge.xlink.cn`
3. Or use the API endpoint: `POST /dns/disable`

**Symptom: Other devices on the network lost internet**

Your router is pointing all devices at Technitium, but Technitium is down or misconfigured.

1. Log into your router admin page (typically `192.168.1.1` or `192.168.0.1` — use the IP directly since DNS is broken)
2. Go to DHCP settings and change DNS back to automatic or `8.8.8.8` / `1.1.1.1`
3. Reconnect each device's Wi-Fi (or wait for DHCP lease renewal) to pick up the new DNS

**Symptom: Technitium is running but can't resolve anything**

Technitium needs upstream forwarders configured to resolve domains it doesn't have zones for.

1. Open `http://localhost:5380` → **Settings** → **Forwarders**
2. Add `8.8.8.8` and `1.1.1.1` (or your ISP's DNS)
3. Save and test with: `nslookup google.com 127.0.0.1`

**Nuclear option: Undo everything**

If nothing above works, this reverts all DNS changes:
```powershell
# Administrator PowerShell — run all of these
reg add "HKLM\SYSTEM\CurrentControlSet\Services\Dnscache" /v Start /t REG_DWORD /d 2 /f
reg add "HKLM\SYSTEM\CurrentControlSet\Services\Dnscache\Parameters" /v EnableMDNS /t REG_DWORD /d 1 /f
netsh interface ipv4 set dnsservers "Wi-Fi" dhcp
netsh interface ipv4 set dnsservers "Ethernet" dhcp
sc stop "DnsService" 2>$null
sc config "DnsService" start=demand 2>$null
```
Restart the PC. This restores Windows DNS defaults and stops Technitium from auto-starting. You can uninstall Technitium afterward from Add/Remove Programs if desired. Then reset your router DNS back to automatic.

## Prerequisites

1. **cync-lan** running and connected to your Cync devices (separate Python process)
2. **MQTT broker** (e.g. Mosquitto on Home Assistant) — cync-lan and this server both connect to it
3. **LM Studio** running locally with a model loaded (the SDK auto-discovers it, no URL config needed)
4. **Node.js** >= 18 (ES2022 target)
5. **cync_mesh.yaml** configured in cync-lan with your device IDs, home ID, and access key
6. **Technitium DNS Server** for network-wide DNS override (optional, only needed for DNS feature)

## Tech Stack

- TypeScript (ES2022, ESM modules via `"type": "module"`)
- Express.js for HTTP
- `@lmstudio/sdk` for local LLM inference (auto-discovers LM Studio)
- `mqtt` for MQTT pub/sub
- `better-sqlite3` for saves and schedules persistence (WAL mode)
- `node-cron` for scheduled command execution
- `zod` for LLM output validation

## Build & Run

```bash
npm run dev          # tsx watch (auto-reload on changes)
npm run build        # tsc -> dist/
npm start            # node dist/index.js

# Type check only
npx tsc --noEmit
```

SQLite database is created at `src/data/state.db` (gitignored). The `rooms.json` config is loaded from `src/data/rooms.json` at startup.

## Boot Sequence

1. SQLite database init (creates tables for saves + schedules)
2. Saves service init
3. Scheduler service init (loads and registers all enabled cron jobs)
4. MQTT connect + subscribe to status topics (non-fatal if broker unavailable)
5. LM Studio SDK init (non-fatal if LM Studio not running)
6. Express HTTP server start on `LIGHTS_PORT`
