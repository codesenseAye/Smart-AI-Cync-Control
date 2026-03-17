import { config } from "../../config.js";
import { FACTORY_EFFECTS } from "../../types/index.js";
import { intentResultSchema, type LLMIntentResult } from "../../types/parsing.js";
import { getClient, callLLM, callLLMWithCorrection } from "../llm.js";

function buildIntentPrompt(): string {
  // Build a compact room + device list (names only, no IDs or capabilities)
  const roomLines: string[] = [];
  for (const [name, room] of Object.entries(config.rooms.rooms)) {
    const aliasStr = room.aliases.length > 0 ? ` (aliases: ${room.aliases.join(", ")})` : "";
    const deviceNames = Object.values(room.devices).map((d) => d.name).join(", ");
    roomLines.push(`- "${name}"${aliasStr}: ${deviceNames}`);
  }

  return `You classify voice commands for smart lights. Return ONLY a JSON object, no explanation.

Rooms: ${roomLines.join("; ")}
Factory effects: ${FACTORY_EFFECTS.join(", ")}

Return: {"intent":"<type>","room_mention":<string or null>,"device_mention":<string or null>,"power_state":<"on"|"off"|null>,"raw_description":<string or null>}

Intent types:
- "power": user wants to switch lights on or off, nothing else
- "simple": any description of light quality — color, brightness, temperature, mood, atmosphere, or complaint about current lighting (e.g. "too bright", "I can't see", "too harsh")
- "effect": user mentions one of the factory effect names listed above. EVERY factory effect name MUST be classified as "effect" — including "cyber", "candle", "volcanic", etc.
- "complex": describes a repeating animation, light pattern, or rhythmic effect (e.g. "flash", "pulse", "heartbeat", "strobe", "breathing", "twinkle")

Classification guidance:
- If the primary intent is switching lights on/off (even with slang or metaphor), that's "power"
- If describing any visual quality of light — color, brightness, warmth, mood, atmosphere — that's "simple"
- If the command implies both on/off AND a visual quality (e.g. brightness level, mood, atmosphere), that's "simple" — visual description takes priority over power
- If describing a repeating animation or light pattern, that's "complex"
- "lights out" / "lights off" = power off, NOT simple
- Complaints about current lighting ("too bright", "too harsh", "can't see anything") are ALWAYS "simple" — the user wants a brightness/temperature adjustment, not power
- Words implying rhythmic/repeating motion (heartbeat, pulse, flash, strobe, twinkle, breathing) are ALWAYS "complex"
- If the input exactly matches a factory effect name, it is ALWAYS "effect" — never "simple" or "complex"

Fields:
- "room_mention": exact room/alias text from user, or null. "everything"/"all" = null.
- "device_mention": specific device name if mentioned (e.g. "left lamp", "ceiling lights"), or null.
- "power_state": "on" or "off" if discernible, null otherwise.
- "raw_description": for complex commands, the full animation description (e.g. "red slow flash"), or null.

Examples:
"off" → {"intent":"power","room_mention":null,"device_mention":null,"power_state":"off","raw_description":null}
"bedroom warm dim" → {"intent":"simple","room_mention":"bedroom","device_mention":null,"power_state":null,"raw_description":null}
"left lamp red" → {"intent":"simple","room_mention":null,"device_mention":"left lamp","power_state":null,"raw_description":null}
"rainbow" → {"intent":"effect","room_mention":null,"device_mention":null,"power_state":null,"raw_description":null}
"red slow flash" → {"intent":"complex","room_mention":null,"device_mention":null,"power_state":null,"raw_description":"red slow flash"}`;
}

export async function classifyIntent(text: string): Promise<LLMIntentResult> {
  const client = getClient();
  const modelId = config.llm.intentModel;
  const model = await client.llm.model(modelId);
  const prompt = buildIntentPrompt();

  const response = await callLLM(model, modelId, prompt, text);
  const parsed = intentResultSchema.safeParse(response);

  if (parsed.success) {
    return parsed.data;
  }

  console.warn("[intent] First parse failed, retrying:", parsed.error.issues);

  const correctionMsg = `That JSON was invalid. Issues: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Fix and return only valid JSON.`;

  const retryResponse = await callLLMWithCorrection(
    model,
    modelId,
    prompt,
    text,
    JSON.stringify(response),
    correctionMsg
  );
  const retryParsed = intentResultSchema.safeParse(retryResponse);

  if (retryParsed.success) {
    return retryParsed.data;
  }

  throw new Error(
    `Intent classification failed after retry: ${retryParsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
  );
}
