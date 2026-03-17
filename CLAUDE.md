# smart-ai-cync-control

Voice-controlled TypeScript server that controls Cync/GE smart lights using natural language parsed by a local LLM. A built-in TLS relay proxy sits between Cync devices and the real cloud server, parsing status packets and injecting local control commands while keeping the Cync mobile app and cloud features functional.

## Quick Start

```bash
npm install
# Fill in .env (see Environment Variables below)
# Fill in src/data/rooms.json (see Room Config below)
# Start LM Studio with your model loaded
# Start MQTT broker (e.g. Mosquitto)
# Enable DNS override so Cync devices connect to the proxy
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
| `MQTT_BROKER_URL` | No | `mqtt://localhost:1883` | MQTT broker URL |
| `MQTT_USERNAME` | No | — | MQTT auth username |
| `MQTT_PASSWORD` | No | — | MQTT auth password |
| `LLM_MODEL` | No | `google/gemma-3-4b` | Model identifier loaded in LM Studio |
| `CYNC_MQTT_TOPIC` | No | `cync_lan` | MQTT topic prefix |
| `CYNC_LAN_IP` | No | — | LAN IP of this machine, used for DNS override |
| `TECHNITIUM_URL` | No | `http://localhost:5380` | Technitium DNS Server API URL |
| `TECHNITIUM_USERNAME` | No | `admin` | Technitium admin username |
| `TECHNITIUM_PASSWORD` | No | `admin` | Technitium admin password |
| `PROXY_PORT` | No | `23779` | Proxy listen port |
| `PROXY_CLOUD_DOMAIN` | No | `cm.gelighting.com` | Cloud domain to resolve and relay to |
| `PROXY_CLOUD_PORT` | No | `23779` | Real Cync cloud server port |
| `PROXY_DNS_SERVER` | No | `8.8.8.8` | External DNS server for resolving cloud IP |

## Room Config (src/data/rooms.json)

Maps room names to Cync device IDs. Device IDs come from `cync_mesh.yaml` (the numeric keys under `devices:`), exported via `/export-cync`. The `home_id` is the numeric `id` field from your Cync account data under `Home > id`.

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

- `devices`: array of device ID numbers from `cync_mesh.yaml`
- `aliases`: alternative names the LLM can recognize for this room
- The keyword `"all"` is handled in code (targets every device across all rooms)

MQTT topics are built as `{CYNC_MQTT_TOPIC}/set/{home_id}-{device_id}` (e.g. `cync_lan/set/123456789-1`).

## Architecture

```
Voice App  -->  POST /command {"text": "kitchen warm dim"}
                       |
                   LLM (LM Studio SDK)  -->  ParsedCommand JSON
                       |
                   Executor  -->  MQTT publish
                       |
                   TLS Proxy
                       |
              Cync devices ←→ Real Cloud
```

The TLS proxy acts as a transparent MITM relay between Cync devices and the real cloud server. At startup it resolves the cloud IP via an external DNS server (default 8.8.8.8) and auto-generates a self-signed cert. It parses status packets (0x43/0x83) from the device stream for MQTT state publishing and injects local control commands (0x73) when MQTT set messages arrive. The Cync mobile app and cloud features (schedules, saves) continue working normally since all traffic is relayed.

### Services

| Service | File | Purpose |
|---|---|---|
| **LLM** | `src/services/llm.ts` | Connects to LM Studio via `@lmstudio/sdk`. Sends voice text + system prompt, gets structured JSON back. Retries once on validation failure. |
| **MQTT** | `src/services/mqtt.ts` | Connects to MQTT broker, subscribes to `cync_lan/status/#` and `cync_lan/set/#`. Maintains in-memory device state cache. Routes set commands through the proxy. |
| **Executor** | `src/services/executor.ts` | Takes a `ParsedCommand`, resolves room -> device IDs, dispatches to the appropriate handler. Central command router. |
| **Effects** | `src/services/effects.ts` | Runs timed MQTT sequences for complex animations (e.g. "red slow flash"). Uses `AbortController` for cancellation. One active effect per device. Min step: 250ms. |
| **Protocol** | `src/services/protocol.ts` | Cync binary protocol parser and command builder. |
| **Proxy** | `src/services/proxy.ts` | Transparent TLS MITM relay between Cync devices and cloud. Parses status, injects commands. |
| **DNS** | `src/services/dns.ts` | Manages Technitium DNS Server zones to redirect Cync cloud domains to the local proxy network-wide. |

### Routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/command` | Main voice command endpoint. Body: `{"text": "..."}`. Returns parsed interpretation + execution result. |
| `GET` | `/status` | Current device states from MQTT cache + proxy info |
| `GET` | `/devices` | Room-to-device mapping from rooms.json |
| `POST` | `/dns/enable` | Enable DNS override (redirects Cync cloud domains to `CYNC_LAN_IP`) |
| `POST` | `/dns/disable` | Disable DNS override (restores normal DNS) |
| `GET` | `/dns/status` | Check if DNS override is active |
| `GET` | `/health` | Health check (no auth required) |

All routes except `/health` require `Authorization: Bearer <API_KEY>` header.

## Command Types

The LLM parses voice text into one of 4 command types (discriminated union on `type` field):

| Type | Example Voice Input | LLM Output |
|---|---|---|
| `power` | "kitchen off", "on", "turn off bedroom" | `{"type":"power","room":"kitchen","state":"OFF"}` |
| `simple` | "kitchen warm dim", "bedroom red", "bright cool" | `{"type":"simple","room":"kitchen","brightness":25,"color_temp_kelvin":2700}` |
| `effect` | "kitchen rainbow", "candle", "bedroom aurora" | `{"type":"effect","room":"kitchen","effect":"rainbow"}` |
| `complex` | "red slow flash", "blue pulse every 2 seconds" | `{"type":"complex","room":"all","sequence":[...],"repeat":true,"transition_style":"fade"}` |

### Color/Brightness Shortcuts in System Prompt

- `warm` = 2700K, `cool` = 5500K, `daylight` = 6500K, `white` = 4000K
- `dim` = 25%, `half` = 50%, `bright` = 100%
- Color names: red, blue, green, purple, orange, pink, teal, yellow -> RGB values
- `slow flash` = 2000ms, `flash` = 500ms, `fast flash` = 300ms, `pulse` = 1000ms fade

### Factory Effects (prefer over complex)

`candle`, `cyber`, `rainbow`, `fireworks`, `volcanic`, `aurora`, `happy_holidays`, `red_white_blue`, `vegas`, `party_time`

## MQTT Protocol Reference

The proxy publishes device state to `cync_lan/status/{home_id}-{device_id}` and accepts commands on `cync_lan/set/{home_id}-{device_id}`.

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

### State Messages (from proxy)

```json
{
  "state": "ON",
  "brightness": 75,
  "color_mode": "color_temp",
  "color_temp": 3500
}
```

## DNS Override

Cync devices normally connect to cloud servers. The proxy intercepts by redirecting these domains to the local machine:

- `cm.gelighting.com`
- `cm-sec.gelighting.com`
- `cm-ge.xlink.cn`

The DNS service uses **Technitium DNS Server** (running locally on port 5380) to create primary zones for each domain with A records pointing to the local IP. This works **network-wide** — any device on the network using Technitium as its DNS server will resolve these domains to the proxy.

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
6. Set `CYNC_LAN_IP` in `.env` to this machine's LAN IP
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

1. **MQTT broker** (e.g. Mosquitto) running locally
2. **LM Studio** running locally with a model loaded (the SDK auto-discovers it, no URL config needed)
3. **Node.js** >= 18 (ES2022 target)
4. **`cync_mesh.yaml`** exported via `/export-cync` (contains device IDs, home ID, and access key)
5. **Technitium DNS Server** for network-wide DNS override so Cync devices connect to the proxy

## Tech Stack

### Server (`/src`)
- TypeScript (ES2022, ESM modules via `"type": "module"`)
- Express.js for HTTP
- `@lmstudio/sdk` for local LLM inference (auto-discovers LM Studio)
- `mqtt` for MQTT pub/sub
- `selfsigned` for auto-generating TLS certificates
- `zod` for LLM output validation

### Desktop App (`/app`)
- Electron 35 (main + preload + renderer process model)
- React 19 + TypeScript for the renderer UI
- esbuild bundles the React renderer (JSX + CSS)
- `tsc` compiles main process and preload only (renderer excluded)
- electron-builder for portable Windows .exe packaging

## Build & Run

```bash
# Server
npm run dev          # tsx watch (auto-reload on changes)
npm run build        # tsc -> dist/
npm start            # node dist/index.js
npx tsc --noEmit     # type check only

# Desktop App
cd app
npm run build        # tsc (main+preload) + esbuild (React renderer) + copy HTML
npm run dev          # build + launch Electron
npm run release      # build + bundle server + electron-builder portable .exe

# From root
npm run app:dev      # shortcut for cd app && npm run dev
npm run app:build    # shortcut for cd app && npm run build
npm run app:release  # builds server first, then app release
```

The `rooms.json` config is loaded from `src/data/rooms.json` at startup.

### Desktop App Build Pipeline

1. `tsc` compiles `app/src/main/` and `app/src/preload/` to `app/dist/` (CommonJS)
2. `scripts/build-renderer.js` uses esbuild to bundle `app/src/renderer/index.tsx` into `app/dist/renderer/renderer.js` + `renderer.css` (JSX automatic transform, CSS imports bundled)
3. `scripts/copy-static.js` copies `index.html` to `app/dist/renderer/`
4. For release: `scripts/bundle-server.js` bundles the compiled server into `app/dist/server/bundle.cjs`
5. electron-builder packages everything into a portable `.exe` in `app/release/`

## Boot Sequence

1. MQTT connect + subscribe to status and set topics (non-fatal if broker unavailable)
2. LM Studio SDK init (non-fatal if LM Studio not running)
3. TLS relay proxy start — resolves cloud IP via external DNS, generates self-signed cert (non-fatal)
4. Express HTTP server start on `LIGHTS_PORT`
