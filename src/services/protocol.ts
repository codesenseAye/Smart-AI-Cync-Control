/**
 * Cync binary protocol parser and command builder.
 * Ported from cync-lan Python (devices.py, const.py).
 */

// --- Packet type constants ---

export const PKT = {
  AUTH: 0x23,
  AUTH_ACK: 0x28,
  CONNECT: 0xc3,
  CONNECT_ACK: 0xc8,
  PING: 0xd3,
  PONG: 0xd8,
  STATUS_BROADCAST: 0x43,
  STATUS_ACK: 0x48,
  STATUS_INTERNAL: 0x83,
  STATUS_INT_ACK: 0x88,
  CONTROL: 0x73,
  CONTROL_RESP: 0x78,
  CONTROL_ACK: 0x7b,
  APP_ANNOUNCE: 0xa3,
  APP_ANNOUNCE_ACK: 0xab,
} as const;

const PKT_NAMES: Record<number, string> = {
  [PKT.AUTH]: "AUTH",
  [PKT.AUTH_ACK]: "AUTH_ACK",
  [PKT.CONNECT]: "CONNECT",
  [PKT.CONNECT_ACK]: "CONNECT_ACK",
  [PKT.PING]: "PING",
  [PKT.PONG]: "PONG",
  [PKT.STATUS_BROADCAST]: "STATUS",
  [PKT.STATUS_ACK]: "STATUS_ACK",
  [PKT.STATUS_INTERNAL]: "STATUS_INT",
  [PKT.STATUS_INT_ACK]: "STATUS_INT_ACK",
  [PKT.CONTROL]: "CTRL",
  [PKT.CONTROL_RESP]: "CTRL_RESP",
  [PKT.CONTROL_ACK]: "CTRL_ACK",
  [PKT.APP_ANNOUNCE]: "APP_ANN",
  [PKT.APP_ANNOUNCE_ACK]: "APP_ANN_ACK",
};

/** Get a human-readable name for a packet type byte. */
export function pktName(type: number): string {
  return PKT_NAMES[type] ?? `0x${type.toString(16)}`;
}

const KNOWN_HEADERS = new Set(Object.values(PKT));
const DATA_BOUNDARY = 0x7e;

// --- Factory effects byte mapping (from const.py) ---

const FACTORY_EFFECTS_BYTES: Record<string, [number, number]> = {
  candle: [0x01, 0xf1],
  cyber: [0x43, 0x9f],
  rainbow: [0x02, 0x7a],
  fireworks: [0x3a, 0xda],
  volcanic: [0x04, 0xf4],
  aurora: [0x05, 0x1c],
  happy_holidays: [0x06, 0x54],
  red_white_blue: [0x07, 0x4f],
  vegas: [0x08, 0xe3],
  party_time: [0x09, 0x06],
};

// --- Types ---

export interface PacketHeader {
  type: number;
  payloadLength: number;
}

export interface DeviceStatusUpdate {
  deviceId: number;
  power: number;
  brightness: number;
  temperature: number;
  r: number;
  g: number;
  b: number;
  fresh: boolean;
}

export interface ExtractResult {
  packets: Buffer[];
  remainder: Buffer;
}

// --- Header parsing ---

export function parseHeader(data: Buffer): PacketHeader | null {
  if (data.length < 5) return null;
  const type = data[0];
  const multiplier = data[3] * 256;
  const payloadLength = data[4] + multiplier;
  return { type, payloadLength };
}

/**
 * Extract complete packets from a raw TCP data stream.
 * Handles fragmentation — returns any leftover bytes as remainder.
 */
export function extractPackets(data: Buffer): ExtractResult {
  const packets: Buffer[] = [];
  let offset = 0;

  while (offset < data.length) {
    if (data.length - offset < 5) {
      // Not enough for a header
      break;
    }

    const type = data[offset] as number;
    if (!KNOWN_HEADERS.has(type as (typeof PKT)[keyof typeof PKT])) {
      // Unknown header — skip ahead to the next known header
      const skipStart = offset;
      while (offset < data.length && !KNOWN_HEADERS.has(data[offset] as (typeof PKT)[keyof typeof PKT])) {
        offset++;
      }
      const skipped = data.subarray(skipStart, offset);
      console.warn(`[protocol] Skipped ${skipped.length} unknown bytes: ${skipped.toString("hex")}`);
      continue;
    }

    const multiplier = data[offset + 3] * 256;
    const payloadLen = data[offset + 4] + multiplier;
    const totalLen = payloadLen + 5; // header (5) + payload

    if (offset + totalLen > data.length) {
      // Incomplete packet — return as remainder
      break;
    }

    packets.push(data.subarray(offset, offset + totalLen));
    offset += totalLen;
  }

  const remainder = offset < data.length ? Buffer.from(data.subarray(offset)) : Buffer.alloc(0);
  return { packets, remainder };
}

// --- Status parsing ---

/**
 * Parse a 0x43 status broadcast packet into device state updates.
 * Packet structure: 5-byte header + 7-byte subheader + N * 19-byte status structs.
 * Status struct bytes [3..10]: deviceId, power, brightness, temp, R, G, B, freshness
 */
export function parseStatusBroadcast(packet: Buffer): DeviceStatusUpdate[] {
  const results: DeviceStatusUpdate[] = [];
  const headerLen = 12; // 5 header + 7 (queue_id + msg_id)

  if (packet.length <= headerLen) return results;

  const packetData = packet.subarray(headerLen);

  // Check for timestamp packet (0xC7 0x90 prefix) — not status data
  if (packetData.length >= 2 && packetData[0] === 0xc7 && packetData[1] === 0x90) {
    return results;
  }

  const structLen = 19;
  for (let i = 0; i + structLen <= packetData.length; i += structLen) {
    const s = packetData.subarray(i + 3, i + 11); // status struct: bytes 3-10
    if (s.length < 8) break;

    results.push({
      deviceId: s[0],
      power: s[1],
      brightness: s[2],
      temperature: s[3],
      r: s[4],
      g: s[5],
      b: s[6],
      fresh: s[7] !== 0,
    });
  }

  return results;
}

/**
 * Parse a 0x83 internal status packet.
 * Only handles the FA DB 13 (internal status) variant.
 * Indices reference packet_data (after the 12-byte header).
 */
export function parseInternalStatus(packet: Buffer): DeviceStatusUpdate | null {
  const headerLen = 12;
  if (packet.length <= headerLen) return null;

  const packetData = packet.subarray(headerLen);

  // Must start with 0x7E (data boundary)
  if (packetData[0] !== DATA_BOUNDARY) return null;

  // Check for FA DB 13 control bytes (internal status)
  if (packetData.length < 26) return null;
  if (packetData[5] !== 0xfa || packetData[6] !== 0xdb || packetData[7] !== 0x13) return null;

  const deviceId = packetData[14];
  const fresh = packetData[19] !== 0;
  const power = packetData[20];
  const brightness = packetData[21];
  const temperature = packetData[22];
  const r = packetData[23];
  const g = packetData[24];
  const b = packetData[25];

  return { deviceId, power, brightness, temperature, r, g, b, fresh };
}

// --- Control message ID management ---

export class CtrlCounter {
  private bytes: [number, number] = [0, 0];

  next(): number {
    this.bytes[0]++;
    if (this.bytes[0] > 255) {
      this.bytes[0] = this.bytes[0] % 256;
      this.bytes[1]++;
    }
    return this.bytes[0];
  }
}

// --- Command builders ---

function buildControlPacket(
  header: number[],
  innerTemplate: number[],
  queueId: Buffer,
  ctrlId: number,
): Buffer {
  const inner = [...innerTemplate];
  // Set ctrl_id at indices 1 and 9
  inner[1] = ctrlId;
  inner[9] = ctrlId;
  // Calculate checksum: sum of inner[6..-2] % 256
  let sum = 0;
  for (let i = 6; i < inner.length - 2; i++) {
    sum += inner[i];
  }
  inner[inner.length - 2] = sum % 256;

  const payload = Buffer.alloc(header.length + queueId.length + 3 + inner.length);
  let offset = 0;
  for (const b of header) payload[offset++] = b;
  queueId.copy(payload, offset); offset += queueId.length;
  payload[offset++] = 0x00;
  payload[offset++] = 0x00;
  payload[offset++] = 0x00;
  for (const b of inner) payload[offset++] = b;

  return payload;
}

export function buildPowerCmd(
  deviceId: number,
  state: 0 | 1,
  queueId: Buffer,
  ctrlId: number,
  subId: number = 0,
): Buffer {
  const header = [0x73, 0x00, 0x00, 0x00, 0x1f];
  const inner = [
    0x7e, 0, 0x00, 0x00, 0x00,
    0xf8, 0xd0, 0x0d, 0x00,
    0, // ctrl_id placeholder at index 9
    0x00, 0x00, 0x00, 0x00,
    deviceId, subId,
    0xd0, 0x11, 0x02,
    state,
    0x00, 0x00,
    0, // checksum placeholder
    0x7e,
  ];
  return buildControlPacket(header, inner, queueId, ctrlId);
}

export function buildBrightnessCmd(
  deviceId: number,
  brightness: number,
  queueId: Buffer,
  ctrlId: number,
  subId: number = 0,
): Buffer {
  const header = [0x73, 0x00, 0x00, 0x00, 0x22];
  const inner = [
    0x7e, 0, 0x00, 0x00, 0x00,
    0xf8, 0xf0, 0x10, 0x00,
    0,
    0x00, 0x00, 0x00, 0x00,
    deviceId, subId,
    0xf0, 0x11, 0x02, 0x01,
    brightness,
    0xff, 0xff, 0xff, 0xff,
    0, // checksum
    0x7e,
  ];
  return buildControlPacket(header, inner, queueId, ctrlId);
}

export function buildTemperatureCmd(
  deviceId: number,
  temp: number,
  queueId: Buffer,
  ctrlId: number,
  subId: number = 0,
): Buffer {
  const header = [0x73, 0x00, 0x00, 0x00, 0x22];
  const inner = [
    0x7e, 0, 0x00, 0x00, 0x00,
    0xf8, 0xf0, 0x10, 0x00,
    0,
    0x00, 0x00, 0x00, 0x00,
    deviceId, subId,
    0xf0, 0x11, 0x02, 0x01,
    0xff, temp,
    0x00, 0x00, 0x00,
    0, // checksum
    0x7e,
  ];
  return buildControlPacket(header, inner, queueId, ctrlId);
}

export function buildRGBCmd(
  deviceId: number,
  r: number,
  g: number,
  b: number,
  queueId: Buffer,
  ctrlId: number,
  subId: number = 0,
): Buffer {
  const header = [0x73, 0x00, 0x00, 0x00, 0x22];
  const inner = [
    0x7e, 0, 0x00, 0x00, 0x00,
    0xf8, 0xf0, 0x10, 0x00,
    0,
    0x00, 0x00, 0x00, 0x00,
    deviceId, subId,
    0xf0, 0x11, 0x02, 0x01,
    0xff, 0xfe,
    r, g, b,
    0, // checksum
    0x7e,
  ];
  return buildControlPacket(header, inner, queueId, ctrlId);
}

export function buildEffectCmd(
  deviceId: number,
  effect: string,
  queueId: Buffer,
  ctrlId: number,
  subId: number = 0,
): Buffer {
  const effectBytes = FACTORY_EFFECTS_BYTES[effect.toLowerCase()];
  if (!effectBytes) {
    throw new Error(`Unknown factory effect: ${effect}`);
  }
  const header = [0x73, 0x00, 0x00, 0x00, 0x20];
  const inner = [
    0x7e, 0, 0x00, 0x00, 0x00,
    0xf8, 0xe2, 0x0e, 0x00,
    0,
    0x00, 0x00, 0x00, 0x00,
    deviceId, subId,
    0xe2, 0x11, 0x02,
    0x07, 0x01,
    effectBytes[0], effectBytes[1],
    0, // checksum
    0x7e,
  ];
  return buildControlPacket(header, inner, queueId, ctrlId);
}

// --- Kelvin conversion ---

/** Convert Kelvin (2000-7000) to Cync temperature scale (0-100). */
export function kelvinToTemp(kelvin: number): number {
  return Math.round(((kelvin - 2000) / 5000) * 100);
}

/** Convert Cync temperature scale (0-100) to Kelvin (2000-7000). */
export function tempToKelvin(temp: number): number {
  return Math.round((temp / 100) * 5000 + 2000);
}
