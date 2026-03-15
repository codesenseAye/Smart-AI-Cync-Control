# Smart AI Cync Control

Voice-controlled smart light system that uses a local LLM to parse natural language commands and control Cync/GE smart lights over MQTT — no cloud required.

Say things like *"bedroom warm and dim"*, *"make it cozy"*, *"rainbow"*, or *"kill the lights at midnight every night"* and the system figures out what you mean.

## How It Works

```
Voice / Text  -->  POST /command {"text": "kitchen warm dim"}
                          |
                      Local LLM (LM Studio)  -->  Structured JSON command
                          |
                      Executor  -->  MQTT publish
                          |
                      cync-lan  -->  Cync devices on LAN
```

A TypeScript Express server receives natural language text, sends it to a local LLM running in LM Studio, validates the structured output with Zod, and dispatches MQTT messages to [cync-lan](https://github.com/baudneo/cync-lan) which controls the physical lights.

## Features

- **Natural language parsing** — understands colors, moods, brightness levels, room names, and device names via local LLM inference
- **7 command types** — power, color/brightness, factory effects, complex animations, save/recall presets, scheduled commands
- **100+ recognized phrases** — from explicit (*"bedroom red"*) to interpretive (*"make it cozy"*, *"bedtime"*, *"date night"*)
- **Factory effects** — candle, cyber, rainbow, fireworks, volcanic, aurora, and more
- **Custom animations** — flash, pulse, strobe, breathing patterns with configurable timing
- **Save/recall presets** — snapshot current light states and recall them by name
- **Scheduling** — cron-based scheduled commands (*"dim at 9pm nightly"*)
- **DNS override** — network-wide redirect of Cync cloud domains to cync-lan via Technitium DNS Server
- **Electron desktop app** — manages all services (cync-lan, LM Studio, MQTT broker, wrapper server) from a single UI

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js (>= 18) |
| Language | TypeScript (ES2022, ESM) |
| HTTP Server | Express.js |
| LLM Inference | [LM Studio](https://lmstudio.ai/) via `@lmstudio/sdk` |
| MQTT | `mqtt` package (pub/sub to cync-lan) |
| Database | `better-sqlite3` (WAL mode, saves + schedules) |
| Scheduling | `node-cron` |
| Validation | `zod` (LLM output schema validation) |
| DNS Override | [Technitium DNS Server](https://technitium.com/dns/) API |
| Desktop App | Electron + electron-builder |
| Config Format | YAML (`cync_mesh.yaml`), JSON (`rooms.json`) |

## Prerequisites

1. **[cync-lan](https://github.com/baudneo/cync-lan)** — bridges Cync devices to MQTT (runs as Docker container or standalone)
2. **MQTT broker** — e.g. Mosquitto on Home Assistant
3. **[LM Studio](https://lmstudio.ai/)** — local LLM inference server with a model loaded
4. **Node.js** >= 18
5. **Docker Desktop** — for running cync-lan as a container (optional, can run standalone)
6. **[Technitium DNS Server](https://technitium.com/dns/)** — for network-wide DNS override (optional)

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

Tests cover all 7 command types across 100+ cases including:
- Explicit commands (*"bedroom red"*, *"kitchen off"*)
- Interpretive phrasing (*"make it cozy"*, *"kill the lights"*, *"bedtime"*)
- Novel color names (*"burgundy"*, *"cerulean"*, *"emerald"*)
- Mood descriptions (*"date night"*, *"study mode"*, *"spa vibes"*)
- Device-specific targeting (*"left lamp red"*, *"ceiling lights on"*)

LM Studio must be running with the configured model loaded for tests to pass.

## Claude Code Skills

This project includes [Claude Code](https://claude.com/claude-code) slash command skills for managing the system:

| Skill | Command | Description |
|---|---|---|
| **Export Cync** | `/export-cync` | Authenticate with the Cync Cloud API (email + password + OTP) and export device config to `cync-lan/cync_mesh.yaml` |
| **Scan Rooms** | `/scan-rooms [flags]` | Parse `cync_mesh.yaml` to discover devices and generate/update `src/data/rooms.json`. Supports `--auto`, `--list`, `--merge` flags and interactive room grouping |
| **cync-lan** | `/cync-lan [action]` | Start, stop, restart, or check status/logs of the cync-lan Docker container. Reads MQTT settings from `.env` automatically |
| **DNS** | `/dns <enable\|disable\|status>` | Manage Technitium DNS override zones that redirect Cync cloud domains to the local cync-lan server network-wide |
| **Test LLM** | `/test-llm [--filter pattern]` | Run the LLM command parsing test suite against the live LM Studio model. Supports filtering by test name pattern |

### Typical Setup Flow

```
/export-cync          # pull device config from Cync Cloud
/scan-rooms           # generate room mappings from device data
/cync-lan start       # start the cync-lan Docker container
/dns enable           # redirect Cync cloud traffic to local server
/test-llm             # verify LLM parses commands correctly
```

## API Endpoints

All routes except `/health` require `Authorization: Bearer <API_KEY>`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/command` | Voice command endpoint — `{"text": "..."}` |
| `GET` | `/status` | Current device states from MQTT cache |
| `GET` | `/devices` | Room-to-device mapping |
| `GET` | `/saves` | List saved presets |
| `GET` | `/schedules` | List scheduled commands |
| `POST` | `/dns/enable` | Enable DNS override |
| `POST` | `/dns/disable` | Disable DNS override |
| `GET` | `/dns/status` | Check DNS override status |
| `GET` | `/health` | Health check (no auth) |

## License

MIT
