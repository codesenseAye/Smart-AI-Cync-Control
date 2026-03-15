import type { EffectStep } from "../types/index.js";
import { mqttService } from "./mqtt.js";

interface RunningEffect {
  id: string;
  deviceIds: string[];
  abortController: AbortController;
}

// One active effect per device at most
const activeEffects = new Map<string, RunningEffect>();

let effectCounter = 0;

export function cancelDeviceEffects(deviceIds: string[]): void {
  const cancelled = new Set<string>();
  for (const deviceId of deviceIds) {
    const running = activeEffects.get(deviceId);
    if (running && !cancelled.has(running.id)) {
      running.abortController.abort();
      cancelled.add(running.id);
      console.log(`[effects] Cancelled effect ${running.id} on ${deviceId}`);
    }
    activeEffects.delete(deviceId);
  }
}

export function runEffect(
  deviceIds: string[],
  sequence: EffectStep[],
  repeat: boolean,
  transitionStyle: "instant" | "fade"
): string {
  // Cancel any existing effects on these devices
  cancelDeviceEffects(deviceIds);

  const effectId = `effect-${++effectCounter}`;
  const abortController = new AbortController();

  const effect: RunningEffect = {
    id: effectId,
    deviceIds,
    abortController,
  };

  // Register this effect for all target devices
  for (const deviceId of deviceIds) {
    activeEffects.set(deviceId, effect);
  }

  console.log(
    `[effects] Starting ${effectId}: ${sequence.length} steps, repeat=${repeat}, style=${transitionStyle}, devices=${deviceIds.length}`
  );

  // Run the sequence async
  runSequence(effectId, deviceIds, sequence, repeat, transitionStyle, abortController.signal);

  return effectId;
}

async function runSequence(
  effectId: string,
  deviceIds: string[],
  sequence: EffectStep[],
  repeat: boolean,
  _transitionStyle: "instant" | "fade",
  signal: AbortSignal
): Promise<void> {
  try {
    let stepIndex = 0;

    while (!signal.aborted) {
      const step = sequence[stepIndex];
      publishStep(deviceIds, step);

      // Wait for the step duration
      await sleep(Math.max(step.duration_ms, 250), signal);

      stepIndex++;
      if (stepIndex >= sequence.length) {
        if (repeat) {
          stepIndex = 0;
        } else {
          break;
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      // Expected when cancelled
      return;
    }
    console.error(`[effects] Error in ${effectId}:`, e);
  } finally {
    // Clean up references
    for (const deviceId of deviceIds) {
      const current = activeEffects.get(deviceId);
      if (current?.id === effectId) {
        activeEffects.delete(deviceId);
      }
    }
    console.log(`[effects] ${effectId} ended`);
  }
}

function publishStep(deviceIds: string[], step: EffectStep): void {
  const payload: Record<string, unknown> = { state: "ON" };

  if (step.brightness !== undefined) {
    payload.brightness = step.brightness;
  }
  if (step.rgb) {
    payload.color = step.rgb;
  }
  if (step.color_temp_kelvin) {
    payload.color_temp = step.color_temp_kelvin;
  }

  // If brightness is 0, treat as OFF
  if (step.brightness === 0 && !step.rgb && !step.color_temp_kelvin) {
    payload.state = "OFF";
  }

  for (const deviceId of deviceIds) {
    mqttService.publish(deviceId, payload);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function getActiveEffectCount(): number {
  // Count unique effect IDs
  const ids = new Set<string>();
  for (const effect of activeEffects.values()) {
    ids.add(effect.id);
  }
  return ids.size;
}
