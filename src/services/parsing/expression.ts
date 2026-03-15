import { config } from "../../config.js";
import { FACTORY_EFFECTS } from "../../types/index.js";
import { expressionResultSchema, type ExpressionResult } from "../../types/parsing.js";
import { getClient, callLLM, callLLMWithCorrection } from "../llm.js";

const EXPRESSION_PROMPT = `You extract smart light parameters from voice commands. Return ONLY a JSON object.

Color palette — you MUST output one of these EXACT RGB values when a color is identified (do NOT invent custom values):
red=(255,0,0), blue=(0,0,255), green=(0,255,0), purple=(128,0,255), orange=(255,165,0), pink=(255,105,180), teal=(0,128,128), yellow=(255,255,0)

Return: {"rgb":<{"r":N,"g":N,"b":N} or null>,"brightness":<0-100 or null>,"color_temp_kelvin":<2000-7000 or null>,"animation_pattern":<"slow_flash"|"fast_flash"|"flash"|"pulse" or null>,"effect_name":<string or null>}

Rules:
- "rgb": If any color is described or implied, choose the NEAREST palette color and output its EXACT RGB values. Use your own knowledge of color names and associations — you must decide which of the 8 palette entries is closest. NEVER output RGB values other than the 8 listed above. null if no color is mentioned.
- "brightness": System scale 0-100 where dim≈25, half≈50, bright≈100. Interpret descriptions, moods, and contexts to determine the appropriate level. Complaints about current state mean the user wants the OPPOSITE (e.g. "too bright" → user wants lower brightness). null if no brightness is mentioned or implied.
- "color_temp_kelvin": Warm light ≈ 2700K, cool/blue-white light ≈ 5500K, daylight ≈ 6500K. Interpret moods and contexts. Complaints mean the user wants the OPPOSITE. null if not implied. NEVER set BOTH rgb AND color_temp_kelvin.
- "animation_pattern": Only for repeating light patterns — "slow_flash" (slow blink), "fast_flash" (rapid/strobe), "flash" (normal blink), "pulse" (smooth fade in/out). Interpret animation-related words using your own knowledge. null unless animation is clearly described.
- "effect_name": Factory effect if mentioned: ${FACTORY_EFFECTS.join(", ")}. Use underscores for multi-word names. null if none.

CRITICAL: Only extract what is actually mentioned or clearly implied. If no light parameters are present, return ALL null values.

Examples:
"warm" → {"rgb":null,"brightness":null,"color_temp_kelvin":2700,"animation_pattern":null,"effect_name":null}
"dim" → {"rgb":null,"brightness":25,"color_temp_kelvin":null,"animation_pattern":null,"effect_name":null}
"red" → {"rgb":{"r":255,"g":0,"b":0},"brightness":null,"color_temp_kelvin":null,"animation_pattern":null,"effect_name":null}
"bright cool" → {"rgb":null,"brightness":100,"color_temp_kelvin":5500,"animation_pattern":null,"effect_name":null}
"red pulse" → {"rgb":{"r":255,"g":0,"b":0},"brightness":null,"color_temp_kelvin":null,"animation_pattern":"pulse","effect_name":null}
"rainbow" → {"rgb":null,"brightness":null,"color_temp_kelvin":null,"animation_pattern":null,"effect_name":"rainbow"}`;

export async function extractExpression(text: string): Promise<ExpressionResult> {
  const client = getClient();
  const modelId = config.llm.expressionModel;
  const model = await client.llm.model(modelId);

  const response = await callLLM(model, modelId, EXPRESSION_PROMPT, text);
  const parsed = expressionResultSchema.safeParse(response);

  if (parsed.success) {
    return parsed.data;
  }

  console.warn("[expression] First parse failed, retrying:", parsed.error.issues);

  const correctionMsg = `That JSON was invalid. Issues: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Fix and return only valid JSON.`;

  const retryResponse = await callLLMWithCorrection(
    model,
    modelId,
    EXPRESSION_PROMPT,
    text,
    JSON.stringify(response),
    correctionMsg
  );
  const retryParsed = expressionResultSchema.safeParse(retryResponse);

  if (retryParsed.success) {
    return retryParsed.data;
  }

  throw new Error(
    `Expression extraction failed after retry: ${retryParsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
  );
}
