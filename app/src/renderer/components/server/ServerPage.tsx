import type { ServiceStatusData } from "../../types";
import type { LogEntry } from "../../hooks/useServerLogs";
import { ServiceStatusPanel } from "./ServiceStatusPanel";
import { ServerLogs } from "./ServerLogs";

interface ServerPageProps {
  statuses: Map<string, ServiceStatusData>;
  logs: LogEntry[];
  logRef: React.RefObject<HTMLPreElement | null>;
}

export function ServerPage({ statuses, logs, logRef }: ServerPageProps) {
  return (
    <div className="container">
      <ServiceStatusPanel statuses={statuses} />
      <ServerLogs logs={logs} logRef={logRef} />
    </div>
  );
}
