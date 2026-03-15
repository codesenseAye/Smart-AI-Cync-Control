import { BrowserWindow } from "electron";
import { HassVmService } from "./processes/hass-vm";
import { CyncLanService } from "./processes/cync-lan";
import { LmStudioService } from "./processes/lm-studio";
import { WrapperServerService } from "./processes/wrapper-server";
import { AppConfig } from "./env-loader";
import { ServiceStatus } from "./types";

export class ServiceManager {
  readonly hass: HassVmService;
  readonly cyncLan: CyncLanService;
  readonly lmStudio: LmStudioService;
  readonly wrapperServer: WrapperServerService;

  private win: BrowserWindow | null = null;

  constructor(config: AppConfig) {
    this.hass = new HassVmService();
    this.cyncLan = new CyncLanService(config.projectRoot);
    this.lmStudio = new LmStudioService();
    this.wrapperServer = new WrapperServerService(config.projectRoot, config.port);

    // Wire status change events to renderer
    const services = [this.hass, this.cyncLan, this.lmStudio, this.wrapperServer];
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
   * HASS VM first (MQTT broker), then cync-lan + LM Studio in parallel, then wrapper server.
   */
  async startAll(): Promise<void> {
    // Start HASS VM, cync-lan, and LM Studio in parallel
    // HASS VM boot can take minutes — don't block other services
    this.log("Starting HASS VM, cync-lan, and LM Studio...");
    const results = await Promise.allSettled([
      this.hass.start(),
      this.cyncLan.start(),
      this.lmStudio.start(),
    ]);

    for (const r of results) {
      if (r.status === "rejected") {
        this.log(`Service failed: ${r.reason?.message}`, true);
      }
    }

    // Wrapper server starts last (needs MQTT + LM Studio)
    this.log("Starting wrapper server...");
    try {
      await this.wrapperServer.start();
      this.log("Wrapper server is running.");
    } catch (err: any) {
      this.log(`Wrapper server failed: ${err.message}`, true);
    }

    // Start background polling for all services
    this.hass.startPolling();
    this.cyncLan.startPolling();
    this.lmStudio.startPolling();
  }

  /**
   * Stop all services in reverse order.
   */
  async stopAll(): Promise<void> {
    // Stop polling first
    this.hass.stopPolling();
    this.cyncLan.stopPolling();
    this.lmStudio.stopPolling();

    this.log("Stopping wrapper server...");
    await this.wrapperServer.stop();

    this.log("Stopping cync-lan...");
    await this.cyncLan.stop();

    // LM Studio: don't kill it, just mark stopped
    await this.lmStudio.stop();

    this.log("Shutting down HASS VM...");
    await this.hass.stop();

    this.log("All services stopped.");
  }

  getAllStatuses(): Array<{ service: string; status: ServiceStatus }> {
    return [
      { service: this.hass.name, status: this.hass.status() },
      { service: this.cyncLan.name, status: this.cyncLan.status() },
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
