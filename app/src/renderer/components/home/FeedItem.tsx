import { useState, type ReactNode } from "react";
import type { FeedItem as FeedItemType } from "../../types";

function StatusPretty({ data }: { data: Record<string, unknown> }): ReactNode {
  const parts: ReactNode[] = [];

  if (data.state) parts.push(String(data.state));
  if (data.brightness !== undefined) parts.push(`${data.brightness}%`);

  if (data.color_mode === "rgb" && data.color) {
    const c = data.color as { r: number; g: number; b: number };
    parts.push(
      <span key="color">
        <span
          className="color-swatch"
          style={{ background: `rgb(${c.r},${c.g},${c.b})` }}
        />
        {`RGB(${c.r}, ${c.g}, ${c.b})`}
      </span>
    );
  } else if (data.color_temp !== undefined) {
    parts.push(`${data.color_temp}K`);
  }

  if (data.effect) parts.push(String(data.effect));

  if (parts.length === 0) return <>&mdash;</>;

  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="sep"> &middot; </span>}
          {part}
        </span>
      ))}
    </>
  );
}

function SentPretty({ data }: { data: Record<string, unknown> }): ReactNode {
  if (!data || !data.type) return <>Unknown command</>;

  switch (data.type) {
    case "power":
      return <>{(data.state as string) || "toggle"}</>;
    case "simple": {
      const parts: string[] = [];
      if (data.brightness !== undefined) parts.push(`${data.brightness}%`);
      if (data.color_temp_kelvin) parts.push(`${data.color_temp_kelvin}K`);
      if (data.rgb) {
        const c = data.rgb as { r: number; g: number; b: number };
        parts.push(`RGB(${c.r}, ${c.g}, ${c.b})`);
      }
      return <>{parts.join(" \u00b7 ") || "set"}</>;
    }
    case "effect":
      return <>{(data.effect as string) || "effect"}</>;
    case "complex":
      return <>{`${(data.sequence as unknown[])?.length || 0}-step sequence`}</>;
    default:
      return <>{data.type as string}</>;
  }
}

interface FeedItemProps {
  item: FeedItemType;
}

export function FeedItem({ item }: FeedItemProps) {
  const [showJson, setShowJson] = useState(false);

  return (
    <div className="event-item">
      <div className="event-header">
        <span className={`event-badge ${item.kind}`}>{item.typeLabel}</span>
        <span className="event-label">{item.label}</span>
        <span className="event-time">{item.timestamp}</span>
        <button className="event-toggle" onClick={() => setShowJson(!showJson)}>
          {showJson ? "Pretty" : "JSON"}
        </button>
      </div>
      {showJson ? (
        <div className="event-body event-body-json">
          {JSON.stringify(item.data, null, 2)}
        </div>
      ) : (
        <div className="event-body event-body-pretty">
          {item.command ? (
            <SentPretty data={item.data} />
          ) : (
            <StatusPretty data={item.data} />
          )}
        </div>
      )}
    </div>
  );
}
