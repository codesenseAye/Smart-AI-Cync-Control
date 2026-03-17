import { useState, useEffect, useCallback } from "react";
import { SectionHeader } from "../SectionHeader";
import { IconButton } from "../IconButton";
import { RefreshIcon, OpenFileIcon } from "./icons";
import { RoomCard } from "./RoomCard";

interface RoomsSectionProps {
  reloadKey: number;
}

export function RoomsSection({ reloadKey }: RoomsSectionProps) {
  const [rooms, setRooms] = useState<Record<string, any>>({});
  const [roomsPath, setRoomsPath] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await window.api.getSettingsRooms();
      setRoomsPath(result.path || "");
      if (result.ok && result.data?.rooms) {
        setRooms(result.data.rooms);
      } else {
        setRooms({});
      }
      setError(false);
    } catch {
      setError(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  const roomEntries = Object.entries(rooms);

  return (
    <section className="settings-section">
      <SectionHeader title="Rooms">
        <IconButton title="Refresh" onClick={load} refreshable>
          <RefreshIcon />
        </IconButton>
        <IconButton title="Open file" onClick={() => { if (roomsPath) window.api.openFile(roomsPath); }}>
          <OpenFileIcon />
        </IconButton>
      </SectionHeader>
      <div className="settings-content">
        {error ? (
          <p className="empty-msg">Failed to load rooms</p>
        ) : roomEntries.length === 0 ? (
          <p className="empty-msg">{loaded ? "No rooms configured" : "Loading..."}</p>
        ) : (
          roomEntries.map(([name, config]) => (
            <RoomCard
              key={name}
              roomName={name}
              devices={config.devices || {}}
              aliases={config.aliases}
              onDeviceMoved={load}
            />
          ))
        )}
      </div>
    </section>
  );
}
