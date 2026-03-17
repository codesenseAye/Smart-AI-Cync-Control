import { useState } from "react";
import { DeviceChip } from "./DeviceChip";

interface RoomCardProps {
  roomName: string;
  devices: Record<string, { name: string }> | number[];
  aliases?: string[];
  onDeviceMoved: () => void;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function RoomCard({ roomName, devices, aliases, onDeviceMoved }: RoomCardProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const deviceId = e.dataTransfer.getData("text/device-id");
    const fromRoom = e.dataTransfer.getData("text/from-room");
    if (!deviceId || !fromRoom || fromRoom === roomName) return;

    const result = await window.api.moveDevice(deviceId, fromRoom, roomName);
    if (result.ok) onDeviceMoved();
  };

  const isObject = typeof devices === "object" && !Array.isArray(devices);
  const deviceEntries = isObject ? Object.entries(devices) : [];

  return (
    <div
      className={`room-card${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="room-card-header">
        {capitalize(roomName)}
        {aliases && aliases.length > 0 && (
          <span className="room-aliases">{aliases.join(", ")}</span>
        )}
      </div>
      <div className="room-devices">
        {isObject ? (
          deviceEntries.map(([id, info]) => (
            <DeviceChip
              key={id}
              deviceId={id}
              name={typeof info === "object" && info?.name ? info.name : `Device ${id}`}
              roomName={roomName}
            />
          ))
        ) : (
          (devices as number[]).map((id) => (
            <span key={id} className="room-device-chip">{String(id)}</span>
          ))
        )}
      </div>
    </div>
  );
}
