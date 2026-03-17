export interface ElectronApi {
  sendCommand: (text: string) => Promise<CommandResult>;
  getStatuses: () => Promise<ServiceStatusData[]>;
  getRooms: () => Promise<RoomsConfig | null>;
  pollDevices: () => Promise<PollResult | null>;
  getMesh: () => Promise<MeshResult>;
  getConfig: () => Promise<ConfigResult>;
  getSettingsRooms: () => Promise<SettingsRoomsResult>;
  openFile: (path: string) => Promise<void>;
  cloudRequestOtp: (email: string) => Promise<{ ok: boolean; error?: string }>;
  cloudSync: (email: string, password: string, otp: string) => Promise<CloudSyncResult>;
  moveDevice: (deviceId: string, fromRoom: string, toRoom: string) => Promise<{ ok: boolean }>;
  onServiceStatus: (cb: (data: ServiceStatusData) => void) => void;
  onServerLog: (cb: (data: ServerLogData) => void) => void;
  onDeviceEvent: (cb: (data: DeviceEventData) => void) => void;
}

declare global {
  interface Window {
    api: ElectronApi;
  }
}

export interface ServiceStatusData {
  service: string;
  status: string;
  detail?: string;
}

export interface ServerLogData {
  line: string;
  stream: "stdout" | "stderr";
}

export interface DeviceEventData {
  kind: "status" | "command";
  deviceId: string;
  data: Record<string, unknown>;
}

export interface CommandResult {
  ok: boolean;
  interpreted?: ParsedCommand;
  error?: string;
}

export interface ParsedCommand {
  type: string;
  room?: string;
  state?: string;
  brightness?: number;
  color_temp_kelvin?: number;
  rgb?: { r: number; g: number; b: number };
  effect?: string;
  sequence?: unknown[];
  [key: string]: unknown;
}

export interface RoomsConfig {
  home_id?: string;
  rooms?: Record<string, RoomConfigData>;
}

export interface RoomConfigData {
  devices: Record<string, DeviceInfo> | number[];
  aliases?: string[];
}

export interface DeviceInfo {
  name: string;
  supports_rgb: boolean;
  supports_temperature: boolean;
}

export interface PollResult {
  devices: Record<string, Record<string, unknown>>;
}

export interface MeshResult {
  ok: boolean;
  path: string;
  devices: MeshDevice[];
}

export interface MeshDevice {
  id: number;
  name: string;
  supports_rgb: boolean;
  supports_temperature: boolean;
  fw?: string;
}

export interface ConfigResult {
  ok: boolean;
  path: string;
  entries: ConfigEntry[];
}

export interface ConfigEntry {
  key: string;
  value: string;
  comment?: boolean;
}

export interface SettingsRoomsResult {
  ok: boolean;
  path: string;
  data: RoomsConfig | null;
}

export interface CloudSyncResult {
  ok: boolean;
  error?: string;
  deviceCount?: number;
  roomCount?: number;
}

export interface FeedItem {
  id: string;
  kind: "sent" | "status";
  label: string;
  data: Record<string, unknown>;
  typeLabel: string;
  timestamp: string;
  command?: ParsedCommand;
}
