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

  // Word-level match (handles duplicated words, extra tokens, or invisible characters)
  const words = mention.split(/\s+/);
  for (const [name, room] of Object.entries(config.rooms.rooms)) {
    if (words.some((w) => w === name || room.aliases.some((a) => a === w))) return name;
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

  // Safety net: expression found animation but intent didn't classify as complex
  if (hasAnimation && type !== "complex") {
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
        ...(expression?.rgb !== undefined && { rgb: expression.rgb }),
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
      const rgb = expression?.rgb ? expression.rgb : { r: 255, g: 255, b: 255 };
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

    default:
      throw new Error(`Unknown intent type: ${type}`);
  }
}
