import { useState, useEffect, useRef, useCallback } from "react";
import type { ServerLogData } from "../types";

const MAX_LOG_LINES = 1000;

export interface LogEntry {
  id: number;
  line: string;
  stream: "stdout" | "stderr";
}

let nextLogId = 0;

export function useServerLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLPreElement>(null);
  const subscribed = useRef(false);

  const scrollToBottom = useCallback(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (!subscribed.current) {
      subscribed.current = true;
      window.api.onServerLog((data: ServerLogData) => {
        setLogs((prev) => {
          const entry: LogEntry = { id: nextLogId++, line: data.line, stream: data.stream };
          const next = [...prev, entry];
          if (next.length > MAX_LOG_LINES) {
            return next.slice(next.length - MAX_LOG_LINES);
          }
          return next;
        });
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return { logs, logRef, clearLogs };
}
