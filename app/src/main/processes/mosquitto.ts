import { exec } from "node:child_process";
import { ManagedService, ServiceStatus } from "../types";

const SERVICE_NAME = "mosquitto";
const START_TIMEOUT_MS = 15_000;
const POLL_MS = 2_000;

export class MosquittoService implements ManagedService {
  readonly name = "MQTT Broker";
  private _status: ServiceStatus = "stopped";
  private _listener?: (status: ServiceStatus, detail?: string) => void;
  private pollTimer?: ReturnType<typeof setInterval>;

  status(): ServiceStatus {
    return this._status;
  }

  onStatusChange(cb: (status: ServiceStatus, detail?: string) => void): void {
    this._listener = cb;
  }

  private setStatus(s: ServiceStatus, detail?: string): void {
    this._status = s;
    this._listener?.(s, detail);
  }

  async start(): Promise<void> {
    const state = await this.queryService();
    if (state === "RUNNING") {
      this.setStatus("running");
      return;
    }

    this.setStatus("starting", "Starting Mosquitto...");

    try {
      await this.sc("start");
    } catch (err: any) {
      const msg = err.message || String(err);
      // "already running" style errors are fine
      if (msg.includes("1056")) {
        this.setStatus("running");
        return;
      }
      this.setStatus("error", msg);
      throw err;
    }

    // Poll until running or timeout
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const s = await this.queryService();
      if (s === "RUNNING") {
        this.setStatus("running");
        return;
      }
    }

    this.setStatus("error", "Mosquitto did not start in time");
    throw new Error("Mosquitto did not start in time");
  }

  async stop(): Promise<void> {
    const state = await this.queryService();
    if (state !== "RUNNING") {
      this.setStatus("stopped");
      return;
    }

    this.setStatus("stopping", "Stopping Mosquitto...");

    try {
      await this.sc("stop");
    } catch {
      // best effort
    }

    // Wait for stop (10s)
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const s = await this.queryService();
      if (s !== "RUNNING") {
        this.setStatus("stopped");
        return;
      }
    }

    this.setStatus("stopped");
  }

  startPolling(): void {
    this.pollTimer = setInterval(async () => {
      const state = await this.queryService();
      const newStatus: ServiceStatus = state === "RUNNING" ? "running" : "stopped";
      if (newStatus !== this._status && this._status !== "starting" && this._status !== "stopping") {
        this.setStatus(newStatus);
      }
    }, 10_000);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /** Run `sc <action> mosquitto` */
  private sc(action: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(`sc ${action} ${SERVICE_NAME}`, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
  }

  /** Query the Windows service state. Returns e.g. "RUNNING", "STOPPED", "unknown". */
  private queryService(): Promise<string> {
    return new Promise((resolve) => {
      exec(`sc query ${SERVICE_NAME}`, (err, stdout) => {
        if (err) {
          resolve("unknown");
          return;
        }
        const match = stdout.match(/STATE\s+:\s+\d+\s+(\w+)/);
        resolve(match ? match[1] : "unknown");
      });
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
