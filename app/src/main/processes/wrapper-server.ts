import { ChildProcess, spawn } from "node:child_process";
import http from "node:http";
import { ManagedService, ServiceStatus } from "../types";

const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 2_000;

export class WrapperServerService implements ManagedService {
  readonly name = "Wrapper Server";
  private _status: ServiceStatus = "stopped";
  private _listener?: (status: ServiceStatus, detail?: string) => void;
  private child: ChildProcess | null = null;
  private projectRoot: string;
  private port: number;
  private logCallback?: (line: string, stream: "stdout" | "stderr") => void;

  constructor(projectRoot: string, port: number) {
    this.projectRoot = projectRoot;
    this.port = port;
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

    this.child = spawn("npx", ["tsx", "watch", "src/index.ts"], {
      cwd: this.projectRoot,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Pipe stdout/stderr to log callback
    this.child.stdout?.on("data", (data) => {
      const lines = data.toString().split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        this.logCallback?.(line, "stdout");
      }
    });

    this.child.stderr?.on("data", (data) => {
      const lines = data.toString().split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        this.logCallback?.(line, "stderr");
      }
    });

    this.child.on("exit", (code) => {
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
