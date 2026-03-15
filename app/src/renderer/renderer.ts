// This file runs in the renderer process.
// It is compiled to JS and loaded by index.html.
export {};

declare global {
  interface Window {
    api: {
      sendCommand: (text: string) => Promise<any>;
      getStatuses: () => Promise<Array<{ service: string; status: string }>>;
      onServiceStatus: (cb: (data: { service: string; status: string; detail?: string }) => void) => void;
      onServerLog: (cb: (data: { line: string; stream: "stdout" | "stderr" }) => void) => void;
    };
  }
}

const commandInput = document.getElementById("command-input") as HTMLInputElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const commandResult = document.getElementById("command-result") as HTMLDivElement;
const logOutput = document.getElementById("log-output") as HTMLPreElement;

const MAX_LOG_LINES = 1000;
let logLineCount = 0;

// --- Service status updates ---
window.api.onServiceStatus((data) => {
  const row = document.querySelector(`.service-row[data-service="${data.service}"]`);
  if (!row) return;

  const dot = row.querySelector(".status-dot") as HTMLElement;
  const detail = row.querySelector(".service-detail") as HTMLElement;

  // Update dot class
  dot.className = `status-dot ${data.status}`;

  // Update detail text
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

  // Trim excess lines
  while (logLineCount > MAX_LOG_LINES && logOutput.firstChild) {
    logOutput.removeChild(logOutput.firstChild);
    logLineCount--;
  }

  // Auto-scroll to bottom
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

// Focus input on load
commandInput.focus();
