/**
 * Transparent TLS MITM proxy between Cync devices and the real cloud server.
 * Relays all traffic bidirectionally while tapping into the stream for:
 * - State tracking (0x43/0x83 status packets → MQTT publish)
 * - Local command injection (MQTT set → 0x73 control packets)
 */

import tls from "node:tls";
import { Resolver } from "node:dns/promises";
import selfsigned from "selfsigned";
import { config } from "../config.js";
import { mqttService } from "./mqtt.js";
import {
  PKT,
  pktName,
  extractPackets,
  parseStatusBroadcast,
  parseInternalStatus,
  CtrlCounter,
  buildPowerCmd,
  buildBrightnessCmd,
  buildTemperatureCmd,
  buildRGBCmd,
  buildEffectCmd,
  kelvinToTemp,
  tempToKelvin,
  type DeviceStatusUpdate,
} from "./protocol.js";

const TLS_CIPHERS = [
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES256-SHA384",
  "ECDHE-RSA-AES128-SHA256",
  "ECDHE-RSA-AES256-SHA",
  "ECDHE-RSA-AES128-SHA",
  "AES256-GCM-SHA384",
  "AES128-GCM-SHA256",
  "AES256-SHA256",
  "AES128-SHA256",
  "AES256-SHA",
  "AES128-SHA",
].join(":");

// --- Per-connection state ---

class ProxyConnection {
  private deviceBuffer: Buffer = Buffer.alloc(0);
  private cloudBuffer: Buffer = Buffer.alloc(0);
  private ctrlCounter = new CtrlCounter();
  private _queueId: Buffer | null = null;
  private _readyToControl = false;
  readonly knownDeviceIds = new Set<number>();
  readonly deviceAddr: string;
  private readonly tag: string;

  constructor(
    private deviceSocket: tls.TLSSocket,
    private cloudSocket: tls.TLSSocket,
  ) {
    this.deviceAddr = deviceSocket.remoteAddress ?? "unknown";
    // Short tag for log lines (last octet of IP)
    const parts = this.deviceAddr.replace("::ffff:", "").split(".");
    this.tag = parts.length >= 4 ? `dev:${parts[3]}` : this.deviceAddr;

    deviceSocket.on("data", (data: Buffer) => this.onDeviceData(data));
    cloudSocket.on("data", (data: Buffer) => this.onCloudData(data));

    deviceSocket.on("close", () => this.close("device closed"));
    cloudSocket.on("close", () => this.close("cloud closed"));
    deviceSocket.on("error", (err) => {
      console.error(`[proxy] Device ${this.deviceAddr} error:`, err.message);
      this.close("device error");
    });
    cloudSocket.on("error", (err) => {
      console.error(`[proxy] Cloud connection for ${this.deviceAddr} error:`, err.message);
      this.close("cloud error");
    });
  }

  get queueId(): Buffer | null {
    return this._queueId;
  }

  get readyToControl(): boolean {
    return this._readyToControl;
  }

  /** Handle data from the Cync device. Parse for state, then relay to cloud. */
  private onDeviceData(data: Buffer): void {
    // Always relay raw bytes to cloud first (transparent proxy)
    if (!this.cloudSocket.destroyed) {
      this.cloudSocket.write(data);
    }

    // Now tap into the stream for state tracking
    this.deviceBuffer = Buffer.concat([this.deviceBuffer, data]);
    const { packets, remainder } = extractPackets(this.deviceBuffer);
    this.deviceBuffer = remainder;

    for (const pkt of packets) {
      const type = pkt[0];

      if (type === PKT.AUTH && pkt.length >= 10) {
        this._queueId = Buffer.from(pkt.subarray(6, 10));
        console.log(`[proxy] ${this.tag} >> AUTH queue_id=${this._queueId.toString("hex")}`);
      } else if (type === PKT.APP_ANNOUNCE_ACK) {
        this._readyToControl = true;
        console.log(`[proxy] ${this.tag} >> APP_ANN_ACK (ready to control)`);
      } else if (type === PKT.STATUS_BROADCAST) {
        const updates = parseStatusBroadcast(pkt);
        if (updates.length > 0) {
          const summary = updates.map((u) => `${u.deviceId}:${u.power ? "ON" : "OFF"}@${u.brightness}%`).join(", ");
          console.log(`[proxy] ${this.tag} >> STATUS [${summary}]`);
        }
        for (const u of updates) {
          this.knownDeviceIds.add(u.deviceId);
          this.publishState(u);
        }
      } else if (type === PKT.STATUS_INTERNAL) {
        const update = parseInternalStatus(pkt);
        if (update) {
          console.log(`[proxy] ${this.tag} >> STATUS_INT ${update.deviceId}:${update.power ? "ON" : "OFF"}@${update.brightness}%`);
          this.knownDeviceIds.add(update.deviceId);
          this.publishState(update);
        }
      } else if (type !== PKT.PING) {
        console.log(`[proxy] ${this.tag} >> ${pktName(type)} (${pkt.length}B)`);
      }
    }
  }

  /** Handle data from the cloud. Parse for logging, then relay to device. */
  private onCloudData(data: Buffer): void {
    if (!this.deviceSocket.destroyed) {
      this.deviceSocket.write(data);
    }

    // Parse cloud packets for logging
    this.cloudBuffer = Buffer.concat([this.cloudBuffer, data]);
    const { packets, remainder } = extractPackets(this.cloudBuffer);
    this.cloudBuffer = remainder;

    for (const pkt of packets) {
      const type = pkt[0];
      if (type === PKT.PONG || type === PKT.PING) continue;
      console.log(`[proxy] ${this.tag} << ${pktName(type)} (${pkt.length}B)`);
    }
  }

  /** Publish a device state update to MQTT. */
  private publishState(update: DeviceStatusUpdate): void {
    const homeId = config.rooms.home_id;
    const deviceId = `${homeId}-${update.deviceId}`;

    const state: Record<string, unknown> = {
      state: update.power ? "ON" : "OFF",
      brightness: update.brightness,
    };

    if (update.temperature === 0xfe || update.temperature > 100) {
      state.color_mode = "rgb";
      state.color = { r: update.r, g: update.g, b: update.b };
    } else {
      state.color_mode = "color_temp";
      state.color_temp = tempToKelvin(update.temperature);
    }

    mqttService.publishState(deviceId, state);
  }

  /** Inject a local command into the device's TCP connection. */
  injectCommand(packet: Buffer): void {
    if (this.deviceSocket.destroyed) {
      console.warn(`[proxy] Cannot inject: device socket destroyed`);
      return;
    }
    this.deviceSocket.write(packet);
  }

  /** Get the next control message ID for command injection. */
  nextCtrlId(): number {
    return this.ctrlCounter.next();
  }

  close(reason?: string): void {
    if (reason) {
      console.log(`[proxy] Closing ${this.deviceAddr}: ${reason}`);
    }
    if (!this.deviceSocket.destroyed) this.deviceSocket.destroy();
    if (!this.cloudSocket.destroyed) this.cloudSocket.destroy();
    proxyService.removeConnection(this.deviceAddr);
  }
}

// --- Main proxy service ---

class CyncProxy {
  private server: tls.Server | null = null;
  private connections = new Map<string, ProxyConnection>();
  private _running = false;
  private cloudHost = "";

  get running(): boolean {
    return this._running;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  async start(): Promise<void> {
    const proxyConfig = config.proxy;

    // Resolve real cloud IP via external DNS (local DNS may be overridden to point at us)
    const resolver = new Resolver();
    resolver.setServers([proxyConfig.dnsServer]);
    const addresses = await resolver.resolve4(proxyConfig.cloudDomain);
    if (addresses.length === 0) {
      throw new Error(`Failed to resolve ${proxyConfig.cloudDomain} via ${proxyConfig.dnsServer}`);
    }
    this.cloudHost = addresses[0];
    console.log(`[proxy] Resolved ${proxyConfig.cloudDomain} → ${this.cloudHost} via ${proxyConfig.dnsServer}`);

    // Auto-generate self-signed cert (CN must match the domain Cync devices expect)
    const pems = await selfsigned.generate(
      [{ name: "commonName", value: proxyConfig.cloudDomain }],
      { days: 3650, keySize: 2048 },
    );
    console.log("[proxy] Generated self-signed cert for", proxyConfig.cloudDomain);

    this.server = tls.createServer(
      {
        cert: pems.cert,
        key: pems.private,
        ciphers: TLS_CIPHERS,
        minVersion: "TLSv1.2",
        requestCert: false,
        rejectUnauthorized: false,
      },
      (deviceSocket) => this.handleDeviceConnection(deviceSocket),
    );

    return new Promise((resolve, reject) => {
      this.server!.listen(proxyConfig.port, () => {
        this._running = true;
        console.log(`[proxy] TLS proxy listening on port ${proxyConfig.port}`);
        console.log(`[proxy] Relaying to cloud: ${this.cloudHost}:${proxyConfig.cloudPort}`);
        resolve();
      });

      this.server!.on("error", (err) => {
        if (!this._running) {
          reject(err);
        } else {
          console.error("[proxy] Server error:", err.message);
        }
      });
    });
  }

  private handleDeviceConnection(deviceSocket: tls.TLSSocket): void {
    const addr = deviceSocket.remoteAddress ?? "unknown";
    console.log(`[proxy] New device connection from ${addr}`);

    // Close existing connection from this address
    const existing = this.connections.get(addr);
    if (existing) {
      console.log(`[proxy] Replacing existing connection from ${addr}`);
      existing.close();
    }

    // Open connection to real cloud
    const cloudSocket = tls.connect(
      {
        host: this.cloudHost,
        port: config.proxy.cloudPort,
        rejectUnauthorized: false,
      },
      () => {
        console.log(`[proxy] Cloud connection established for ${addr}`);
        const conn = new ProxyConnection(deviceSocket, cloudSocket);
        this.connections.set(addr, conn);
      },
    );

    cloudSocket.on("error", (err) => {
      console.error(`[proxy] Failed to connect to cloud for ${addr}:`, err.message);
      if (!deviceSocket.destroyed) deviceSocket.destroy();
    });
  }

  removeConnection(addr: string): void {
    this.connections.delete(addr);
  }

  /** Find a connection that knows about a specific device ID. */
  getConnectionForDevice(deviceId: number): ProxyConnection | null {
    // Prefer connection that has seen this device in status packets
    for (const conn of this.connections.values()) {
      if (conn.knownDeviceIds.has(deviceId) && conn.queueId) {
        return conn;
      }
    }
    // Fallback: any connection with a queueId (device mesh can relay commands)
    for (const conn of this.connections.values()) {
      if (conn.queueId) {
        return conn;
      }
    }
    return null;
  }

  /** Send a command to a device via the proxy. */
  sendCommand(
    deviceId: number,
    command: { state?: "ON" | "OFF"; brightness?: number; color_temp?: number; color?: { r: number; g: number; b: number }; effect?: string },
  ): boolean {
    const conn = this.getConnectionForDevice(deviceId);
    if (!conn || !conn.queueId) {
      console.warn(`[proxy] No ready connection for device ${deviceId}`);
      return false;
    }

    const queueId = conn.queueId;

    if (command.effect) {
      const ctrlId = conn.nextCtrlId();
      const pkt = buildEffectCmd(deviceId, command.effect, queueId, ctrlId);
      console.log(`[proxy] INJECT dev:${deviceId} effect=${command.effect}`);
      conn.injectCommand(pkt);
      return true;
    }

    if (command.color) {
      const ctrlId = conn.nextCtrlId();
      const pkt = buildRGBCmd(deviceId, command.color.r, command.color.g, command.color.b, queueId, ctrlId);
      console.log(`[proxy] INJECT dev:${deviceId} rgb=(${command.color.r},${command.color.g},${command.color.b})`);
      conn.injectCommand(pkt);
      return true;
    }

    if (command.color_temp !== undefined) {
      const temp = kelvinToTemp(command.color_temp);
      const ctrlId = conn.nextCtrlId();
      const pkt = buildTemperatureCmd(deviceId, temp, queueId, ctrlId);
      console.log(`[proxy] INJECT dev:${deviceId} temp=${command.color_temp}K`);
      conn.injectCommand(pkt);
      return true;
    }

    if (command.brightness !== undefined) {
      const ctrlId = conn.nextCtrlId();
      const pkt = buildBrightnessCmd(deviceId, command.brightness, queueId, ctrlId);
      console.log(`[proxy] INJECT dev:${deviceId} brightness=${command.brightness}%`);
      conn.injectCommand(pkt);
      return true;
    }

    if (command.state !== undefined) {
      const ctrlId = conn.nextCtrlId();
      const pkt = buildPowerCmd(deviceId, command.state === "ON" ? 1 : 0, queueId, ctrlId);
      console.log(`[proxy] INJECT dev:${deviceId} state=${command.state}`);
      conn.injectCommand(pkt);
      return true;
    }

    return false;
  }

  async stop(): Promise<void> {
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();

    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this._running = false;
          console.log("[proxy] TLS proxy stopped");
          resolve();
        });
      });
    }
  }
}

export const proxyService = new CyncProxy();
