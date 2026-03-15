import { Router, type Request, type Response } from "express";
import { dnsService } from "../services/dns.js";
import { config } from "../config.js";

export const dnsRouter = Router();

dnsRouter.post("/dns/enable", async (_req: Request, res: Response) => {
  const result = await dnsService.enable(config.cyncLanIp);
  res.status(result.ok ? 200 : 500).json(result);
});

dnsRouter.post("/dns/disable", async (_req: Request, res: Response) => {
  const result = await dnsService.disable();
  res.status(result.ok ? 200 : 500).json(result);
});

dnsRouter.get("/dns/status", async (_req: Request, res: Response) => {
  const status = await dnsService.status();
  res.json(status);
});
