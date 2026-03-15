import { config } from "../../config.js";
import type { ComplexCommand } from "../../types/index.js";
import type { RefinementContext } from "../../types/parsing.js";
import { getClient, callLLM, callLLMWithCorrection } from "../llm.js";
import { z } from "zod";

const sequenceSchema = z.object({
  sequence: z.array(z.object({
    rgb: z.object({
      r: z.number().int().min(0).max(255),
      g: z.number().int().min(0).max(255),
      b: z.number().int().min(0).max(255),
    }).optional(),
    brightness: z.number().min(0).max(100).optional(),
    duration_ms: z.number().min(100).max(60000),
  })).min(1).max(50),
  repeat: z.boolean(),
  transition_style: z.enum(["instant", "fade"]),
});

const REFINE_PROMPT = `You generate animation sequences for smart lights. Return ONLY a JSON object.

Given an animation description, produce:
{"sequence":[{"rgb":{"r":N,"g":N,"b":N},"brightness":N,"duration_ms":N},...], "repeat":true/false, "transition_style":"instant"|"fade"}

Timing rules:
- "slow flash" = 2000ms per step
- "fast flash" = 300ms per step
- "flash" = 500ms per step
- "pulse" = 1000ms fade
- "every N seconds" = N*1000ms per step
- Flashing = alternate between color and off, repeat: true, transition_style: "instant"
- Pulsing = alternate between color and off, repeat: true, transition_style: "fade"
- Transition = sequence of colors, repeat: false, transition_style: "fade"
- brightness is 0-100 scale, NOT 0-255`;

export async function refineComplex(ctx: RefinementContext): Promise<ComplexCommand> {
  const client = getClient();
  const modelId = config.llm.complexModel;
  const model = await client.llm.model(modelId);

  const response = await callLLM(model, modelId, REFINE_PROMPT, ctx.raw_description);
  const parsed = sequenceSchema.safeParse(response);

  if (parsed.success) {
    return {
      type: "complex",
      room: ctx.room,
      sequence: parsed.data.sequence.map((s) => ({
        ...(s.rgb && { rgb: s.rgb }),
        ...(s.brightness !== undefined && { brightness: s.brightness }),
        duration_ms: s.duration_ms,
      })),
      repeat: parsed.data.repeat,
      transition_style: parsed.data.transition_style,
      ...(ctx.device_ids && { device_ids: ctx.device_ids }),
    };
  }

  console.warn("[refiner] First parse failed, retrying:", parsed.error.issues);

  const correctionMsg = `Invalid JSON. Issues: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Fix and return only valid JSON.`;

  const retryResponse = await callLLMWithCorrection(
    model,
    modelId,
    REFINE_PROMPT,
    ctx.raw_description,
    JSON.stringify(response),
    correctionMsg
  );
  const retryParsed = sequenceSchema.safeParse(retryResponse);

  if (retryParsed.success) {
    return {
      type: "complex",
      room: ctx.room,
      sequence: retryParsed.data.sequence.map((s) => ({
        ...(s.rgb && { rgb: s.rgb }),
        ...(s.brightness !== undefined && { brightness: s.brightness }),
        duration_ms: s.duration_ms,
      })),
      repeat: retryParsed.data.repeat,
      transition_style: retryParsed.data.transition_style,
      ...(ctx.device_ids && { device_ids: ctx.device_ids }),
    };
  }

  throw new Error(
    `Complex refinement failed after retry: ${retryParsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
  );
}
