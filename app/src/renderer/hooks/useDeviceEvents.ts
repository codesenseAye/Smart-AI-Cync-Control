import { useState, useEffect, useRef, useCallback } from "react";
import type { FeedItem, DeviceEventData, ParsedCommand } from "../types";

const MAX_FEED_ITEMS = 200;

let nextFeedId = 0;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function deriveTypeLabel(data: Record<string, unknown>): string {
  if (data.effect) return "effect";
  if (data.color_mode === "rgb") return "color";
  if (data.color_temp !== undefined) return "temp";
  if (data.brightness !== undefined && data.state !== "OFF") return "simple";
  return "power";
}

export function useDeviceEvents(resolveDeviceInfo: (id: string) => { room: string; device: string }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [paused, setPaused] = useState(false);
  const subscribed = useRef(false);
  const resolveRef = useRef(resolveDeviceInfo);
  const pausedRef = useRef(paused);
  resolveRef.current = resolveDeviceInfo;
  pausedRef.current = paused;

  const addItem = useCallback((item: FeedItem) => {
    if (pausedRef.current) return;
    setItems((prev) => {
      const next = [item, ...prev];
      return next.length > MAX_FEED_ITEMS ? next.slice(0, MAX_FEED_ITEMS) : next;
    });
  }, []);

  const clearItems = useCallback(() => {
    setItems([]);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const addSentItem = useCallback((interpreted: ParsedCommand, originalText?: string) => {
    const room = interpreted.room || "all";
    const label = capitalize(room);
    const typeLabel = interpreted.type || "command";
    addItem({
      id: String(nextFeedId++),
      kind: "sent",
      label,
      data: interpreted as unknown as Record<string, unknown>,
      typeLabel,
      ts: Date.now(),
      command: interpreted,
      originalText,
    });
  }, [addItem]);

  useEffect(() => {
    if (!subscribed.current) {
      subscribed.current = true;
      window.api.onDeviceEvent((event: DeviceEventData) => {
        const { room, device } = resolveRef.current(event.deviceId);
        const label = `${capitalize(room)} \u00b7 ${device}`;
        const typeLabel = deriveTypeLabel(event.data);
        const kind = event.kind === "command" ? "sent" : "status";
        addItem({
          id: String(nextFeedId++),
          kind,
          label,
          data: event.data,
          typeLabel,
          ts: Date.now(),
        });
      });
    }
  }, [addItem]);

  return { items, addSentItem, clearItems, removeItem, paused, setPaused };
}
