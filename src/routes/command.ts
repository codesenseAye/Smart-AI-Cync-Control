import { Router, type Request, type Response } from "express";
import { parseCommand } from "../services/llm.js";
import { execute } from "../services/executor.js";

export const commandRouter = Router();

commandRouter.post("/command", async (req: Request, res: Response) => {
  const { text } = req.body as { text?: string };
  const pretty = req.headers["x-pretty"] === "true";

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    if (pretty) {
      res.status(400).type("text/plain").send("Error: Missing or empty 'text' field");
    } else {
      res.status(400).json({ ok: false, error: "Missing or empty 'text' field" });
    }
    return;
  }

  const commandText = text.trim();
  console.log(`[command] Received: "${commandText}"`);

  try {
    // Parse with LLM
    const parsed = await parseCommand(commandText);
    console.log(`[command] Parsed:`, JSON.stringify(parsed));

    // Execute
    const result = await execute(parsed);
    console.log(`[command] Result: ${result.detail}`);

    if (pretty) {
      res.type("text/plain").send(result.detail);
    } else {
      res.json({
        ok: result.ok,
        interpreted: parsed,
        detail: result.detail,
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[command] Error processing "${commandText}":`, message);
    if (pretty) {
      res.status(500).type("text/plain").send(`Error: ${message}`);
    } else {
      res.status(500).json({
        ok: false,
        error: message,
        raw: commandText,
      });
    }
  }
});