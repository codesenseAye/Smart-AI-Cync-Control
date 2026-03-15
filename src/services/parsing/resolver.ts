import { config } from "../../config.js";
import { FACTORY_EFFECTS, type ParsedCommand } from "../../types/index.js";
import type { LLMIntentResult, ExpressionResult, RefinementContext } from "../../types/parsing.js";

// --- Animation Pattern Map ---

const PATTERN_MAP: Record<string, { duration_ms: number; transition: "instant" | "fade" }> = {
  slow_flash: { duration_ms: 2000, transition: "instant" },
  fast_flash: { duration_ms: 300, transition: "instant" },
  flash:      { duration_ms: 500, transition: "instant" },
  pulse:      { duration_ms: 1000, transition: "fade" },
};

// --- Palette Snapping ---
// The expression LLM is told to output exact palette RGB values but doesn't always comply.
// This code-level fix snaps any non-palette RGB to the nearest palette entry.

const PALETTE: { r: number; g: number; b: number }[] = [
  { r: 255, g: 0,   b: 0   },  // red
  { r: 0,   g: 0,   b: 255 },  // blue
  { r: 0,   g: 255, b: 0   },  // green
  { r: 128, g: 0,   b: 255 },  // purple
  { r: 255, g: 165, b: 0   },  // orange
  { r: 255, g: 105, b: 180 },  // pink
  { r: 0,   g: 128, b: 128 },  // teal
  { r: 255, g: 255, b: 0   },  // yellow
];

function snapToPalette(rgb: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
  // If already a palette value, return as-is
  if (PALETTE.some((p) => p.r === rgb.r && p.g === rgb.g && p.b === rgb.b)) return rgb;

  let best = PALETTE[0];
  let bestDist = Infinity;
  for (const p of PALETTE) {
    const dist = (rgb.r - p.r) ** 2 + (rgb.g - p.g) ** 2 + (rgb.b - p.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return { ...best };
}

// --- Room Resolution ---

function resolveRoom(roomMention: string | null): string {
  if (!roomMention) return "all";

  const mention = roomMention.toLowerCase().trim();
  if (mention === "everything" || mention === "all") return "all";

  // Exact room name match
  if (config.rooms.rooms[mention]) return mention;

  // Alias match
  for (const [name, room] of Object.entries(config.rooms.rooms)) {
    if (room.aliases.some((a) => a.toLowerCase() === mention)) return name;
  }

  // Fuzzy substring match
  for (const [name, room] of Object.entries(config.rooms.rooms)) {
    if (name.includes(mention) || mention.includes(name)) return name;
    if (room.aliases.some((a) => a.includes(mention) || mention.includes(a))) return name;
  }

  return "all";
}

// --- Device Resolution ---

function resolveDevices(deviceMention: string | null): { room: string; device_ids: number[] } | null {
  if (!deviceMention) return null;

  const mention = deviceMention.toLowerCase().trim();

  // Normalize plural/singular: "lights" -> "light", "lamps" -> "lamp"
  const mentionNorm = mention.replace(/s\b/g, "");

  for (const [roomName, room] of Object.entries(config.rooms.rooms)) {
    const matchedIds: number[] = [];
    for (const [id, dev] of Object.entries(room.devices)) {
      const devLower = dev.name.toLowerCase();
      const devNorm = devLower.replace(/s\b/g, "");
      // Direct substring match
      if (devLower.includes(mention) || mention.includes(devLower)) {
        matchedIds.push(parseInt(id, 10));
        continue;
      }
      // Normalized substring match (e.g. "ceiling lights" matches "ceiling light i")
      if (devNorm.includes(mentionNorm) || mentionNorm.includes(devNorm)) {
        matchedIds.push(parseInt(id, 10));
        continue;
      }
    }
    // Also try matching individual words
    if (matchedIds.length === 0) {
      const mentionWords = mentionNorm.split(/\s+/);
      for (const [id, dev] of Object.entries(room.devices)) {
        const devNorm = dev.name.toLowerCase().replace(/s\b/g, "");
        if (mentionWords.every((w) => devNorm.includes(w))) {
          matchedIds.push(parseInt(id, 10));
        }
      }
    }
    if (matchedIds.length > 0) {
      return { room: roomName, device_ids: matchedIds };
    }
  }

  return null;
}

// --- Schedule Time Parsing ---

function parseTime(timeMention: string): string {
  const lower = timeMention.toLowerCase().trim();
  if (lower === "midnight") return "00:00";
  if (lower === "noon" || lower === "midday") return "12:00";

  const match = timeMention.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return "00:00";

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3]?.toLowerCase();

  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

// --- Room Fallback from Raw Text ---

function resolveRoomFromText(rawText: string): string {
  const lower = rawText.toLowerCase();
  for (const [name, room] of Object.entries(config.rooms.rooms)) {
    if (lower.includes(name)) return name;
    for (const alias of room.aliases) {
      if (lower.includes(alias.toLowerCase())) return name;
    }
  }
  return "all";
}

// --- Save/Recall Name Fallback from Raw Text ---

const SAVE_NOISE = new Set(["save", "as", "this", "it", "the", "my", "current", "lights"]);
const RECALL_NOISE = new Set(["recall", "load", "restore", "set", "to", "it", "the", "my"]);

function extractSaveName(rawText: string): string | null {
  const words = rawText.toLowerCase().trim().split(/\s+/).filter((w) => !SAVE_NOISE.has(w));
  // Remove room names/aliases
  const filtered = words.filter((w) => {
    if (config.rooms.rooms[w]) return false;
    for (const room of Object.values(config.rooms.rooms)) {
      if (room.aliases.some((a) => a.toLowerCase() === w)) return false;
    }
    return true;
  });
  return filtered.length > 0 ? filtered.join(" ") : null;
}

function extractRecallName(rawText: string): string | null {
  const words = rawText.toLowerCase().trim().split(/\s+/).filter((w) => !RECALL_NOISE.has(w));
  return words.length > 0 ? words.join(" ") : null;
}

// --- Main Resolver ---

export function resolveCommand(
  intent: LLMIntentResult,
  rawText: string = "",
  expression?: ExpressionResult,
): ParsedCommand | { needsRefinement: true; context: RefinementContext } {
  // Resolve room and devices
  const deviceResult = resolveDevices(intent.device_mention);
  let room = deviceResult?.room ?? resolveRoom(intent.room_mention);

  // If LLM missed the room, try extracting from raw text
  if (room === "all" && intent.room_mention === null && rawText) {
    room = resolveRoomFromText(rawText);
  }

  const device_ids = deviceResult?.device_ids;

  // Derive flags from expression results
  const hasAnimation = expression?.animation_pattern !== undefined;
  const hasColorOrBrightness =
    expression?.rgb !== undefined ||
    expression?.brightness !== undefined ||
    expression?.color_temp_kelvin !== undefined;
  const hasEffect = expression?.effect_name !== undefined;

  // Minimal reclassification — trust intent, only apply safety nets
  let type = intent.intent;

  // Safety net: expression found animation but intent didn't classify as complex/schedule
  if (hasAnimation && type !== "schedule" && type !== "complex") {
    type = "complex";
  }
  // Safety net: intent says "effect" but no factory effect found
  if (type === "effect" && !hasEffect) {
    type = hasAnimation ? "complex" : hasColorOrBrightness ? "simple" : "complex";
  }
  // Safety net: intent says "complex" but it's actually a factory effect
  if (type === "complex" && hasEffect && !hasAnimation) {
    type = "effect";
  }

  switch (type) {
    case "power": {
      return {
        type: "power",
        room,
        state: intent.power_state === "off" ? "OFF" : "ON",
        ...(device_ids && { device_ids }),
      };
    }

    case "simple": {
      return {
        type: "simple",
        room,
        ...(expression?.brightness !== undefined && { brightness: expression.brightness }),
        ...(expression?.color_temp_kelvin !== undefined && { color_temp_kelvin: expression.color_temp_kelvin }),
        ...(expression?.rgb !== undefined && { rgb: snapToPalette(expression.rgb) }),
        ...(device_ids && { device_ids }),
      };
    }

    case "effect": {
      const effectName = expression?.effect_name ?? "rainbow";
      return {
        type: "effect",
        room,
        effect: effectName,
        ...(device_ids && { device_ids }),
      };
    }

    case "complex": {
      const rgb = expression?.rgb ? snapToPalette(expression.rgb) : { r: 255, g: 255, b: 255 };
      const pattern = expression?.animation_pattern;

      if (pattern) {
        const timing = PATTERN_MAP[pattern];
        const step_on = { rgb, brightness: 100, duration_ms: timing.duration_ms };
        const step_off = timing.transition === "fade"
          ? { rgb, brightness: 0, duration_ms: timing.duration_ms }
          : { rgb: { r: 0, g: 0, b: 0 }, brightness: 0, duration_ms: timing.duration_ms };

        return {
          type: "complex",
          room,
          sequence: [step_on, step_off],
          repeat: true,
          transition_style: timing.transition,
          ...(device_ids && { device_ids }),
        };
      }

      // Needs LLM refinement for complex descriptions
      return {
        needsRefinement: true,
        context: { type: "complex", room, device_ids, raw_description: intent.raw_description ?? rawText },
      };
    }

    case "save": {
      return {
        type: "save",
        name: intent.save_name ?? extractSaveName(rawText) ?? "unnamed",
        room,
        ...(device_ids && { device_ids }),
      };
    }

    case "recall": {
      return {
        type: "recall",
        name: intent.save_name ?? extractRecallName(rawText) ?? "unnamed",
      };
    }

    case "schedule": {
      const time = intent.time_mention ? parseTime(intent.time_mention) : "00:00";
      const days = intent.days_mention ?? "daily";
      const name = intent.save_name ?? `schedule_${time.replace(":", "")}`;

      // Build inner command from expression results
      let innerCommand: ParsedCommand;

      if (hasEffect && expression?.effect_name) {
        innerCommand = { type: "effect", room, effect: expression.effect_name };
      } else if (hasColorOrBrightness) {
        innerCommand = {
          type: "simple",
          room,
          ...(expression?.brightness !== undefined && { brightness: expression.brightness }),
          ...(expression?.color_temp_kelvin !== undefined && { color_temp_kelvin: expression.color_temp_kelvin }),
          ...(expression?.rgb !== undefined && { rgb: snapToPalette(expression.rgb) }),
        };
      } else {
        innerCommand = {
          type: "power",
          room,
          state: intent.power_state === "on" ? "ON" : "OFF",
        };
      }

      return {
        type: "schedule",
        name,
        room,
        time,
        days,
        state: innerCommand as any,
        ...(device_ids && { device_ids }),
      };
    }

    default:
      throw new Error(`Unknown intent type: ${type}`);
  }
}
