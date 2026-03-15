import { exec, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { ManagedService, ServiceStatus } from "../types";

// Common install paths for LM Studio on Windows
const LM_STUDIO_PATHS = [
  `${process.env.LOCALAPPDATA}\\LM Studio\\LM Studio.exe`,
  `${process.env.LOCALAPPDATA}\\Programs\\LM Studio\\LM Studio.exe`,
  "C:\\Program Files\\LM Studio\\LM Studio.exe",
  "C:\\Program Files (x86)\\LM Studio\\LM Studio.exe",
];

const PROCESS_NAME = "LM Studio.exe";

export class LmStudioService implements ManagedService {
  readonly name = "LM Studio";
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
    if (await this.isRunning()) {
      this.setStatus("running");
      return;
    }

    this.setStatus("starting", "Launching LM Studio...");

    const exePath = this.findExecutable();
    if (!exePath) {
      this.setStatus("error", "LM Studio executable not found");
      throw new Error(
        "LM Studio not found. Install it or set LM_STUDIO_PATH env var."
      );
    }

    // Launch detached so it outlives the Electron app if needed
    const child = spawn(exePath, [], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Poll until process appears (up to 30s)
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await sleep(2_000);
      if (await this.isRunning()) {
        this.setStatus("running");
        return;
      }
    }

    this.setStatus("error", "LM Studio did not start in time");
    throw new Error("LM Studio failed to start within 30 seconds");
  }

  async stop(): Promise<void> {
    // Don't kill LM Studio on app close — user may want it running independently
    this.setStatus("stopped");
  }

  startPolling(): void {
    this.pollTimer = setInterval(async () => {
      const running = await this.isRunning();
      const newStatus: ServiceStatus = running ? "running" : "stopped";
      if (newStatus !== this._status && this._status !== "starting") {
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

  private isRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      exec(
        `tasklist /FI "IMAGENAME eq ${PROCESS_NAME}" /FO CSV /NH`,
        (err, stdout) => {
          if (err) {
            resolve(false);
            return;
          }
          resolve(stdout.toLowerCase().includes(PROCESS_NAME.toLowerCase()));
        }
      );
    });
  }

  private findExecutable(): string | null {
    // Check env var override first
    const envPath = process.env.LM_STUDIO_PATH;
    if (envPath && existsSync(envPath)) return envPath;

    for (const p of LM_STUDIO_PATHS) {
      if (existsSync(p)) return p;
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
