import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { initLLM, parseCommand } from "../src/services/llm.js";
import type { ParsedCommand } from "../src/types/index.js";

// --- Test case definitions ---

interface Assertion {
  type: ParsedCommand["type"];
  room?: string;
  state?: "ON" | "OFF";
  effect?: string;
  brightnessRange?: [number, number];
  colorTempRange?: [number, number];
  rgbApprox?: { r: number; g: number; b: number };
  hasDeviceIds?: boolean;
  deviceIdsInclude?: number[];
  repeat?: boolean;
  transitionStyle?: "instant" | "fade";
  scheduleDays?: string;
  scheduleTimeHour?: number;
  saveName?: string;
  recallName?: string;
}

interface TestCase {
  input: string;
  assert: Assertion;
}

const RGB_TOLERANCE = 60;

// Voice commands use natural language — NOT the exact wording from the system prompt.
// This tests the LLM's ability to interpret intent without explicit instruction.
const testCases: TestCase[] = [
  // --- Power ---
  { input: "off", assert: { type: "power", room: "all", state: "OFF" } },
  { input: "on", assert: { type: "power", room: "all", state: "ON" } },
  { input: "turn off the bedroom", assert: { type: "power", room: "bedroom", state: "OFF" } },
  { input: "bathroom on", assert: { type: "power", room: "bathroom", state: "ON" } },
  { input: "shut off bed", assert: { type: "power", room: "bedroom", state: "OFF" } },
  { input: "lights out", assert: { type: "power", room: "all", state: "OFF" } },
  { input: "everything on", assert: { type: "power", room: "all", state: "ON" } },

  // --- Simple: color temperature ---
  { input: "warm", assert: { type: "simple", room: "all", colorTempRange: [2500, 3000] } },
  { input: "bedroom cool", assert: { type: "simple", room: "bedroom", colorTempRange: [5000, 6000] } },
  { input: "daylight in the bathroom", assert: { type: "simple", room: "bathroom", colorTempRange: [6000, 7000] } },

  // --- Simple: brightness ---
  { input: "dim the bedroom", assert: { type: "simple", room: "bedroom", brightnessRange: [15, 35] } },
  { input: "bathroom bright", assert: { type: "simple", room: "bathroom", brightnessRange: [90, 100] } },
  { input: "half brightness", assert: { type: "simple", room: "all", brightnessRange: [40, 60] } },

  // --- Simple: combined temp + brightness ---
  { input: "bedroom warm and dim", assert: { type: "simple", room: "bedroom", colorTempRange: [2500, 3000], brightnessRange: [15, 35] } },
  { input: "bright cool bathroom", assert: { type: "simple", room: "bathroom", brightnessRange: [90, 100], colorTempRange: [5000, 6000] } },

  // --- Simple: RGB colors ---
  { input: "bedroom red", assert: { type: "simple", room: "bedroom", rgbApprox: { r: 255, g: 0, b: 0 } } },
  { input: "make it blue", assert: { type: "simple", room: "all", rgbApprox: { r: 0, g: 0, b: 255 } } },
  { input: "bathroom green", assert: { type: "simple", room: "bathroom", rgbApprox: { r: 0, g: 255, b: 0 } } },
  { input: "purple", assert: { type: "simple", room: "all", rgbApprox: { r: 128, g: 0, b: 255 } } },
  { input: "set everything to orange", assert: { type: "simple", room: "all", rgbApprox: { r: 255, g: 165, b: 0 } } },
  { input: "pink in the bedroom", assert: { type: "simple", room: "bedroom", rgbApprox: { r: 255, g: 105, b: 180 } } },

  // --- Simple: device-specific ---
  { input: "left lamp red", assert: { type: "simple", room: "bedroom", deviceIdsInclude: [238], rgbApprox: { r: 255, g: 0, b: 0 } } },
  { input: "right lamp blue", assert: { type: "simple", room: "bedroom", deviceIdsInclude: [71], rgbApprox: { r: 0, g: 0, b: 255 } } },
  { input: "ceiling lights on", assert: { type: "power", room: "bedroom", state: "ON", deviceIdsInclude: [17, 76] } },

  // --- Factory effects ---
  { input: "rainbow", assert: { type: "effect", room: "all", effect: "rainbow" } },
  { input: "bedroom candle", assert: { type: "effect", room: "bedroom", effect: "candle" } },
  { input: "do aurora in the bathroom", assert: { type: "effect", room: "bathroom", effect: "aurora" } },
  { input: "party time", assert: { type: "effect", room: "all", effect: "party_time" } },
  { input: "fireworks in the bedroom", assert: { type: "effect", room: "bedroom", effect: "fireworks" } },
  { input: "cyber", assert: { type: "effect", room: "all", effect: "cyber" } },

  // --- Complex effects ---
  { input: "red slow flash", assert: { type: "complex", room: "all", repeat: true } },
  { input: "blue fast flash in the bedroom", assert: { type: "complex", room: "bedroom", repeat: true } },
  { input: "green pulse", assert: { type: "complex", room: "all", repeat: true, transitionStyle: "fade" } },

  // --- Save ---
  { input: "save this as chill", assert: { type: "save", saveName: "chill" } },
  { input: "save bedroom as relax", assert: { type: "save", saveName: "relax", room: "bedroom" } },

  // --- Schedule ---
  { input: "bedroom off at 11pm every day", assert: { type: "schedule", room: "bedroom", scheduleTimeHour: 23 } },
  { input: "bathroom warm at 7am on weekdays", assert: { type: "schedule", room: "bathroom", scheduleTimeHour: 7 } },

  // --- Aliases ---
  { input: "bed off", assert: { type: "power", room: "bedroom", state: "OFF" } },
  { input: "bath warm", assert: { type: "simple", room: "bathroom", colorTempRange: [2500, 3000] } },

  // ===== INTERPRETIVE / NOVEL PHRASING =====

  // --- Power: unconventional phrasing ---
  { input: "kill the lights", assert: { type: "power", room: "all", state: "OFF" } },
  { input: "blackout", assert: { type: "power", room: "all", state: "OFF" } },
  { input: "illuminate the bathroom", assert: { type: "power", room: "bathroom", state: "ON" } },
  { input: "can you turn off the bedroom", assert: { type: "power", room: "bedroom", state: "OFF" } },
  { input: "cut the lights in the bedroom", assert: { type: "power", room: "bedroom", state: "OFF" } },

  // --- Novel color descriptions → nearest known color ---
  { input: "make the bedroom lavender", assert: { type: "simple", room: "bedroom", rgbApprox: { r: 128, g: 0, b: 255 } } },
  { input: "ocean in the bathroom", assert: { type: "simple", room: "bathroom", rgbApprox: { r: 0, g: 0, b: 255 } } },
  { input: "crimson", assert: { type: "simple", room: "all", rgbApprox: { r: 255, g: 0, b: 0 } } },
  { input: "lime green bedroom", assert: { type: "simple", room: "bedroom", rgbApprox: { r: 0, g: 255, b: 0 } } },
  { input: "coral", assert: { type: "simple", room: "all", rgbApprox: { r: 255, g: 165, b: 0 } } },
  { input: "make it sky blue", assert: { type: "simple", room: "all", rgbApprox: { r: 0, g: 0, b: 255 } } },
  { input: "turquoise bathroom", assert: { type: "simple", room: "bathroom", rgbApprox: { r: 0, g: 128, b: 128 } } },
  { input: "golden bedroom", assert: { type: "simple", room: "bedroom", rgbApprox: { r: 255, g: 255, b: 0 } } },
  { input: "magenta", assert: { type: "simple", room: "all", rgbApprox: { r: 128, g: 0, b: 255 } } },
  { input: "violet in the bedroom", assert: { type: "simple", room: "bedroom", rgbApprox: { r: 128, g: 0, b: 255 } } },

  // --- Mood/atmosphere descriptions ---
  { input: "make it cozy", assert: { type: "simple", room: "all", colorTempRange: [2500, 3000], brightnessRange: [15, 35] } },
  { input: "movie mode", assert: { type: "simple", room: "all", brightnessRange: [15, 35] } },
  { input: "bedroom romantic", assert: { type: "simple", room: "bedroom", colorTempRange: [2500, 3000], brightnessRange: [15, 35] } },
  { input: "study mode in the bathroom", assert: { type: "simple", room: "bathroom", brightnessRange: [90, 100], colorTempRange: [5000, 6000] } },
  { input: "sunset vibes", assert: { type: "simple", room: "all", colorTempRange: [2500, 3000] } },

  // --- Indirect brightness descriptions ---
  { input: "barely on", assert: { type: "simple", room: "all", brightnessRange: [15, 35] } },
  { input: "full blast", assert: { type: "simple", room: "all", brightnessRange: [90, 100] } },
  { input: "crank it up", assert: { type: "simple", room: "all", brightnessRange: [90, 100] } },
  { input: "bedroom low", assert: { type: "simple", room: "bedroom", brightnessRange: [15, 35] } },

  // --- Conversational / natural phrasing ---
  { input: "I want the bedroom to be red", assert: { type: "simple", room: "bedroom", rgbApprox: { r: 255, g: 0, b: 0 } } },
  { input: "make the bathroom a bit warmer", assert: { type: "simple", room: "bathroom", colorTempRange: [2500, 3000] } },
  { input: "please turn on the bedroom lights", assert: { type: "power", room: "bedroom", state: "ON" } },
  { input: "could you make it brighter", assert: { type: "simple", room: "all", brightnessRange: [90, 100] } },
  { input: "I need more light in the bathroom", assert: { type: "simple", room: "bathroom", brightnessRange: [90, 100] } },
  { input: "it's too bright in here", assert: { type: "simple", room: "all", brightnessRange: [15, 35] } },

  // --- Complex effect descriptions with novel words ---
  { input: "bedroom strobe", assert: { type: "complex", room: "bedroom", repeat: true } },
  { input: "breathing red", assert: { type: "complex", room: "all", repeat: true, transitionStyle: "fade" } },
  { input: "make it blink blue", assert: { type: "complex", room: "all", repeat: true } },

  // --- Schedule with natural phrasing ---
  { input: "wake me up at 7am with warm lights", assert: { type: "schedule", room: "all", scheduleTimeHour: 7 } },
  { input: "kill the lights at midnight every night", assert: { type: "schedule", room: "all", scheduleTimeHour: 0 } },

  // ===== NOVEL INTERPRETATION (no hints given in prompts) =====

  // --- Colors the LLM has never been told about ---
  { input: "burgundy in the bedroom", assert: { type: "simple", room: "bedroom", rgbApprox: { r: 255, g: 0, b: 0 } } },
  { input: "indigo", assert: { type: "simple", room: "all", rgbApprox: { r: 128, g: 0, b: 255 } } },
  { input: "tangerine", assert: { type: "simple", room: "all", rgbApprox: { r: 255, g: 165, b: 0 } } },
  { input: "cerulean bathroom", assert: { type: "simple", room: "bathroom", rgbApprox: { r: 0, g: 0, b: 255 } } },
  { input: "emerald", assert: { type: "simple", room: "all", rgbApprox: { r: 0, g: 255, b: 0 } } },
  { input: "ruby bedroom", assert: { type: "simple", room: "bedroom", rgbApprox: { r: 255, g: 0, b: 0 } } },
  { input: "copper", assert: { type: "simple", room: "all", rgbApprox: { r: 255, g: 165, b: 0 } } },
  { input: "cobalt bathroom", assert: { type: "simple", room: "bathroom", rgbApprox: { r: 0, g: 0, b: 255 } } },
  { input: "blush", assert: { type: "simple", room: "all", rgbApprox: { r: 255, g: 105, b: 180 } } },
  { input: "wine bedroom", assert: { type: "simple", room: "bedroom", rgbApprox: { r: 255, g: 0, b: 0 } } },

  // --- Moods/atmospheres with no prompt guidance ---
  { input: "bedtime", assert: { type: "simple", room: "all", colorTempRange: [2500, 3000], brightnessRange: [15, 35] } },
  { input: "reading mode bathroom", assert: { type: "simple", room: "bathroom", brightnessRange: [90, 100] } },
  { input: "meditation", assert: { type: "simple", room: "all", colorTempRange: [2500, 3000], brightnessRange: [15, 35] } },
  { input: "spa vibes", assert: { type: "simple", room: "all", colorTempRange: [2500, 3000], brightnessRange: [15, 35] } },
  { input: "date night bedroom", assert: { type: "simple", room: "bedroom", colorTempRange: [2500, 3000], brightnessRange: [15, 35] } },
  { input: "morning routine", assert: { type: "simple", room: "all", brightnessRange: [90, 100] } },

  // --- Power phrases not in any prompt ---
  { input: "douse the lights", assert: { type: "power", room: "all", state: "OFF" } },
  { input: "go dark", assert: { type: "power", room: "all", state: "OFF" } },
  { input: "extinguish the bedroom", assert: { type: "power", room: "bedroom", state: "OFF" } },
  { input: "light it up", assert: { type: "power", room: "all", state: "ON" } },
  { input: "snuff it", assert: { type: "power", room: "all", state: "OFF" } },

  // --- Brightness descriptions not in any prompt ---
  { input: "nightlight mode", assert: { type: "simple", room: "all", brightnessRange: [15, 35] } },
  { input: "all the way up", assert: { type: "simple", room: "all", brightnessRange: [90, 100] } },
  { input: "super dim bedroom", assert: { type: "simple", room: "bedroom", brightnessRange: [15, 35] } },
  { input: "I can't see anything", assert: { type: "simple", room: "all", brightnessRange: [90, 100] } },
  { input: "it's way too harsh", assert: { type: "simple", room: "all", brightnessRange: [15, 35] } },

  // --- Animation descriptions not in any prompt ---
  { input: "heartbeat bedroom", assert: { type: "complex", room: "bedroom", repeat: true, transitionStyle: "fade" } },
  { input: "twinkle", assert: { type: "complex", room: "all", repeat: true } },
  { input: "pulsating blue", assert: { type: "complex", room: "all", repeat: true, transitionStyle: "fade" } },

  // --- Schedule with novel phrasing ---
  { input: "dim at 9pm nightly", assert: { type: "schedule", room: "all", scheduleTimeHour: 21 } },
  { input: "bright and cool at 6am on weekdays", assert: { type: "schedule", room: "all", scheduleTimeHour: 6 } },
];

// --- Assertion helpers ---

function assertRgbApprox(actual: { r: number; g: number; b: number }, expected: { r: number; g: number; b: number }, label: string) {
  const dr = Math.abs(actual.r - expected.r);
  const dg = Math.abs(actual.g - expected.g);
  const db = Math.abs(actual.b - expected.b);
  assert.ok(
    dr <= RGB_TOLERANCE && dg <= RGB_TOLERANCE && db <= RGB_TOLERANCE,
    `${label}: RGB (${actual.r},${actual.g},${actual.b}) not close to (${expected.r},${expected.g},${expected.b}) — delta (${dr},${dg},${db}) exceeds tolerance ${RGB_TOLERANCE}`
  );
}

function assertRange(actual: number | undefined, range: [number, number], label: string) {
  assert.ok(actual !== undefined, `${label}: expected a value, got undefined`);
  assert.ok(
    actual >= range[0] && actual <= range[1],
    `${label}: ${actual} not in range [${range[0]}, ${range[1]}]`
  );
}

function assertCommand(result: ParsedCommand, expected: Assertion, input: string) {
  const label = `"${input}"`;

  assert.equal(result.type, expected.type, `${label}: type — got "${result.type}", expected "${expected.type}"`);

  if (expected.room !== undefined) {
    assert.ok("room" in result, `${label}: missing room field`);
    assert.equal((result as any).room, expected.room, `${label}: room — got "${(result as any).room}", expected "${expected.room}"`);
  }

  if (expected.state !== undefined) {
    assert.ok("state" in result, `${label}: missing state field`);
    assert.equal((result as any).state, expected.state, `${label}: state`);
  }

  if (expected.effect !== undefined) {
    assert.ok(result.type === "effect", `${label}: expected effect type`);
    assert.equal(result.effect, expected.effect, `${label}: effect — got "${result.effect}", expected "${expected.effect}"`);
  }

  if (expected.brightnessRange !== undefined) {
    assert.ok(result.type === "simple", `${label}: expected simple type for brightness check`);
    assertRange(result.brightness, expected.brightnessRange, `${label} brightness`);
  }

  if (expected.colorTempRange !== undefined) {
    assert.ok(result.type === "simple", `${label}: expected simple type for color_temp check`);
    assertRange(result.color_temp_kelvin, expected.colorTempRange, `${label} color_temp_kelvin`);
  }

  if (expected.rgbApprox !== undefined) {
    assert.ok(result.type === "simple", `${label}: expected simple type for RGB check`);
    assert.ok(result.rgb !== undefined, `${label}: missing rgb field`);
    assertRgbApprox(result.rgb, expected.rgbApprox, label);
  }

  if (expected.deviceIdsInclude !== undefined) {
    const ids: number[] | undefined = (result as any).device_ids;
    assert.ok(Array.isArray(ids), `${label}: expected device_ids array, got ${ids}`);
    for (const expected_id of expected.deviceIdsInclude) {
      assert.ok(ids.includes(expected_id), `${label}: device_ids ${JSON.stringify(ids)} missing expected ID ${expected_id}`);
    }
  }

  if (expected.hasDeviceIds === true) {
    const ids: number[] | undefined = (result as any).device_ids;
    assert.ok(Array.isArray(ids) && ids.length > 0, `${label}: expected non-empty device_ids`);
  }

  if (expected.repeat !== undefined && result.type === "complex") {
    assert.equal(result.repeat, expected.repeat, `${label}: repeat`);
  }

  if (expected.transitionStyle !== undefined && result.type === "complex") {
    assert.equal(result.transition_style, expected.transitionStyle, `${label}: transition_style`);
  }

  if (expected.saveName !== undefined) {
    assert.ok(result.type === "save", `${label}: expected save type`);
    assert.equal(result.name, expected.saveName, `${label}: save name`);
  }

  if (expected.recallName !== undefined) {
    assert.ok(result.type === "recall", `${label}: expected recall type`);
    assert.equal(result.name, expected.recallName, `${label}: recall name`);
  }

  if (expected.scheduleTimeHour !== undefined) {
    assert.ok(result.type === "schedule", `${label}: expected schedule type`);
    const hour = parseInt(result.time.split(":")[0], 10);
    assert.equal(hour, expected.scheduleTimeHour, `${label}: schedule hour — got ${hour}, expected ${expected.scheduleTimeHour}`);
  }

  if (expected.scheduleDays !== undefined && result.type === "schedule") {
    assert.ok(
      result.days.toLowerCase().includes(expected.scheduleDays.toLowerCase()),
      `${label}: schedule days — got "${result.days}", expected to contain "${expected.scheduleDays}"`
    );
  }
}

// --- Test runner ---

describe("LLM Command Parsing", { timeout: 600_000 }, () => {
  before(async () => {
    await initLLM();
  });

  for (const tc of testCases) {
    it(`"${tc.input}" → ${tc.assert.type}`, { timeout: 60_000 }, async () => {
      const result = await parseCommand(tc.input);

      // First: schema validation passed (parseCommand throws if not)
      // Second: semantic assertions
      assertCommand(result, tc.assert, tc.input);
    });
  }
});
