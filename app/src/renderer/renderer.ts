// This file runs in the renderer process.
// It is compiled to JS and loaded by index.html.
export {};

declare global {
  interface Window {
    api: {
      sendCommand: (text: string) => Promise<any>;
      getStatuses: () => Promise<Array<{ service: string; status: string }>>;
      getRooms: () => Promise<any>;
      pollDevices: () => Promise<any>;
      getMesh: () => Promise<any>;
      getConfig: () => Promise<any>;
      getSettingsRooms: () => Promise<any>;
      openFile: (path: string) => Promise<any>;
      cloudRequestOtp: (email: string) => Promise<any>;
      cloudSync: (email: string, password: string, otp: string) => Promise<any>;
      moveDevice: (deviceId: string, fromRoom: string, toRoom: string) => Promise<any>;
      onServiceStatus: (cb: (data: { service: string; status: string; detail?: string }) => void) => void;
      onServerLog: (cb: (data: { line: string; stream: "stdout" | "stderr" }) => void) => void;
      onDeviceEvent: (cb: (data: { kind: string; deviceId: string; data: Record<string, unknown> }) => void) => void;
    };
  }
}

// ============ Navigation ============

const tabItems = document.querySelectorAll(".tab-item") as NodeListOf<HTMLButtonElement>;
const pages = document.querySelectorAll(".page") as NodeListOf<HTMLElement>;

tabItems.forEach((item) => {
  item.addEventListener("click", () => {
    const pageId = item.dataset.page!;
    navigateTo(pageId);
  });
});

function navigateTo(pageId: string): void {
  pages.forEach((p) => p.classList.remove("active"));
  tabItems.forEach((t) => t.classList.remove("active"));

  const page = document.getElementById(`page-${pageId}`);
  const tab = document.querySelector(`.tab-item[data-page="${pageId}"]`);
  if (page) page.classList.add("active");
  if (tab) tab.classList.add("active");

  if (pageId === "settings") loadSettings();
}

// ============ Room Config ============

let roomsConfig: { home_id?: string; rooms?: Record<string, any> } = {};

window.api.getRooms().then((rooms) => {
  roomsConfig = rooms || {};
}).catch(() => {});

function resolveDeviceInfo(deviceId: string): { room: string; device: string } {
  const parts = deviceId.split("-");
  const numericId = parts.length >= 2 ? parts[parts.length - 1] : deviceId;

  const rooms = roomsConfig.rooms || {};
  for (const [roomName, roomConfig] of Object.entries(rooms) as [string, any][]) {
    const devices = roomConfig.devices;
    if (!devices) continue;

    if (Array.isArray(devices)) {
      if (devices.includes(parseInt(numericId, 10))) {
        return { room: roomName, device: numericId };
      }
    } else {
      if (numericId in devices) {
        const info = devices[numericId];
        return { room: roomName, device: info?.name || numericId };
      }
    }
  }

  return { room: "unknown", device: numericId };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ============ Home: Command Input ============

const commandInput = document.getElementById("command-input") as HTMLInputElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const commandError = document.getElementById("command-error") as HTMLDivElement;
const eventFeed = document.getElementById("event-feed") as HTMLDivElement;

const MAX_FEED_ITEMS = 200;
let feedItemCount = 0;
let errorTimeout: ReturnType<typeof setTimeout> | null = null;

async function sendCommand(): Promise<void> {
  const text = commandInput.value.trim();
  if (!text) return;

  sendBtn.disabled = true;
  commandError.classList.add("hidden");

  try {
    const result = await window.api.sendCommand(text);
    if (result.ok) {
      if (result.interpreted) {
        addSentItem(result.interpreted);
      }
      commandInput.value = "";
    } else {
      showCommandError(result.error || "Unknown error");
    }
  } catch (err: any) {
    showCommandError(err.message || "Failed to send command");
  } finally {
    sendBtn.disabled = false;
    commandInput.focus();
  }
}

function showCommandError(msg: string): void {
  commandError.textContent = msg;
  commandError.classList.remove("hidden");
  if (errorTimeout) clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => commandError.classList.add("hidden"), 5000);
}

sendBtn.addEventListener("click", sendCommand);
commandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendCommand();
});

commandInput.focus();

// ============ Home: Device Event Feed ============

function formatStatusPretty(data: Record<string, unknown>): string {
  const parts: string[] = [];

  if (data.state) parts.push(String(data.state));
  if (data.brightness !== undefined) parts.push(`${data.brightness}%`);

  if (data.color_mode === "rgb" && data.color) {
    const c = data.color as { r: number; g: number; b: number };
    parts.push(
      `<span class="color-swatch" style="background:rgb(${c.r},${c.g},${c.b})"></span>RGB(${c.r}, ${c.g}, ${c.b})`,
    );
  } else if (data.color_temp !== undefined) {
    parts.push(`${data.color_temp}K`);
  }

  if (data.effect) parts.push(String(data.effect));

  return parts.join(' <span class="sep">&middot;</span> ') || "&mdash;";
}

function formatSentPretty(cmd: any): string {
  if (!cmd || !cmd.type) return "Unknown command";

  switch (cmd.type) {
    case "power":
      return cmd.state || "toggle";
    case "simple": {
      const p: string[] = [];
      if (cmd.brightness !== undefined) p.push(`${cmd.brightness}%`);
      if (cmd.color_temp_kelvin) p.push(`${cmd.color_temp_kelvin}K`);
      if (cmd.rgb) p.push(`RGB(${cmd.rgb.r}, ${cmd.rgb.g}, ${cmd.rgb.b})`);
      return p.join(" &middot; ") || "set";
    }
    case "effect":
      return cmd.effect || "effect";
    case "complex":
      return `${cmd.sequence?.length || 0}-step sequence`;
    case "recall":
      return `recall &ldquo;${cmd.name}&rdquo;`;
    default:
      return cmd.type;
  }
}

function deriveTypeLabel(data: any): string {
  if (data.effect) return "effect";
  if (data.color_mode === "rgb") return "color";
  if (data.color_temp !== undefined) return "temp";
  if (data.brightness !== undefined && data.state !== "OFF") return "simple";
  return "power";
}

function createFeedItem(
  kind: "sent" | "status",
  label: string,
  prettyHtml: string,
  jsonData: any,
  typeLabel: string,
): HTMLElement {
  const item = document.createElement("div");
  item.className = "event-item";

  const header = document.createElement("div");
  header.className = "event-header";

  const badge = document.createElement("span");
  badge.className = `event-badge ${kind}`;
  badge.textContent = typeLabel;

  const labelEl = document.createElement("span");
  labelEl.className = "event-label";
  labelEl.textContent = label;

  const time = document.createElement("span");
  time.className = "event-time";
  time.textContent = new Date().toLocaleTimeString();

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "event-toggle";
  toggleBtn.textContent = "JSON";

  header.appendChild(badge);
  header.appendChild(labelEl);
  header.appendChild(time);
  header.appendChild(toggleBtn);

  const prettyBody = document.createElement("div");
  prettyBody.className = "event-body pretty";
  prettyBody.innerHTML = prettyHtml;

  const jsonBody = document.createElement("div");
  jsonBody.className = "event-body json hidden";
  jsonBody.textContent = JSON.stringify(jsonData, null, 2);

  toggleBtn.addEventListener("click", () => {
    const showingPretty = !prettyBody.classList.contains("hidden");
    prettyBody.classList.toggle("hidden", showingPretty);
    jsonBody.classList.toggle("hidden", !showingPretty);
    toggleBtn.textContent = showingPretty ? "Pretty" : "JSON";
  });

  item.appendChild(header);
  item.appendChild(prettyBody);
  item.appendChild(jsonBody);

  return item;
}

function addFeedItem(item: HTMLElement): void {
  const emptyMsg = eventFeed.querySelector(".empty-msg");
  if (emptyMsg) emptyMsg.remove();

  eventFeed.prepend(item);
  feedItemCount++;

  while (feedItemCount > MAX_FEED_ITEMS && eventFeed.lastElementChild) {
    eventFeed.removeChild(eventFeed.lastElementChild);
    feedItemCount--;
  }
}

function addSentItem(interpreted: any): void {
  const room = interpreted.room || "all";
  const label = capitalize(room);
  const prettyHtml = formatSentPretty(interpreted);
  const typeLabel = interpreted.type || "command";
  addFeedItem(createFeedItem("sent", label, prettyHtml, interpreted, typeLabel));
}

window.api.onDeviceEvent((event) => {
  const { room, device } = resolveDeviceInfo(event.deviceId);
  const label = `${capitalize(room)} \u00b7 ${device}`;
  const prettyHtml = formatStatusPretty(event.data);
  const typeLabel = deriveTypeLabel(event.data);
  const kind = event.kind === "command" ? "sent" : "status";
  addFeedItem(createFeedItem(kind, label, prettyHtml, event.data, typeLabel));
});

// ============ Home: Device State Polling ============
// Polls GET /status every 2s and diffs device states.
// This is the primary mechanism for showing device activity — it works
// regardless of the @@EVENT stdout pipeline.

const lastPolledStates = new Map<string, string>();
let pollReady = false;

async function pollDeviceStates(): Promise<void> {
  try {
    const status = await window.api.pollDevices();
    if (!status || typeof status.devices !== "object") return;

    const devices = status.devices as Record<string, Record<string, unknown>>;
    for (const [deviceId, state] of Object.entries(devices)) {
      const json = JSON.stringify(state);
      const prev = lastPolledStates.get(deviceId);

      if (prev !== json) {
        lastPolledStates.set(deviceId, json);
        if (pollReady) {
          const { room, device } = resolveDeviceInfo(deviceId);
          const label = `${capitalize(room)} \u00b7 ${device}`;
          const prettyHtml = formatStatusPretty(state);
          const typeLabel = deriveTypeLabel(state);
          addFeedItem(createFeedItem("status", label, prettyHtml, state, typeLabel));
        }
      }
    }
    pollReady = true;
  } catch { /* server not ready yet */ }
}

// Start polling after a short delay to let the server boot
setTimeout(() => {
  pollDeviceStates();
  setInterval(pollDeviceStates, 2000);
}, 5000);

// ============ Server: Service Status ============

window.api.onServiceStatus((data) => {
  const row = document.querySelector(`.service-row[data-service="${data.service}"]`);
  if (!row) return;

  const dot = row.querySelector(".status-dot") as HTMLElement;
  const detail = row.querySelector(".service-detail") as HTMLElement;

  dot.className = `status-dot ${data.status}`;
  detail.textContent = data.detail || data.status;
});

window.api.getStatuses().then((statuses) => {
  for (const s of statuses) {
    const row = document.querySelector(`.service-row[data-service="${s.service}"]`);
    if (!row) continue;
    const dot = row.querySelector(".status-dot") as HTMLElement;
    const detail = row.querySelector(".service-detail") as HTMLElement;
    dot.className = `status-dot ${s.status}`;
    detail.textContent = s.status;
  }
});

// ============ Server: Logs ============

const logOutput = document.getElementById("log-output") as HTMLPreElement;
const MAX_LOG_LINES = 1000;
let logLineCount = 0;

window.api.onServerLog((data) => {
  const span = document.createElement("span");
  span.className = data.stream === "stderr" ? "log-stderr" : "log-stdout";
  span.textContent = data.line + "\n";
  logOutput.appendChild(span);
  logLineCount++;

  while (logLineCount > MAX_LOG_LINES && logOutput.firstChild) {
    logOutput.removeChild(logOutput.firstChild);
    logLineCount--;
  }

  logOutput.scrollTop = logOutput.scrollHeight;
});

// ============ Settings ============

let meshPath = "";
let configPath = "";
let roomsPath = "";

async function loadSettings(): Promise<void> {
  await Promise.all([loadMeshDevices(), loadRoomsConfig(), loadConfigEntries()]);
}

async function loadMeshDevices(): Promise<void> {
  const container = document.getElementById("mesh-devices") as HTMLDivElement;

  try {
    const result = await window.api.getMesh();
    meshPath = result.path || "";
    if (!result.ok || !result.devices.length) {
      container.innerHTML = '<p class="empty-msg">No devices found</p>';
      return;
    }

    container.innerHTML = "";
    const table = document.createElement("table");
    table.className = "settings-table";
    table.innerHTML = `<thead><tr>
      <th>ID</th><th>Name</th><th>RGB</th><th>Temp</th><th>FW</th>
    </tr></thead>`;
    const tbody = document.createElement("tbody");
    for (const d of result.devices) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${d.id}</td><td>${d.name}</td>`
        + `<td class="${d.supports_rgb ? "cap-yes" : "cap-no"}">${d.supports_rgb ? "Yes" : "No"}</td>`
        + `<td class="${d.supports_temperature ? "cap-yes" : "cap-no"}">${d.supports_temperature ? "Yes" : "No"}</td>`
        + `<td>${d.fw || "-"}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  } catch {
    container.innerHTML = '<p class="empty-msg">Failed to load devices</p>';
  }
}

async function loadRoomsConfig(): Promise<void> {
  const container = document.getElementById("rooms-config") as HTMLDivElement;

  try {
    const result = await window.api.getSettingsRooms();
    roomsPath = result.path || "";
    if (!result.ok || !result.data) {
      container.innerHTML = '<p class="empty-msg">No rooms configured</p>';
      return;
    }

    container.innerHTML = "";
    const rooms = result.data.rooms || {};
    if (Object.keys(rooms).length === 0) {
      container.innerHTML = '<p class="empty-msg">No rooms configured</p>';
      return;
    }

    for (const [roomName, roomConfig] of Object.entries(rooms) as [string, any][]) {
      const card = document.createElement("div");
      card.className = "room-card";
      card.dataset.room = roomName;

      const header = document.createElement("div");
      header.className = "room-card-header";
      header.textContent = capitalize(roomName);

      if (roomConfig.aliases && roomConfig.aliases.length) {
        const aliases = document.createElement("span");
        aliases.className = "room-aliases";
        aliases.textContent = roomConfig.aliases.join(", ");
        header.appendChild(aliases);
      }

      card.appendChild(header);

      const devices = roomConfig.devices || {};
      const deviceEntries = typeof devices === "object" && !Array.isArray(devices)
        ? Object.entries(devices) : [];

      const chips = document.createElement("div");
      chips.className = "room-devices";

      // Drop zone
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        card.classList.add("drag-over");
      });
      card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
      card.addEventListener("drop", async (e) => {
        e.preventDefault();
        card.classList.remove("drag-over");
        const deviceId = e.dataTransfer?.getData("text/device-id");
        const fromRoom = e.dataTransfer?.getData("text/from-room");
        if (!deviceId || !fromRoom || fromRoom === roomName) return;

        const result = await window.api.moveDevice(deviceId, fromRoom, roomName);
        if (result.ok) loadRoomsConfig();
      });

      if (deviceEntries.length) {
        for (const [id, info] of deviceEntries as [string, any][]) {
          const chip = document.createElement("span");
          chip.className = "room-device-chip";
          chip.draggable = true;
          chip.dataset.deviceId = id;
          chip.dataset.room = roomName;
          const name = typeof info === "object" && info?.name ? info.name : `Device ${id}`;
          chip.textContent = `${id}: ${name}`;

          chip.addEventListener("dragstart", (e) => {
            e.dataTransfer!.setData("text/device-id", id);
            e.dataTransfer!.setData("text/from-room", roomName);
            e.dataTransfer!.effectAllowed = "move";
            chip.classList.add("dragging");
          });
          chip.addEventListener("dragend", () => chip.classList.remove("dragging"));

          chips.appendChild(chip);
        }
      } else if (Array.isArray(devices)) {
        for (const id of devices) {
          const chip = document.createElement("span");
          chip.className = "room-device-chip";
          chip.textContent = String(id);
          chips.appendChild(chip);
        }
      }

      card.appendChild(chips);
      container.appendChild(card);
    }
  } catch {
    container.innerHTML = '<p class="empty-msg">Failed to load rooms</p>';
  }
}

async function loadConfigEntries(): Promise<void> {
  const container = document.getElementById("config-entries") as HTMLDivElement;
  container.innerHTML = '<p class="empty-msg">Loading...</p>';

  try {
    const result = await window.api.getConfig();
    configPath = result.path || "";
    if (!result.ok || !result.entries.length) {
      container.innerHTML = '<p class="empty-msg">No configuration found</p>';
      return;
    }

    container.innerHTML = "";
    const table = document.createElement("table");
    table.className = "settings-table config-table";
    const tbody = document.createElement("tbody");
    for (const entry of result.entries) {
      if (entry.comment) continue;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="config-key">${entry.key}</td><td class="config-val">${entry.value}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  } catch {
    container.innerHTML = '<p class="empty-msg">Failed to load configuration</p>';
  }
}

// Refresh buttons — spin icon and highlight while loading
function refreshWith(btn: HTMLButtonElement, fn: () => Promise<void>): void {
  btn.addEventListener("click", async () => {
    if (btn.classList.contains("refreshing")) return;
    btn.classList.add("refreshing");
    try {
      await fn();
    } finally {
      setTimeout(() => btn.classList.remove("refreshing"), 400);
    }
  });
}

refreshWith(document.getElementById("mesh-refresh-btn") as HTMLButtonElement, loadMeshDevices);
refreshWith(document.getElementById("rooms-refresh-btn") as HTMLButtonElement, loadRoomsConfig);

// Open file buttons
document.getElementById("mesh-open-btn")!.addEventListener("click", () => {
  if (meshPath) window.api.openFile(meshPath);
});
document.getElementById("rooms-open-btn")!.addEventListener("click", () => {
  if (roomsPath) window.api.openFile(roomsPath);
});
document.getElementById("config-open-btn")!.addEventListener("click", () => {
  if (configPath) window.api.openFile(configPath);
});

// ============ Cloud Sync ============

const syncPanel = document.getElementById("cloud-sync-panel") as HTMLDivElement;
const syncStepEmail = document.getElementById("sync-step-email") as HTMLDivElement;
const syncStepAuth = document.getElementById("sync-step-auth") as HTMLDivElement;
const syncStatus = document.getElementById("sync-status") as HTMLDivElement;
const syncEmailInput = document.getElementById("sync-email") as HTMLInputElement;
const syncPasswordInput = document.getElementById("sync-password") as HTMLInputElement;
const syncOtpInput = document.getElementById("sync-otp") as HTMLInputElement;
const syncOtpBtn = document.getElementById("sync-otp-btn") as HTMLButtonElement;
const syncGoBtn = document.getElementById("sync-go-btn") as HTMLButtonElement;

document.getElementById("cloud-sync-btn")!.addEventListener("click", () => {
  syncPanel.classList.toggle("hidden");
  // Reset to step 1
  syncStepEmail.classList.remove("hidden");
  syncStepAuth.classList.add("hidden");
  syncStatus.classList.add("hidden");
});

function showSyncStatus(msg: string, isError = false): void {
  syncStatus.textContent = msg;
  syncStatus.className = `sync-status ${isError ? "sync-error" : "sync-info"}`;
  syncStatus.classList.remove("hidden");
}

syncOtpBtn.addEventListener("click", async () => {
  const email = syncEmailInput.value.trim();
  if (!email) return;

  syncOtpBtn.disabled = true;
  syncOtpBtn.textContent = "Sending...";
  showSyncStatus("Requesting OTP...");

  try {
    const result = await window.api.cloudRequestOtp(email);
    if (result.ok) {
      showSyncStatus("OTP sent! Check your email.");
      syncStepAuth.classList.remove("hidden");
    } else {
      showSyncStatus(result.error || "Failed to send OTP", true);
    }
  } catch (err: any) {
    showSyncStatus(err.message || "Failed to send OTP", true);
  } finally {
    syncOtpBtn.disabled = false;
    syncOtpBtn.textContent = "Send OTP";
  }
});

syncGoBtn.addEventListener("click", async () => {
  const email = syncEmailInput.value.trim();
  const password = syncPasswordInput.value;
  const otp = syncOtpInput.value.trim();
  if (!email || !password || !otp) return;

  syncGoBtn.disabled = true;
  syncGoBtn.textContent = "Syncing...";
  showSyncStatus("Authenticating and fetching devices...");

  try {
    const result = await window.api.cloudSync(email, password, otp);
    if (result.ok) {
      showSyncStatus(`Synced ${result.deviceCount} devices into ${result.roomCount} rooms`);
      // Reload settings
      await Promise.all([loadMeshDevices(), loadRoomsConfig()]);
      // Collapse panel after success
      setTimeout(() => syncPanel.classList.add("hidden"), 2000);
    } else {
      showSyncStatus(result.error || "Sync failed", true);
    }
  } catch (err: any) {
    showSyncStatus(err.message || "Sync failed", true);
  } finally {
    syncGoBtn.disabled = false;
    syncGoBtn.textContent = "Sync";
  }
});
