// This file runs in the renderer process.
// It is compiled to JS and loaded by index.html.
export {};

declare global {
  interface Window {
    api: {
      sendCommand: (text: string) => Promise<any>;
      getStatuses: () => Promise<Array<{ service: string; status: string }>>;
      getSaves: () => Promise<any>;
      onServiceStatus: (cb: (data: { service: string; status: string; detail?: string }) => void) => void;
      onServerLog: (cb: (data: { line: string; stream: "stdout" | "stderr" }) => void) => void;
    };
  }
}

// --- Navigation ---
const menuBtn = document.getElementById("menu-btn") as HTMLButtonElement;
const menuNav = document.getElementById("menu-nav") as HTMLElement;
const menuItems = document.querySelectorAll(".menu-item") as NodeListOf<HTMLButtonElement>;
const pages = document.querySelectorAll(".page") as NodeListOf<HTMLElement>;

menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  menuNav.classList.toggle("hidden");
  menuBtn.classList.toggle("open");
});

// Close menu when clicking outside
document.addEventListener("click", () => {
  menuNav.classList.add("hidden");
  menuBtn.classList.remove("open");
});

menuNav.addEventListener("click", (e) => e.stopPropagation());

menuItems.forEach((item) => {
  item.addEventListener("click", () => {
    const pageId = item.dataset.page!;
    navigateTo(pageId);
    menuNav.classList.add("hidden");
    menuBtn.classList.remove("open");
  });
});

function navigateTo(pageId: string): void {
  pages.forEach((p) => p.classList.remove("active"));
  menuItems.forEach((m) => m.classList.remove("active"));

  const page = document.getElementById(`page-${pageId}`);
  const menuItem = document.querySelector(`.menu-item[data-page="${pageId}"]`);
  if (page) page.classList.add("active");
  if (menuItem) menuItem.classList.add("active");

  if (pageId === "saves") loadSaves();
}

// --- Home page: Service status updates ---
const commandInput = document.getElementById("command-input") as HTMLInputElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const commandResult = document.getElementById("command-result") as HTMLDivElement;
const logOutput = document.getElementById("log-output") as HTMLPreElement;

const MAX_LOG_LINES = 1000;
let logLineCount = 0;

window.api.onServiceStatus((data) => {
  const row = document.querySelector(`.service-row[data-service="${data.service}"]`);
  if (!row) return;

  const dot = row.querySelector(".status-dot") as HTMLElement;
  const detail = row.querySelector(".service-detail") as HTMLElement;

  dot.className = `status-dot ${data.status}`;
  detail.textContent = data.detail || data.status;
});

// Fetch initial statuses
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

// --- Server logs ---
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

// --- Command submission ---
async function sendCommand(): Promise<void> {
  const text = commandInput.value.trim();
  if (!text) return;

  sendBtn.disabled = true;
  commandResult.classList.remove("hidden", "ok", "err");
  commandResult.textContent = "Sending...";
  commandResult.classList.add("ok");

  try {
    const result = await window.api.sendCommand(text);
    if (result.ok) {
      commandResult.classList.add("ok");
      commandResult.classList.remove("err");
      const display = result.interpreted
        ? JSON.stringify(result.interpreted, null, 2)
        : JSON.stringify(result, null, 2);
      commandResult.textContent = display;
    } else {
      commandResult.classList.add("err");
      commandResult.classList.remove("ok");
      commandResult.textContent = result.error || "Unknown error";
    }
  } catch (err: any) {
    commandResult.classList.add("err");
    commandResult.classList.remove("ok");
    commandResult.textContent = err.message || "Failed to send command";
  } finally {
    sendBtn.disabled = false;
    commandInput.value = "";
    commandInput.focus();
  }
}

sendBtn.addEventListener("click", sendCommand);
commandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendCommand();
});

commandInput.focus();

// --- Saves page ---
async function loadSaves(): Promise<void> {
  const savesList = document.getElementById("saves-list") as HTMLDivElement;
  savesList.innerHTML = '<p class="empty-msg">Loading...</p>';

  try {
    const saves = await window.api.getSaves();
    if (!Array.isArray(saves) || saves.length === 0) {
      savesList.innerHTML = '<p class="empty-msg">No saved presets</p>';
      return;
    }

    savesList.innerHTML = "";
    for (const save of saves) {
      const card = document.createElement("div");
      card.className = "save-card";

      const header = document.createElement("div");
      header.className = "save-card-header";

      const name = document.createElement("span");
      name.className = "save-card-name";
      name.textContent = save.name;

      const room = document.createElement("span");
      room.className = "save-card-room";
      room.textContent = save.room || "all";

      header.appendChild(name);
      header.appendChild(room);
      card.appendChild(header);

      if (save.created_at) {
        const date = document.createElement("div");
        date.className = "save-card-date";
        date.textContent = new Date(save.created_at).toLocaleString();
        card.appendChild(date);
      }

      if (Array.isArray(save.states) && save.states.length > 0) {
        const devices = document.createElement("div");
        devices.className = "save-card-devices";

        for (const state of save.states) {
          const chip = document.createElement("span");
          chip.className = "save-device-chip";

          if (state.color) {
            const dot = document.createElement("span");
            dot.className = "chip-color";
            dot.style.background = `rgb(${state.color.r},${state.color.g},${state.color.b})`;
            chip.appendChild(dot);
          }

          const label = state.state === "OFF"
            ? `${state.deviceId} OFF`
            : `${state.deviceId} ${state.brightness ?? ""}%`;
          chip.appendChild(document.createTextNode(label));
          devices.appendChild(chip);
        }

        card.appendChild(devices);
      }

      savesList.appendChild(card);
    }
  } catch (err: any) {
    savesList.innerHTML = `<p class="empty-msg">Failed to load saves: ${err.message}</p>`;
  }
}
