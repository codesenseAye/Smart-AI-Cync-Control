import mqtt from "mqtt";
import { config } from "../config.js";
import type { DeviceState } from "../types/index.js";

class MqttService {
  private client: mqtt.MqttClient | null = null;
  private stateCache = new Map<string, DeviceState>();
  private connected = false;
  private topicPrefix: string;

  constructor() {
    this.topicPrefix = config.mqtt.topic;
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
    // cync_lan/status/{device_id}
    if (parts[0] !== this.topicPrefix || parts[1] !== "status") return;

    const deviceId = parts[2];
    if (!deviceId || !deviceId.includes("-")) return;
    // Skip bridge/system topics like status/bridge/...
    if (deviceId === "bridge") return;

    try {
      const state = JSON.parse(payload) as DeviceState;
      this.stateCache.set(deviceId, state);
    } catch {
      // Some devices publish plain text "ON"/"OFF"
      if (payload === "ON" || payload === "OFF") {
        this.stateCache.set(deviceId, { state: payload });
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
