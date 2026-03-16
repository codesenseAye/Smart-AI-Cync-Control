import mqtt from "mqtt";
import { config } from "../config.js";
import type { DeviceState } from "../types/index.js";

type CommandHandler = (
  deviceId: number,
  command: { state?: "ON" | "OFF"; brightness?: number; color_temp?: number; color?: { r: number; g: number; b: number }; effect?: string },
) => boolean;

class MqttService {
  private client: mqtt.MqttClient | null = null;
  private stateCache = new Map<string, DeviceState>();
  private connected = false;
  private topicPrefix: string;
  private commandHandler: CommandHandler | null = null;

  constructor() {
    this.topicPrefix = config.mqtt.topic;
  }

  /** Register a handler for MQTT set commands (used by proxy for command routing). */
  onCommand(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const opts: mqtt.IClientOptions = {};
      if (config.mqtt.username) opts.username = config.mqtt.username;
      if (config.mqtt.password) opts.password = config.mqtt.password;
      opts.connectTimeout = 10_000;
      opts.reconnectPeriod = 5_000;

      this.client = mqtt.connect(config.mqtt.brokerUrl, opts);

      const timeout = setTimeout(() => {
        reject(new Error(`MQTT connection timeout to ${config.mqtt.brokerUrl}`));
      }, 10_000);

      this.client.on("connect", () => {
        clearTimeout(timeout);
        this.connected = true;
        console.log(`[mqtt] Connected to ${config.mqtt.brokerUrl}`);

        // Subscribe to all device status updates
        this.client!.subscribe(`${this.topicPrefix}/status/#`, (err) => {
          if (err) {
            console.error("[mqtt] Subscribe error:", err);
          } else {
            console.log(
              `[mqtt] Subscribed to ${this.topicPrefix}/status/#`
            );
          }
        });

        // Subscribe to set commands (route through proxy)
        this.client!.subscribe(`${this.topicPrefix}/set/#`, (err) => {
          if (err) {
            console.error("[mqtt] Subscribe to set/# error:", err);
          } else {
            console.log(`[mqtt] Subscribed to ${this.topicPrefix}/set/# (proxy command routing)`);
          }
        });

        resolve();
      });

      this.client.on("message", (topic, payload) => {
        this.handleMessage(topic, payload.toString());
      });

      this.client.on("error", (err) => {
        console.error("[mqtt] Error:", err.message);
      });

      this.client.on("offline", () => {
        this.connected = false;
        console.warn("[mqtt] Client offline");
      });

      this.client.on("reconnect", () => {
        console.log("[mqtt] Reconnecting...");
      });
    });
  }

  private handleMessage(topic: string, payload: string): void {
    const parts = topic.split("/");
    if (parts[0] !== this.topicPrefix) return;

    if (parts[1] === "status") {
      const deviceId = parts[2];
      if (!deviceId || !deviceId.includes("-")) return;
      if (deviceId === "bridge") return;

      try {
        const state = JSON.parse(payload) as DeviceState;
        this.stateCache.set(deviceId, state);
      } catch {
        if (payload === "ON" || payload === "OFF") {
          this.stateCache.set(deviceId, { state: payload });
        }
      }
    } else if (parts[1] === "set" && this.commandHandler) {
      const deviceId = parts[2];
      if (!deviceId || !deviceId.includes("-")) return;

      // Extract numeric device ID (after the dash)
      const numericId = parseInt(deviceId.split("-")[1], 10);
      if (isNaN(numericId)) return;

      try {
        const command = JSON.parse(payload);
        this.commandHandler(numericId, command);
      } catch {
        console.warn(`[mqtt] Failed to parse set command for ${deviceId}`);
      }
    }
  }

  publish(deviceId: string, payload: Record<string, unknown>): void {
    if (!this.client || !this.connected) {
      console.error("[mqtt] Cannot publish: not connected");
      return;
    }
    const topic = `${this.topicPrefix}/set/${deviceId}`;
    const msg = JSON.stringify(payload);
    this.client.publish(topic, msg);
    console.log(`[mqtt] Published to ${topic}: ${msg}`);
  }

  /** Publish device state (used by proxy to report status from parsed packets). */
  publishState(deviceId: string, state: Record<string, unknown>): void {
    if (!this.client || !this.connected) return;
    const topic = `${this.topicPrefix}/status/${deviceId}`;
    const msg = JSON.stringify(state);
    this.client.publish(topic, msg, { retain: true });
  }

  getState(deviceId: string): DeviceState | undefined {
    return this.stateCache.get(deviceId);
  }

  getAllStates(): Map<string, DeviceState> {
    return new Map(this.stateCache);
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const mqttService = new MqttService();
