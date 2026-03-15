import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { mqttService } from "../services/mqtt.js";
import { savesService } from "../services/saves.js";
import { schedulerService } from "../services/scheduler.js";
import { getActiveEffectCount } from "../services/effects.js";

export const statusRouter = Router();

statusRouter.get("/status", (_req: Request, res: Response) => {
  const states: Record<string, unknown> = {};
  for (const [id, state] of mqttService.getAllStates()) {
    states[id] = state;
  }

  res.json({
    mqtt_connected: mqttService.isConnected(),
    device_count: Object.keys(states).length,
    active_effects: getActiveEffectCount(),
    devices: states,
  });
});

statusRouter.get("/devices", (_req: Request, res: Response) => {
  const rooms: Record<string, string[]> = {};
  const homeId = config.rooms.home_id;

  for (const [name, room] of Object.entries(config.rooms.rooms)) {
    rooms[name] = Object.keys(room.devices).map((d) => `${homeId}-${d}`);
  }

  const allDevices = Object.values(rooms).flat();

  res.json({
    home_id: homeId,
    rooms,
    all_devices: allDevices,
  });
});

statusRouter.get("/saves", (_req: Request, res: Response) => {
  const saves = savesService.listAll();
  res.json({ saves });
});

statusRouter.get("/schedules", (_req: Request, res: Response) => {
  const schedules = schedulerService.listAll();
  res.json({ schedules });
});
