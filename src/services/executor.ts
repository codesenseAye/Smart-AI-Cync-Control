import { config } from "../config.js";
import type {
  ParsedCommand,
  SavedDeviceState,
} from "../types/index.js";
import { mqttService } from "./mqtt.js";
import { savesService } from "./saves.js";
import { cancelDeviceEffects, runEffect } from "./effects.js";

export async function execute(command: ParsedCommand): Promise<{ ok: boolean; detail: string }> {
  switch (command.type) {
    case "power":
      return executePower(command.room, command.state, command.device_ids);

    case "simple":
      return executeSimple(
        command.room,
        command.brightness ?? undefined,
        command.color_temp_kelvin ?? undefined,
        command.rgb ?? undefined,
        command.device_ids
      );

    case "effect":
      return executeEffect(command.room, command.effect, command.device_ids);

    case "complex":
      return executeComplex(
        command.room,
        command.sequence,
        command.repeat,
        command.transition_style,
        command.device_ids
      );

    case "recall":
      return executeRecall(command.name);

    default:
      return { ok: false, detail: `Unknown command type: ${(command as ParsedCommand).type}` };
  }
}

function resolveDeviceIds(room: string, deviceIds?: number[]): string[] {
  const homeId = config.rooms.home_id;

  // If specific device_ids provided, use them directly
  if (deviceIds && deviceIds.length > 0) {
    return deviceIds.map((d) => `${homeId}-${d}`);
  }

  if (room === "all") {
    const ids: string[] = [];
    for (const r of Object.values(config.rooms.rooms)) {
      for (const devId of Object.keys(r.devices)) {
        ids.push(`${homeId}-${devId}`);
      }
    }
    return ids;
  }

  const roomLower = room.toLowerCase();
  for (const [name, roomCfg] of Object.entries(config.rooms.rooms)) {
    if (
      name.toLowerCase() === roomLower ||
      roomCfg.aliases.some((a) => a.toLowerCase() === roomLower)
    ) {
      return Object.keys(roomCfg.devices).map((d) => `${homeId}-${d}`);
    }
  }

  console.warn(`[executor] Unknown room "${room}", treating as "all"`);
  return resolveDeviceIds("all");
}

function executePower(room: string, state: "ON" | "OFF", deviceIds?: number[]): { ok: boolean; detail: string } {
  const resolved = resolveDeviceIds(room, deviceIds);
  cancelDeviceEffects(resolved);

  for (const id of resolved) {
    mqttService.publish(id, { state });
  }

  return { ok: true, detail: `Set ${resolved.length} devices in "${room}" to ${state}` };
}

function executeSimple(
  room: string,
  brightness?: number,
  colorTempKelvin?: number,
  rgb?: { r: number; g: number; b: number },
  deviceIds?: number[]
): { ok: boolean; detail: string } {
  const resolved = resolveDeviceIds(room, deviceIds);
  cancelDeviceEffects(resolved);

  const payload: Record<string, unknown> = { state: "ON" };

  if (brightness !== undefined) {
    payload.brightness = brightness;
  }

  if (rgb) {
    payload.color = rgb;
  } else if (colorTempKelvin !== undefined) {
    payload.color_temp = colorTempKelvin;
  }

  for (const id of resolved) {
    mqttService.publish(id, payload);
  }

  const parts = [];
  if (brightness !== undefined) parts.push(`brightness=${brightness}`);
  if (rgb) parts.push(`rgb=(${rgb.r},${rgb.g},${rgb.b})`);
  if (colorTempKelvin !== undefined) parts.push(`temp=${colorTempKelvin}K`);

  return {
    ok: true,
    detail: `Set ${resolved.length} devices in "${room}": ${parts.join(", ")}`,
  };
}

function executeEffect(room: string, effect: string, deviceIds?: number[]): { ok: boolean; detail: string } {
  const resolved = resolveDeviceIds(room, deviceIds);
  cancelDeviceEffects(resolved);

  for (const id of resolved) {
    mqttService.publish(id, { state: "ON", effect });
  }

  return { ok: true, detail: `Set effect "${effect}" on ${resolved.length} devices in "${room}"` };
}

function executeComplex(
  room: string,
  sequence: Array<{
    rgb?: { r: number; g: number; b: number };
    brightness?: number;
    color_temp_kelvin?: number;
    duration_ms: number;
  }>,
  repeat: boolean,
  transitionStyle: "instant" | "fade",
  deviceIds?: number[]
): { ok: boolean; detail: string } {
  const resolved = resolveDeviceIds(room, deviceIds);

  const effectId = runEffect(resolved, sequence, repeat, transitionStyle);

  return {
    ok: true,
    detail: `Started complex effect ${effectId}: ${sequence.length} steps, repeat=${repeat} on ${resolved.length} devices in "${room}"`,
  };
}

function executeRecall(name: string): { ok: boolean; detail: string } {
  const saved = savesService.recall(name);
  if (!saved) {
    return { ok: false, detail: `No saved shortcut found with name "${name}"` };
  }

  const deviceIds = saved.states.map((s) => s.device_id);
  cancelDeviceEffects(deviceIds);

  for (const s of saved.states) {
    const payload = buildPayloadFromSavedState(s);
    mqttService.publish(s.device_id, payload);
  }

  return {
    ok: true,
    detail: `Recalled "${name}": restored ${saved.states.length} devices`,
  };
}

function buildPayloadFromSavedState(s: SavedDeviceState): Record<string, unknown> {
  const payload: Record<string, unknown> = { state: s.state };

  if (s.brightness !== undefined) {
    payload.brightness = s.brightness;
  }

  if (s.color_mode === "rgb" && s.r !== undefined && s.g !== undefined && s.b !== undefined) {
    payload.color = { r: s.r, g: s.g, b: s.b };
  } else if (s.color_mode === "color_temp" && s.color_temp !== undefined) {
    payload.color_temp = s.color_temp;
  }

  return payload;
}

