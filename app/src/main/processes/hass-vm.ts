import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { ManagedService, ServiceStatus } from "../types";

const VM_NAME = "HASS";
const BOOT_TIMEOUT_MS = 180_000; // 3 minutes
const POLL_INTERVAL_MS = 3_000;

// Resolve VBoxManage — use PATH first, fall back to default install location
const VBOX_DEFAULT = "C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe";
const VBOXMANAGE = existsSync(VBOX_DEFAULT) ? VBOX_DEFAULT : "VBoxManage";

export class HassVmService implements ManagedService {
  readonly name = "HASS VM";
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
    // Check if already running
    const currentState = await this.getVmState();
    if (currentState === "running") {
      this.setStatus("running");
      return;
    }

    this.setStatus("starting", "Booting VM...");

    try {
      await this.vboxManage(["startvm", VM_NAME, "--type", "headless"]);
    } catch (err: any) {
      const msg = err.message || String(err);
      // "already running" is fine
      if (msg.includes("already locked")) {
        // VM is already running, polling will pick it up
      } else {
        this.setStatus("error", msg);
        throw err;
      }
    }

    // Poll until running or timeout
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const state = await this.getVmState();
      if (state === "running") {
        this.setStatus("running");
        return;
      }
      this.setStatus("starting", `VM state: ${state}`);
    }

    this.setStatus("error", "VM boot timed out");
    throw new Error("HASS VM boot timed out");
  }

  async stop(): Promise<void> {
    const state = await this.getVmState();
    if (state !== "running") {
      this.setStatus("stopped");
      return;
    }

    this.setStatus("stopping", "Sending ACPI shutdown...");

    try {
      await this.vboxManage(["controlvm", VM_NAME, "acpipowerbutton"]);
    } catch {
      // If ACPI fails, try savestate
      try {
        await this.vboxManage(["controlvm", VM_NAME, "savestate"]);
      } catch (err: any) {
        this.setStatus("error", err.message);
        return;
      }
    }

    // Wait for shutdown (30s), then savestate as fallback
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await sleep(2_000);
      const s = await this.getVmState();
      if (s !== "running") {
        this.setStatus("stopped");
        return;
      }
    }

    // Fallback: savestate
    this.setStatus("stopping", "ACPI timeout, saving state...");
    try {
      await this.vboxManage(["controlvm", VM_NAME, "savestate"]);
    } catch { /* best effort */ }
    this.setStatus("stopped");
  }

  startPolling(): void {
    this.pollTimer = setInterval(async () => {
      const state = await this.getVmState();
      const newStatus: ServiceStatus = state === "running" ? "running" : "stopped";
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

  private getVmState(): Promise<string> {
    return new Promise((resolve) => {
      execFile(VBOXMANAGE, ["showvminfo", VM_NAME, "--machinereadable"], (err, stdout) => {
        if (err) {
          resolve("unknown");
          return;
        }
        const match = stdout.match(/VMState="([^"]+)"/);
        resolve(match ? match[1] : "unknown");
      });
    });
  }

  private vboxManage(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(VBOXMANAGE, args, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
