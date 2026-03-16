export type ServiceStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface ServiceStatusEvent {
  service: string;
  status: ServiceStatus;
  detail?: string;
}

export interface ServerLogEvent {
  line: string;
  stream: "stdout" | "stderr";
}

export interface DeviceEvent {
  kind: "status" | "command";
  deviceId: string;
  data: Record<string, unknown>;
}

export interface CommandResult {
  ok: boolean;
  interpreted?: unknown;
  result?: unknown;
  error?: string;
}

export interface ManagedService {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): ServiceStatus;
  onStatusChange(callback: (status: ServiceStatus, detail?: string) => void): void;
}
