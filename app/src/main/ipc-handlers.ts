import { ipcMain } from "electron";
import http from "node:http";
import { ServiceManager } from "./services";
import { AppConfig } from "./env-loader";

export function registerIpcHandlers(
  services: ServiceManager,
  config: AppConfig
): void {
  // Send a command to the wrapper server's POST /command endpoint
  ipcMain.handle("command:send", async (_event, text: string) => {
    try {
      const result = await postCommand(text, config);
      return { ok: true, ...result };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // Get current statuses of all services
  ipcMain.handle("services:status", async () => {
    return services.getAllStatuses();
  });
}

function postCommand(
  text: string,
  config: AppConfig
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text });
    const req = http.request(
      {
        hostname: "localhost",
        port: config.port,
        path: "/command",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ raw: data });
          }
        });
      }
    );
    req.on("error", (err) => reject(err));
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error("Command request timed out"));
    });
    req.write(body);
    req.end();
  });
}
