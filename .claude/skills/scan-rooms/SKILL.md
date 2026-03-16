---
name: scan-rooms
description: Scan cync_mesh.yaml to discover devices and generate or update the rooms.json config
argument-hint: [path-to-cync_mesh.yaml] [--auto] [--list] [--merge]
disable-model-invocation: true
---

Generate or update `src/data/rooms.json` by scanning a `cync_mesh.yaml` config file.

Run the scan-rooms script: `npx tsx scripts/scan-rooms.ts $ARGUMENTS`

This script:
1. Finds and parses cync_mesh.yaml (searches the project root by default, or accepts a path argument)
2. Extracts the home ID and all devices with their names, IDs, capabilities, and enabled status
3. Auto-groups enabled devices into rooms by parsing device name prefixes (e.g. "Living Room Plug" -> "living room")
4. Shows the proposed grouping and enters interactive mode for adjustments
5. Writes the final config to `src/data/rooms.json`

## Flags

| Flag | Effect |
|------|--------|
| `--auto` | Skip interactive prompts, write auto-grouped result directly |
| `--list` | Just print the device table, don't write anything |
| `--merge` | Merge new devices into existing rooms.json instead of overwriting (preserves aliases and rooms not in the YAML) |

## Interactive Commands

When running without `--auto`, the user can adjust groupings:

- `rename <room> <new_name>` — Rename a room
- `merge <room1> <room2>` — Merge room1 into room2
- `move <device_id> <room>` — Move a device to a different room
- `remove <device_id>` — Remove a device from all rooms
- `add <device_id> <room>` — Add a device to a room
- `alias <room> <alias>` — Add an alias for a room
- `done` — Accept and write rooms.json
- `quit` — Exit without writing

## Examples

```bash
# Interactive scan from default location
npx tsx scripts/scan-rooms.ts

# Auto-generate from specific file
npx tsx scripts/scan-rooms.ts /path/to/cync_mesh.yaml --auto

# Just list devices
npx tsx scripts/scan-rooms.ts --list

# Add newly discovered devices without overwriting existing room config
npx tsx scripts/scan-rooms.ts --merge
```

## After Running

After the script writes `src/data/rooms.json`, restart the server (`npm run dev`) to pick up the new room config. The LLM system prompt dynamically loads room names and aliases from this file.
