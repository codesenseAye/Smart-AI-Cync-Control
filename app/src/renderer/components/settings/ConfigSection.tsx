import { useState, useEffect, useCallback } from "react";
import type { ConfigEntry } from "../../types";
import { SectionHeader } from "../SectionHeader";
import { IconButton } from "../IconButton";
import { OpenFileIcon } from "./icons";

export function ConfigSection() {
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [configPath, setConfigPath] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await window.api.getConfig();
      setConfigPath(result.path || "");
      setEntries(result.ok ? result.entries.filter((e) => !e.comment) : []);
      setError(false);
    } catch {
      setError(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="settings-section">
      <SectionHeader title="Configuration">
        <IconButton title="Open file" onClick={() => { if (configPath) window.api.openFile(configPath); }}>
          <OpenFileIcon />
        </IconButton>
      </SectionHeader>
      <div className="settings-content">
        {error ? (
          <p className="empty-msg">Failed to load configuration</p>
        ) : entries.length === 0 ? (
          <p className="empty-msg">{loaded ? "No configuration found" : "Loading..."}</p>
        ) : (
          <table className="settings-table config-table">
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.key}>
                  <td className="config-key">{entry.key}</td>
                  <td className="config-val">{entry.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
