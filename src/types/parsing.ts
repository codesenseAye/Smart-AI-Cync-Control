import { z } from "zod";

// --- Layer 1: LLM Intent Classification ---

export interface LLMIntentResult {
  intent: "power" | "simple" | "effect" | "complex" | "recall";
  room_mention: string | null;
  device_mention: string | null;
  power_state: "on" | "off" | null;
  keywords: string[];
  save_name: string | null;
  raw_description: string | null;
}

// Transform empty strings / undefined to null for lenient parsing across models
const optStr = z.string().optional().nullable()
  .transform((v) => (v === undefined || v === "" || v === "null" || v === "??" ? null : v));

const optPowerState = z.union([z.enum(["on", "off"]), z.literal(""), z.null(), z.undefined()])
  .transform((v): "on" | "off" | null => (v === "on" || v === "off" ? v : null));

export const intentResultSchema = z.object({
  intent: z.enum(["power", "simple", "effect", "complex", "recall"]),
  room_mention: optStr,
  device_mention: optStr,
  power_state: optPowerState,
  keywords: z.array(z.string()).optional().default([]),
  save_name: optStr,
  raw_description: optStr,
});

// --- Layer 1.5: Expression Extraction ---

export interface ExpressionResult {
  rgb?: { r: number; g: number; b: number };
  brightness?: number;
  color_temp_kelvin?: number;
  animation_pattern?: "slow_flash" | "fast_flash" | "flash" | "pulse";
  effect_name?: string;
}

const optVal = <T>(v: T | null | undefined): T | undefined =>
  v === null || v === undefined ? undefined : v;

export const expressionResultSchema = z.object({
  rgb: z.object({
    r: z.number().int().min(0).max(255),
    g: z.number().int().min(0).max(255),
    b: z.number().int().min(0).max(255),
  }).nullable().optional().transform(optVal),
  brightness: z.number().min(0).max(100).nullable().optional().transform(optVal),
  color_temp_kelvin: z.number().min(2000).max(7000).nullable().optional().transform(optVal),
  animation_pattern: z.enum(["slow_flash", "fast_flash", "flash", "pulse"]).nullable().optional().transform(optVal),
  effect_name: z.string().nullable().optional().transform((v) =>
    v === null || v === undefined || v === "" || v === "null" || v === "none" || v === "N/A" ? undefined : v
  ),
});

// --- Layer 3: Complex Refinement Context ---

export interface RefinementContext {
  type: "complex";
  room: string;
  device_ids?: number[];
  raw_description: string;
}
