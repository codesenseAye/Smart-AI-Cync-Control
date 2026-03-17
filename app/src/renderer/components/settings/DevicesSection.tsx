import { useState, useEffect, useCallback } from "react";
import type { MeshDevice } from "../../types";
import { SectionHeader } from "../SectionHeader";
import { IconButton } from "../IconButton";
import { RefreshIcon, OpenFileIcon, CloudIcon } from "./icons";

interface DevicesSectionProps {
  onCloudSync: () => void;
  reloadKey: number;
}

export function DevicesSection({ onCloudSync, reloadKey }: DevicesSectionProps) {
  const [devices, setDevices] = useState<MeshDevice[]>([]);
  const [meshPath, setMeshPath] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await window.api.getMesh();
      setMeshPath(result.path || "");
      setDevices(result.ok ? result.devices : []);
      setError(false);
    } catch {
      setError(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  return (
    <section className="settings-section">
      <SectionHeader title="Devices">
        <IconButton title="Cloud Sync" onClick={onCloudSync}>
          <CloudIcon />
        </IconButton>
        <IconButton title="Refresh" onClick={load} refreshable>
          <RefreshIcon />
        </IconButton>
        <IconButton title="Open file" onClick={() => { if (meshPath) window.api.openFile(meshPath); }}>
          <OpenFileIcon />
        </IconButton>
      </SectionHeader>
      <div className="settings-content">
        {error ? (
          <p className="empty-msg">Failed to load devices</p>
        ) : devices.length === 0 ? (
          <p className="empty-msg">{loaded ? "No devices found" : "Loading..."}</p>
        ) : (
          <table className="settings-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>RGB</th>
                <th>Temp</th>
                <th>FW</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.id}</td>
                  <td>{d.name}</td>
                  <td className={d.supports_rgb ? "cap-yes" : "cap-no"}>
                    {d.supports_rgb ? "Yes" : "No"}
                  </td>
                  <td className={d.supports_temperature ? "cap-yes" : "cap-no"}>
                    {d.supports_temperature ? "Yes" : "No"}
                  </td>
                  <td>{d.fw || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
