import type { LogEntry } from "../../hooks/useServerLogs";
import "../../styles/logs.css";

interface ServerLogsProps {
  logs: LogEntry[];
  logRef: React.RefObject<HTMLPreElement | null>;
  onClear: () => void;
}

export function ServerLogs({ logs, logRef, onClear }: ServerLogsProps) {
  return (
    <section className="logs-section">
      <div className="logs-toolbar">
        <h2>Server Logs</h2>
        <button
          className="logs-clear-btn"
          onClick={onClear}
          disabled={logs.length === 0}
          title="Clear logs"
        >
          Clear
        </button>
      </div>
      <pre className="log-output" ref={logRef}>
        {logs.map((entry) => (
          <span key={entry.id} className={entry.stream === "stderr" ? "log-stderr" : "log-stdout"}>
            {entry.line + "\n"}
          </span>
        ))}
      </pre>
    </section>
  );
}
