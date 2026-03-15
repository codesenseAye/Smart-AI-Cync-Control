import { spawn, execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ManagedService, ServiceStatus } from "../types";

const CONTAINER_NAME = "cync-lan";
const START_TIMEOUT_MS = 60_000;

export class CyncLanService implements ManagedService {
  readonly name = "cync-lan";
  private _status: ServiceStatus = "stopped";
  private _listener?: (status: ServiceStatus, detail?: string) => void;
  private pollTimer?: ReturnType<typeof setInterval>;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

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

  private get composeFile(): string {
    return resolve(this.projectRoot, "cync-lan", "docker", "docker-compose.yaml");
  }

  /** Read project .env and build env overrides for docker compose */
  private buildComposeEnv(): Record<string, string> {
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    const envFile = resolve(this.projectRoot, ".env");

    if (!existsSync(envFile)) return env;

    const vars: Record<string, string> = {};
    for (const line of readFileSync(envFile, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }

    const mqttHost = vars.MQTT_BROKER_URL?.replace(/^mqtt:\/\//, "").replace(/:\d+$/, "") || "homeassistant.local";
    const mqttPortMatch = vars.MQTT_BROKER_URL?.match(/:(\d+)$/);
    env.CYNC_MQTT_HOST = mqttHost;
    env.CYNC_MQTT_PORT = mqttPortMatch ? mqttPortMatch[1] : "1883";
    env.CYNC_MQTT_USER = vars.MQTT_USERNAME || "";
    env.CYNC_MQTT_PASS = vars.MQTT_PASSWORD || "";
    env.CYNC_TOPIC = vars.CYNC_MQTT_TOPIC || "cync_lan";

    return env;
  }

  async start(): Promise<void> {
    // Check if already running
    const containerState = this.getContainerStatus();
    if (containerState === "running") {
      this.setStatus("running");
      return;
    }

    // Check Docker availability
    if (!this.isDockerAvailable()) {
      this.setStatus("error", "Docker is not running");
      throw new Error("Docker is not running. Start Docker Desktop first.");
    }

    this.setStatus("starting", "Starting cync-lan container...");

    const composeEnv = this.buildComposeEnv();

    return new Promise<void>((resolve, reject) => {
      const child = spawn(
        "docker",
        ["compose", "-f", this.composeFile, "up", "-d"],
        {
          env: composeEnv,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let output = "";
      child.stdout?.on("data", (d) => { output += d.toString(); });
      child.stderr?.on("data", (d) => { output += d.toString(); });

      child.on("close", (code) => {
        if (code === 0 || this.getContainerStatus() === "running") {
          this.setStatus("running");
          resolve();
        } else {
          this.setStatus("error", output.slice(-200));
          reject(new Error(`cync-lan start failed: ${output.slice(-200)}`));
        }
      });

      // Timeout
      setTimeout(() => {
        if (this._status === "starting") {
          child.kill();
          this.setStatus("error", "Start timed out");
          reject(new Error("cync-lan start timed out"));
        }
      }, START_TIMEOUT_MS);
    });
  }

  async stop(): Promise<void> {
    const containerState = this.getContainerStatus();
    if (containerState !== "running") {
      this.setStatus("stopped");
      return;
    }

    this.setStatus("stopping", "Stopping cync-lan container...");

    return new Promise<void>((resolve) => {
      const child = spawn(
        "docker",
        ["compose", "-f", this.composeFile, "down"],
        {
          stdio: "ignore",
        },
      );

      child.on("close", () => {
        this.setStatus("stopped");
        resolve();
      });

      // Fallback timeout
      setTimeout(() => {
        if (this._status === "stopping") {
          child.kill();
          this.setStatus("stopped");
          resolve();
        }
      }, 30_000);
    });
  }

  startPolling(): void {
    this.pollTimer = setInterval(() => {
      const state = this.getContainerStatus();
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

  private getContainerStatus(): string | null {
    try {
      return execSync(
        `docker inspect --format={{.State.Status}} ${CONTAINER_NAME}`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
    } catch {
      return null;
    }
  }

  private isDockerAvailable(): boolean {
    try {
      execSync("docker info", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}
