# Smart AI Cync Control

Voice-controlled smart light system that uses a local LLM to parse natural language commands and control Cync/GE smart lights via a built-in TLS relay proxy — no third-party bridge required.

Say things like *"bedroom warm and dim"*, *"make it cozy"*, *"rainbow"*, or *"kitchen off"* and the system figures out what you mean.

## How It Works

```
Voice / Text  -->  POST /command {"text": "kitchen warm dim"}
                          |
                      Local LLM (LM Studio)  -->  Structured JSON command
                          |
                      Executor  -->  MQTT publish
                          |
                      TLS Relay Proxy  -->  Cync devices on LAN
```

A TypeScript Express server receives natural language text, sends it to a local LLM running in LM Studio, validates the structured output with Zod, and dispatches commands through a transparent TLS relay proxy that sits between Cync devices and the real cloud server. The proxy parses device status packets and injects local control commands while keeping the Cync mobile app and cloud features working.

## Features

- **Natural language parsing** — understands colors, moods, brightness levels, room names, and device names via local LLM inference
- **5 command types** — power, color/brightness, factory effects, complex animations, recall presets
- **100+ recognized phrases** — from explicit (*"bedroom red"*) to interpretive (*"make it cozy"*, *"bedtime"*, *"date night"*)
- **Factory effects** — candle, cyber, rainbow, fireworks, volcanic, aurora, and more
- **Custom animations** — flash, pulse, strobe, breathing patterns with configurable timing
- **Recall presets** — recall saved light states by name
- **TLS relay proxy** — transparent MITM between Cync devices and cloud, no separate bridge needed
- **DNS override** — network-wide redirect of Cync cloud domains to the local proxy via Technitium DNS Server
- **Electron desktop app** — manages all services (Mosquitto, LM Studio, wrapper server) from a single UI

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js (>= 18) |
| Language | TypeScript (ES2022, ESM) |
| HTTP Server | Express.js |
| LLM Inference | [LM Studio](https://lmstudio.ai/) via `@lmstudio/sdk` |
| MQTT | `mqtt` package (pub/sub for device state and commands) |
| Database | `better-sqlite3` (WAL mode, saves persistence) |
| Validation | `zod` (LLM output schema validation) |
| TLS Proxy | `selfsigned` for auto-generated certs, `node:tls` for relay |
| DNS Override | [Technitium DNS Server](https://technitium.com/dns/) API |
| Desktop App | Electron + electron-builder |
| Config Format | YAML (`cync_mesh.yaml`), JSON (`rooms.json`) |

## Prerequisites

1. **MQTT broker** — e.g. [Mosquitto](https://mosquitto.org/) running locally
2. **[LM Studio](https://lmstudio.ai/)** — local LLM inference server with a model loaded
3. **Node.js** >= 18
4. **[Technitium DNS Server](https://technitium.com/dns/)** — for network-wide DNS override (required for proxy)

## Quick Start

```bash
npm install

# Configure environment
cp .env.example .env   # then fill in values (see CLAUDE.md for details)

# Export device config from Cync Cloud (one-time setup)
npx tsx scripts/export-cync.ts

# Generate room config from device data
npx tsx scripts/scan-rooms.ts

# Start the server
npm run dev
```

## Build & Run

```bash
npm run dev          # development with auto-reload (tsx watch)
npm run build        # compile TypeScript to dist/
npm start            # production (node dist/index.js)

# Type check only
npx tsc --noEmit
```

### Electron Desktop App

```bash
npm run app:dev      # build and launch Electron app
npm run app:build    # compile app TypeScript
npm run app:start    # launch pre-built app
cd app && npm run release   # build portable .exe
```

## Testing

The test suite validates that natural language voice commands are parsed into the correct structured command types by the live LLM.

```bash
npm run test:llm                    # run full suite (100+ test cases)
npx tsx --test --test-name-pattern="power" tests/llm.test.ts   # filter by pattern
```

LM Studio must be running with the configured model loaded for tests to pass.

## Claude Code Skills

This project includes [Claude Code](https://claude.com/claude-code) slash command skills for managing the system:

| Skill | Command | Description |
|---|---|---|
| **Export Cync** | `/export-cync` | Authenticate with the Cync Cloud API (email + password + OTP) and export device config to `cync_mesh.yaml` |
| **Scan Rooms** | `/scan-rooms [flags]` | Parse `cync_mesh.yaml` to discover devices and generate/update `src/data/rooms.json`. Supports `--auto`, `--list`, `--merge` flags and interactive room grouping |
| **DNS** | `/dns <enable\|disable\|status>` | Manage Technitium DNS override zones that redirect Cync cloud domains to the local proxy network-wide |
| **Test LLM** | `/test-llm [--filter pattern]` | Run the LLM command parsing test suite against the live LM Studio model |

### Typical Setup Flow

```
/export-cync          # pull device config from Cync Cloud
/scan-rooms           # generate room mappings from device data
/dns enable           # redirect Cync cloud traffic to local proxy
/test-llm             # verify LLM parses commands correctly
```

## API Endpoints

All routes except `/health` require `Authorization: Bearer <API_KEY>`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/command` | Voice command endpoint — `{"text": "..."}` |
| `GET` | `/status` | Current device states from MQTT cache + proxy info |
| `GET` | `/devices` | Room-to-device mapping |
| `GET` | `/saves` | List saved presets |
| `POST` | `/dns/enable` | Enable DNS override |
| `POST` | `/dns/disable` | Disable DNS override |
| `GET` | `/dns/status` | Check DNS override status |
| `GET` | `/health` | Health check (no auth) |

## License

MIT
