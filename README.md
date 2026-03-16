# Smart AI Cync Control

Voice-controlled smart light system that uses a local LLM to parse natural language commands and control Cync/GE smart lights — no cloud dependency or third-party bridge required.

A built-in TLS relay proxy sits transparently between your Cync devices and the real cloud server, intercepting status updates and injecting local commands while keeping the Cync mobile app fully functional.

## How It Works

```
                    ┌──────────────────────────────────────────┐
                    │              This Server                 │
                    │                                          │
Voice / Text ──────>│  LLM (LM Studio)                        │
                    │       │                                  │
                    │       v                                  │
                    │  Executor ──> MQTT ──> TLS Proxy ────────┼──> Cync Cloud
                    │                          │               │
                    │                          └───────────────┼──> Cync Devices
                    └──────────────────────────────────────────┘
```

1. You send a natural language command (e.g. *"kitchen warm dim"*)
2. A local LLM parses it into a structured command
3. The command is published over MQTT
4. The TLS relay proxy injects the control packet into the device's existing cloud connection

The proxy also reads status packets from the device stream and publishes them to MQTT, so the server always knows the current state of every light.

## Features

- **Natural language control** — *"bedroom warm and dim"*, *"make it cozy"*, *"rainbow"*, *"kill the lights"*
- **5 command types** — power, color/brightness, factory effects, complex animations, recall presets
- **Factory effects** — candle, cyber, rainbow, fireworks, volcanic, aurora, and more
- **Custom animations** — flash, pulse, strobe, breathing with configurable timing
- **TLS relay proxy** — transparent MITM keeps cloud + mobile app working alongside local control
- **DNS override** — network-wide Cync domain redirect via Technitium DNS Server
- **Electron desktop app** — auto-manages Mosquitto, LM Studio, and the server from a single UI
- **Portable exe** — single-file Windows executable, no install required

## Prerequisites

| Dependency | Purpose |
|---|---|
| [Mosquitto](https://mosquitto.org/) | MQTT broker (installed as Windows service) |
| [LM Studio](https://lmstudio.ai/) | Local LLM inference |
| [Technitium DNS Server](https://technitium.com/dns/) | DNS override for Cync devices |
| Node.js >= 18 | Runtime |

The desktop app auto-starts Mosquitto and LM Studio — you just need them installed.

## Quick Start

```bash
npm install

# Create .env with your config (see Environment Variables below)
# Export device config from Cync Cloud (one-time)
npx tsx scripts/export-cync.ts

# Generate room mappings from exported device data
npx tsx scripts/scan-rooms.ts

# Start in development mode
npm run dev
```

## Environment Variables

Create a `.env` file in the project root:

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_KEY` | **Yes** | — | Bearer token for API auth |
| `LIGHTS_PORT` | No | `3001` | HTTP server port |
| `MQTT_BROKER_URL` | No | `mqtt://localhost:1883` | MQTT broker URL |
| `MQTT_USERNAME` | No | — | MQTT auth username |
| `MQTT_PASSWORD` | No | — | MQTT auth password |
| `LLM_MODEL` | No | `google/gemma-3-4b` | Model loaded in LM Studio |
| `CYNC_MQTT_TOPIC` | No | `cync_lan` | MQTT topic prefix |
| `CYNC_LAN_IP` | No | — | This machine's LAN IP (for DNS override) |
| `PROXY_PORT` | No | `23779` | TLS proxy listen port |
| `PROXY_CLOUD_DOMAIN` | No | `cm.gelighting.com` | Cloud domain to relay to |
| `PROXY_DNS_SERVER` | No | `8.8.8.8` | External DNS for resolving cloud IP |
| `TECHNITIUM_URL` | No | `http://localhost:5380` | Technitium API URL |
| `TECHNITIUM_USERNAME` | No | `admin` | Technitium admin user |
| `TECHNITIUM_PASSWORD` | No | `admin` | Technitium admin password |

## Command Types

| Type | Example | What it does |
|---|---|---|
| `power` | *"kitchen off"*, *"turn on bedroom"* | Power on/off |
| `simple` | *"kitchen warm dim"*, *"bedroom red"* | Set brightness, color temp, or RGB |
| `effect` | *"rainbow"*, *"candle"*, *"aurora"* | Activate a factory effect |
| `complex` | *"red slow flash"*, *"blue pulse"* | Custom animation sequence |
| `recall` | *"chill"*, *"recall relax"* | Recall a saved preset |

## Build & Run

```bash
npm run dev          # development with auto-reload
npm run build        # compile TypeScript
npm start            # production
npx tsc --noEmit     # type check only
```

### Desktop App

```bash
cd app && npm run release   # build portable .exe
```

The app manages three services automatically:
- **MQTT** — starts/stops the Mosquitto Windows service
- **AI** — launches LM Studio if not already running
- **Host** — runs the wrapper server (Express + proxy)

## API

All routes except `/health` require `Authorization: Bearer <API_KEY>`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/command` | Voice command — `{"text": "..."}` |
| `GET` | `/status` | Device states + proxy info |
| `GET` | `/devices` | Room-to-device mapping |
| `GET` | `/saves` | Saved presets |
| `POST` | `/dns/enable` | Enable DNS override |
| `POST` | `/dns/disable` | Disable DNS override |
| `GET` | `/dns/status` | DNS override status |
| `GET` | `/health` | Health check (no auth) |

## DNS Override

Cync devices connect to cloud servers by default. The DNS override redirects these domains to the local proxy:

- `cm.gelighting.com`
- `cm-sec.gelighting.com`
- `cm-ge.xlink.cn`

Technitium DNS Server creates primary zones with A records pointing to your machine's LAN IP. Set your router's DHCP DNS to your PC's IP so all network devices resolve through Technitium.

```
/dns enable    # create override zones
/dns disable   # remove override zones
/dns status    # check current state
```

See [CLAUDE.md](CLAUDE.md) for detailed DNS setup instructions and recovery guide.

## Testing

```bash
npm run test:llm     # run LLM parsing test suite
```

Requires LM Studio running with the configured model.

## License

MIT
