import { config } from "../../config.js";
import { FACTORY_EFFECTS } from "../../types/index.js";
import { intentResultSchema, type LLMIntentResult } from "../../types/parsing.js";
import { savesService } from "../saves.js";
import { getClient, callLLM, callLLMWithCorrection } from "../llm.js";

function buildIntentPrompt(): string {
  // Build a compact room + device list (names only, no IDs or capabilities)
  const roomLines: string[] = [];
  for (const [name, room] of Object.entries(config.rooms.rooms)) {
    const aliasStr = room.aliases.length > 0 ? ` (aliases: ${room.aliases.join(", ")})` : "";
    const deviceNames = Object.values(room.devices).map((d) => d.name).join(", ");
    roomLines.push(`- "${name}"${aliasStr}: ${deviceNames}`);
  }

  const saveNames = savesService.listNames();
  const saveList = saveNames.length > 0 ? saveNames.join(", ") : "(none)";

  return `You classify voice commands for smart lights. Return ONLY a JSON object, no explanation.

Rooms: ${roomLines.join("; ")}
Saved shortcuts: ${saveList}
Factory effects: ${FACTORY_EFFECTS.join(", ")}

Return: {"intent":"<type>","room_mention":<string or null>,"device_mention":<string or null>,"power_state":<"on"|"off"|null>,"save_name":<string or null>,"raw_description":<string or null>}

Intent types:
- "power": user wants to switch lights on or off, nothing else
- "simple": any description of light quality — color, brightness, temperature, mood, atmosphere, or complaint about current lighting
- "effect": user mentions one of the factory effect names listed above (candle, cyber, rainbow, etc.)
- "complex": describes a repeating animation or light pattern
- "recall": user wants to load/recall/restore a saved shortcut. Trigger words: "recall", "load", "restore". Also triggered if the input matches a known saved shortcut name exactly

Classification guidance:
- If the primary intent is switching lights on/off (even with slang or metaphor), that's "power"
- If describing any visual quality of light — color, brightness, warmth, mood, atmosphere — that's "simple"
- If the command implies both on/off AND a visual quality (e.g. brightness level, mood, atmosphere), that's "simple" — visual description takes priority over power
- If describing a repeating animation or light pattern, that's "complex"
- "lights out" / "lights off" = power off, NOT simple

Fields:
- "room_mention": exact room/alias text from user, or null. "everything"/"all" = null.
- "device_mention": specific device name if mentioned (e.g. "left lamp", "ceiling lights"), or null.
- "power_state": "on" or "off" if discernible, null otherwise.
- "save_name": shortcut name for recall commands, or null.
- "raw_description": for complex commands, the full animation description (e.g. "red slow flash"), or null.

Examples:
"off" → {"intent":"power","room_mention":null,"device_mention":null,"power_state":"off","save_name":null,"raw_description":null}
"bedroom warm dim" → {"intent":"simple","room_mention":"bedroom","device_mention":null,"power_state":null,"save_name":null,"raw_description":null}
"left lamp red" → {"intent":"simple","room_mention":null,"device_mention":"left lamp","power_state":null,"save_name":null,"raw_description":null}
"rainbow" → {"intent":"effect","room_mention":null,"device_mention":null,"power_state":null,"save_name":null,"raw_description":null}
"red slow flash" → {"intent":"complex","room_mention":null,"device_mention":null,"power_state":null,"save_name":null,"raw_description":"red slow flash"}
"chill" → {"intent":"recall","room_mention":null,"device_mention":null,"power_state":null,"save_name":"chill","raw_description":null}
"recall relax" → {"intent":"recall","room_mention":null,"device_mention":null,"power_state":null,"save_name":"relax","raw_description":null}
"load movie" → {"intent":"recall","room_mention":null,"device_mention":null,"power_state":null,"save_name":"movie","raw_description":null}`;
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
