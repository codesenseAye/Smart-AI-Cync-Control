import { BrowserWindow } from "electron";
import { MosquittoService } from "./processes/mosquitto";
import { LmStudioService } from "./processes/lm-studio";
import { WrapperServerService } from "./processes/wrapper-server";
import { AppConfig } from "./env-loader";
import { ServiceStatus } from "./types";

export class ServiceManager {
  readonly mosquitto: MosquittoService;
  readonly lmStudio: LmStudioService;
  readonly wrapperServer: WrapperServerService;

  private win: BrowserWindow | null = null;

  constructor(config: AppConfig) {
    this.mosquitto = new MosquittoService();
    this.lmStudio = new LmStudioService();
    this.wrapperServer = new WrapperServerService(
      config.port,
      config.dataDir,
      config.env,
      config.devProjectRoot,
    );

    // Wire status change events to renderer
    const services = [this.mosquitto, this.lmStudio, this.wrapperServer];
    for (const svc of services) {
      svc.onStatusChange((status: ServiceStatus, detail?: string) => {
        this.sendToRenderer("service:status", {
          service: svc.name,
          status,
          detail,
        });
      });
    }

    // Wire server logs to renderer
    this.wrapperServer.onLog((line, stream) => {
      this.sendToRenderer("server:log", { line, stream });
    });
  }

  setWindow(win: BrowserWindow): void {
    this.win = win;
  }

  /**
   * Start all services in dependency order.
   * MQTT broker + LM Studio in parallel, then wrapper server.
   */
  async startAll(): Promise<void> {
    this.log("Starting services...");
    const results = await Promise.allSettled([
      this.mosquitto.start(),
      this.lmStudio.start(),
    ]);

    for (const r of results) {
      if (r.status === "rejected") {
        this.log(`Service failed: ${r.reason?.message}`, true);
      }
    }

    // Wrapper server starts last (needs MQTT broker + LM Studio)
    this.log("Starting wrapper server...");
    try {
      await this.wrapperServer.start();
      this.log("Wrapper server is running.");
    } catch (err: any) {
      this.log(`Wrapper server failed: ${err.message}`, true);
    }

    // Start background polling
    this.mosquitto.startPolling();
    this.lmStudio.startPolling();
  }

  /**
   * Stop all services in reverse order.
   */
  async stopAll(): Promise<void> {
    this.mosquitto.stopPolling();
    this.lmStudio.stopPolling();

    this.log("Stopping wrapper server...");
    await this.wrapperServer.stop();

    // LM Studio: don't kill it, just mark stopped
    await this.lmStudio.stop();

    this.log("Stopping MQTT broker...");
    await this.mosquitto.stop();

    this.log("All services stopped.");
  }

  getAllStatuses(): Array<{ service: string; status: ServiceStatus }> {
    return [
      { service: this.mosquitto.name, status: this.mosquitto.status() },
      { service: this.lmStudio.name, status: this.lmStudio.status() },
      { service: this.wrapperServer.name, status: this.wrapperServer.status() },
    ];
  }

  private sendToRenderer(channel: string, data: unknown): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, data);
    }
  }

  private log(message: string, isError = false): void {
    const prefix = `[services] ${message}`;
    if (isError) console.error(prefix);
    else console.log(prefix);
    this.sendToRenderer("server:log", {
      line: prefix,
      stream: isError ? "stderr" : "stdout",
    });
  }
}
