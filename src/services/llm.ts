import { LMStudioClient } from "@lmstudio/sdk";
import { config } from "../config.js";

let client: LMStudioClient | null = null;

export async function initLLM(): Promise<void> {
  client = new LMStudioClient();
  console.log("[llm] LM Studio SDK client initialized");
}

export function getClient(): LMStudioClient {
  if (!client) {
    throw new Error("LLM client not initialized. Call initLLM() first.");
  }
  return client;
}

const REASONING_MODEL_PATTERNS = [
  /deepseek.*r1/i,
  /reasoning/i,
  /qwen3/i,
];

export function isReasoningModel(modelId: string): boolean {
  return REASONING_MODEL_PATTERNS.some((p) => p.test(modelId));
}

export function extractJSON(raw: string): string {
  // Strip reasoning model thinking tags (e.g. DeepSeek R1's <think>...</think>)
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // If there's still non-JSON wrapping, extract the first JSON object
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return cleaned;
}

export function llmOptions(modelId: string): { temperature: number; maxTokens: number; structured?: { type: "json" } } {
  const reasoning = isReasoningModel(modelId);
  return {
    temperature: 0.1,
    maxTokens: reasoning ? 8192 : 512,
    ...(reasoning ? {} : { structured: { type: "json" as const } }),
  };
}

export async function callLLM(
  model: Awaited<ReturnType<LMStudioClient["llm"]["model"]>>,
  modelId: string,
  systemPrompt: string,
  userMessage: string
): Promise<unknown> {
  const result = await model.respond(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    llmOptions(modelId),
  );

  const content = result.content;
  if (!content) {
    throw new Error("LLM returned empty response");
  }

  const json = extractJSON(content);
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`LLM returned non-JSON: ${content.slice(0, 200)}`);
  }
}

export async function callLLMWithCorrection(
  model: Awaited<ReturnType<LMStudioClient["llm"]["model"]>>,
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  previousResponse: string,
  correctionMessage: string
): Promise<unknown> {
  const result = await model.respond(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
      { role: "assistant", content: previousResponse },
      { role: "user", content: correctionMessage },
    ],
    llmOptions(modelId),
  );

  const content = result.content;
  if (!content) {
    throw new Error("LLM returned empty response on retry");
  }

  const json = extractJSON(content);
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`LLM returned non-JSON on retry: ${content.slice(0, 200)}`);
  }
}

// Re-export parseCommand from the pipeline for backwards compatibility
export { parseCommand } from "./parsing/pipeline.js";
