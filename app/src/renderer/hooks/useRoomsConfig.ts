import { useState, useEffect, useCallback } from "react";
import type { RoomsConfig } from "../types";

export function useRoomsConfig() {
  const [config, setConfig] = useState<RoomsConfig>({});

  useEffect(() => {
    window.api.getRooms().then((rooms) => {
      setConfig(rooms || {});
    }).catch(() => {});
  }, []);

  const resolveDeviceInfo = useCallback((deviceId: string): { room: string; device: string } => {
    const parts = deviceId.split("-");
    const numericId = parts.length >= 2 ? parts[parts.length - 1] : deviceId;
    const rooms = config.rooms || {};

    for (const [roomName, roomConfig] of Object.entries(rooms)) {
      const devices = roomConfig.devices;
      if (!devices) continue;

      if (Array.isArray(devices)) {
        if (devices.includes(parseInt(numericId, 10))) {
          return { room: roomName, device: numericId };
        }
      } else {
        if (numericId in devices) {
          const info = devices[numericId];
          return { room: roomName, device: info?.name || numericId };
        }
      }
    }

    return { room: "unknown", device: numericId };
  }, [config]);

  return { config, resolveDeviceInfo };
}
