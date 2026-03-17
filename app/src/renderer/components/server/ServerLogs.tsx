import type { LogEntry } from "../../hooks/useServerLogs";
import "../../styles/logs.css";

interface ServerLogsProps {
  logs: LogEntry[];
  logRef: React.RefObject<HTMLPreElement | null>;
}

export function ServerLogs({ logs, logRef }: ServerLogsProps) {
  return (
    <section className="logs-section">
      <h2>Server Logs</h2>
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
