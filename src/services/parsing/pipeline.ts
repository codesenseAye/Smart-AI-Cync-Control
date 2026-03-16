import type { ParsedCommand } from "../../types/index.js";
import type { ExpressionResult } from "../../types/parsing.js";
import { classifyIntent } from "./intent.js";
import { extractExpression } from "./expression.js";
import { resolveCommand } from "./resolver.js";
import { refineComplex } from "./refiner.js";

export async function parseCommand(text: string): Promise<ParsedCommand> {
  // Layer 1 + Layer 1.5: Run intent and expression in parallel for speed
  const [intent, expressionResult] = await Promise.all([
    classifyIntent(text),
    extractExpression(text).catch((err) => {
      console.warn(`[pipeline] Expression extraction failed, continuing without:`, err);
      return undefined as ExpressionResult | undefined;
    }),
  ]);

  console.log(`[pipeline] Intent:`, JSON.stringify(intent));

  // Only use expression for intents that need parameter extraction
  // Power/recall don't need it — discard to prevent hallucination interference
  const expression = (intent.intent !== "power" && intent.intent !== "recall")
    ? expressionResult
    : undefined;

  console.log(`[pipeline] Expression:`, JSON.stringify(expression ?? null));

  // Layer 2: Deterministic resolution
  const result = resolveCommand(intent, text, expression);

  // Layer 3: Complex refinement (only if needed)
  if ("needsRefinement" in result) {
    console.log(`[pipeline] Refining complex command: "${result.context.raw_description}"`);
    return await refineComplex(result.context);
  }

  return result;
}
