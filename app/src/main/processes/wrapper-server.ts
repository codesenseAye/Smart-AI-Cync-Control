import { app } from "electron";
import { ChildProcess, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { ManagedService, ServiceStatus } from "../types";
import { DATA_PATHS } from "../data-dir";

const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 2_000;

export class WrapperServerService implements ManagedService {
  readonly name = "Wrapper Server";
  private _status: ServiceStatus = "stopped";
  private _listener?: (status: ServiceStatus, detail?: string) => void;
  private child: ChildProcess | null = null;
  private port: number;
  private dataDir: string;
  private configEnv: Record<string, string>;
  private devProjectRoot: string;
  private logCallback?: (line: string, stream: "stdout" | "stderr") => void;

  constructor(
    port: number,
    dataDir: string,
    configEnv: Record<string, string>,
    devProjectRoot: string,
  ) {
    this.port = port;
    this.dataDir = dataDir;
    this.configEnv = configEnv;
    this.devProjectRoot = devProjectRoot;
  }

  status(): ServiceStatus {
    return this._status;
  }

  onStatusChange(cb: (status: ServiceStatus, detail?: string) => void): void {
    this._listener = cb;
  }

  onLog(cb: (line: string, stream: "stdout" | "stderr") => void): void {
    this.logCallback = cb;
  }

  private setStatus(s: ServiceStatus, detail?: string): void {
    this._status = s;
    this._listener?.(s, detail);
  }

  async start(): Promise<void> {
    if (this.child) {
      this.setStatus("running");
      return;
    }

    this.setStatus("starting", "Starting server...");

    if (app.isPackaged) {
      this.startBundled();
    } else {
      this.startDev();
    }

    // Pipe stdout/stderr to log callback
    this.child!.stdout?.on("data", (data) => {
      const lines = data.toString().split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        this.logCallback?.(line, "stdout");
      }
    });

    this.child!.stderr?.on("data", (data) => {
      const lines = data.toString().split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        this.logCallback?.(line, "stderr");
      }
    });

    this.child!.on("exit", (code) => {
      this.child = null;
      if (this._status !== "stopping") {
        this.setStatus("error", `Server exited with code ${code}`);
      }
    });

    // Poll /health until ready
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(HEALTH_POLL_MS);
      if (!this.child) {
        throw new Error("Server process exited during startup");
      }
      if (await this.checkHealth()) {
        this.setStatus("running");
        return;
      }
    }

    this.setStatus("error", "Server health check timed out");
    throw new Error("Server did not become healthy in time");
  }

  /** Production: run the esbuild bundle with system node */
  private startBundled(): void {
    const serverDir = path.join(process.resourcesPath, "server");
    const bundlePath = path.join(serverDir, "bundle.cjs");
    const depsPath = path.join(serverDir, "deps");

    // Build env: pass all config.env vars + data dir paths to the server
    // NODE_PATH tells Node where to find better-sqlite3 (renamed from node_modules
    // because electron-builder filters out node_modules from extraResources)
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...this.configEnv,
      ROOMS_JSON_PATH: DATA_PATHS.roomsJson,
      DB_PATH: DATA_PATHS.stateDb,
      NODE_PATH: depsPath,
    };

    this.child = spawn("node", [bundlePath], {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
  }

  /** Dev mode: run source with tsx watch */
  private startDev(): void {
    // In dev, still pass data dir overrides so dev matches production behavior
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...this.configEnv,
      ROOMS_JSON_PATH: DATA_PATHS.roomsJson,
      DB_PATH: DATA_PATHS.stateDb,
    };

    this.child = spawn("npx", ["tsx", "watch", "src/index.ts"], {
      cwd: this.devProjectRoot,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
  }

  async stop(): Promise<void> {
    if (!this.child) {
      this.setStatus("stopped");
      return;
    }

    this.setStatus("stopping", "Stopping server...");

    const pid = this.child.pid;
    this.child.kill();
    this.child = null;

    // On Windows, killing the shell may not kill child processes.
    // Use taskkill to ensure the process tree is terminated.
    if (pid) {
      try {
        const { execSync } = require("node:child_process");
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      } catch {
        // Process may already be dead
      }
    }

    this.setStatus("stopped");
  }

  private checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${this.port}/health`, (res) => {
        resolve(res.statusCode === 200);
        res.resume(); // Drain the response
      });
      req.on("error", () => resolve(false));
      req.setTimeout(2_000, () => {
        req.destroy();
        resolve(false);
      });
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
