import { useState } from "react";

interface DeviceChipProps {
  deviceId: string;
  name: string;
  roomName: string;
}

export function DeviceChip({ deviceId, name, roomName }: DeviceChipProps) {
  const [dragging, setDragging] = useState(false);

  return (
    <span
      className={`room-device-chip${dragging ? " dragging" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/device-id", deviceId);
        e.dataTransfer.setData("text/from-room", roomName);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      {deviceId}: {name}
    </span>
  );
}
