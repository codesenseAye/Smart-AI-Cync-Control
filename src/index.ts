import express from "express";
import Database from "better-sqlite3";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { mqttService } from "./services/mqtt.js";
import { initLLM } from "./services/llm.js";
import { savesService } from "./services/saves.js";
import { execute } from "./services/executor.js";
import { commandRouter } from "./routes/command.js";
import { statusRouter } from "./routes/status.js";
import { dnsRouter } from "./routes/dns.js";
import { proxyService } from "./services/proxy.js";

const app = express();
app.use(express.json());

// --- Auth middleware ---
function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const key = req.headers["authorization"];
  if (key !== `Bearer ${config.apiKey}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// --- Health check (no auth) ---
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    mqtt: mqttService.isConnected(),
  });
});

app.use(requireApiKey);
app.use(commandRouter);
app.use(statusRouter);
app.use(dnsRouter);

// --- Bootstrap ---
async function start() {
  console.log("[boot] Starting smart-ai-cync-control server...");

  // 1. SQLite
  const dbPath = process.env.DB_PATH || join(__dirname, "..", "src", "data", "state.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  console.log(`[boot] SQLite database at ${dbPath}`);

  // 2. Init services that need DB
  savesService.init(db);

  // 3. Connect MQTT
  try {
    await mqttService.connect();
  } catch (e) {
    console.error("[boot] MQTT connection failed:", e);
    console.warn("[boot] Server will start but MQTT commands will not work until broker is available");
  }

  // 4. Initialize LM Studio SDK client
  try {
    await initLLM();
    console.log(`[boot] LM Studio SDK initialized, model: ${config.llm.model}`);
  } catch (e) {
    console.warn("[boot] LM Studio SDK init failed — commands will fail until LM Studio is running:", e);
  }

  // 5. Start proxy
  try {
    await proxyService.start();
    mqttService.onCommand((deviceId, command) => proxyService.sendCommand(deviceId, command));
    console.log("[boot] TLS relay proxy started");
  } catch (e) {
    console.error("[boot] Proxy start failed:", e);
    console.warn("[boot] Server will start but proxy relay will not work");
  }

  // 6. Start HTTP
  app.listen(config.port, () => {
    console.log(`[boot] Server listening on port ${config.port}`);
    console.log(`[boot] POST /command  — voice command endpoint`);
    console.log(`[boot] GET  /status   — device states`);
    console.log(`[boot] GET  /devices  — room mapping`);
    console.log(`[boot] GET  /saves    — saved shortcuts`);
    console.log(`[boot] POST /dns/enable  — enable DNS override`);
    console.log(`[boot] POST /dns/disable — disable DNS override`);
    console.log(`[boot] GET  /dns/status  — DNS override status`);
  });
}

start().catch((e) => {
  console.error("[boot] Fatal error:", e);
  process.exit(1);
});
