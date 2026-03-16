import { z } from "zod";

// --- Device State (from MQTT status messages) ---

export interface DeviceState {
  state: "ON" | "OFF";
  brightness?: number;
  color_mode?: "color_temp" | "rgb";
  color_temp?: number;
  color?: { r: number; g: number; b: number };
}

// --- Room Config (rooms.json) ---

export interface DeviceInfo {
  name: string;
  supports_rgb: boolean;
  supports_temperature: boolean;
}

export interface RoomConfig {
  devices: Record<string, DeviceInfo>;
  aliases: string[];
}

export interface RoomsConfig {
  home_id: string;
  rooms: Record<string, RoomConfig>;
}

// --- Effect Step (for complex sequences) ---

export interface EffectStep {
  rgb?: { r: number; g: number; b: number };
  brightness?: number;
  color_temp_kelvin?: number;
  duration_ms: number;
}

// --- Parsed Command (discriminated union from LLM) ---

export type ParsedCommand =
  | RecallCommand
  | PowerCommand
  | SimpleCommand
  | EffectCommand
  | ComplexCommand;

export interface RecallCommand {
  type: "recall";
  name: string;
}

export interface PowerCommand {
  type: "power";
  room: string;
  state: "ON" | "OFF";
  device_ids?: number[];
}

export interface SimpleCommand {
  type: "simple";
  room: string;
  brightness?: number;
  color_temp_kelvin?: number;
  rgb?: { r: number; g: number; b: number };
  device_ids?: number[];
}

export interface EffectCommand {
  type: "effect";
  room: string;
  effect: string;
  device_ids?: number[];
}

export interface ComplexCommand {
  type: "complex";
  room: string;
  sequence: EffectStep[];
  repeat: boolean;
  transition_style: "instant" | "fade";
  device_ids?: number[];
}

// --- Zod Schemas for LLM output validation ---

const rgbSchema = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
});

const effectStepSchema = z.object({
  rgb: rgbSchema.optional(),
  brightness: z.number().min(0).max(100).optional(),
  color_temp_kelvin: z.number().min(2000).max(7000).optional(),
  duration_ms: z.number().min(100).max(60000),
});

const deviceIdsSchema = z.array(z.number().int().positive()).optional().nullable().transform((v) => v ?? undefined);

const recallSchema = z.object({
  type: z.literal("recall"),
  name: z.string().min(1).max(50),
});

const powerSchema = z.object({
  type: z.literal("power"),
  room: z.string().min(1),
  state: z.enum(["ON", "OFF"]),
  device_ids: deviceIdsSchema,
});

const simpleSchema = z.object({
  type: z.literal("simple"),
  room: z.string().min(1),
  brightness: z.number().min(0).max(100).optional().nullable().transform((v) => v ?? undefined),
  color_temp_kelvin: z.number().min(2000).max(7000).optional().nullable().transform((v) => v ?? undefined),
  rgb: rgbSchema.optional().nullable().transform((v) => v ?? undefined),
  device_ids: deviceIdsSchema,
});

const effectSchema = z.object({
  type: z.literal("effect"),
  room: z.string().min(1),
  effect: z.string().min(1),
  device_ids: deviceIdsSchema,
});

const complexSchema = z.object({
  type: z.literal("complex"),
  room: z.string().min(1),
  sequence: z.array(effectStepSchema).min(1).max(50),
  repeat: z.boolean(),
  transition_style: z.enum(["instant", "fade"]),
  device_ids: deviceIdsSchema,
});

export const parsedCommandSchema = z.discriminatedUnion("type", [
  recallSchema,
  powerSchema,
  simpleSchema,
  effectSchema,
  complexSchema,
]);

// --- Saved State (DB) ---

export interface SavedDeviceState {
  device_id: string;
  state: "ON" | "OFF";
  brightness?: number;
  color_mode?: string;
  color_temp?: number;
  r?: number;
  g?: number;
  b?: number;
}

export interface SavedState {
  name: string;
  room: string;
  states: SavedDeviceState[];
  created_at: string;
}

// --- Factory Effects ---

export const FACTORY_EFFECTS = [
  "candle",
  "cyber",
  "rainbow",
  "fireworks",
  "volcanic",
  "aurora",
  "happy_holidays",
  "red_white_blue",
  "vegas",
  "party_time",
] as const;

export type FactoryEffect = (typeof FACTORY_EFFECTS)[number];
