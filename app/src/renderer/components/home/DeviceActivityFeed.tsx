import { useState } from "react";
import type { FeedItem as FeedItemType } from "../../types";
import { FeedItem } from "./FeedItem";
import "../../styles/feed.css";

type KindFilter = "all" | "sent" | "status";

interface DeviceActivityFeedProps {
  items: FeedItemType[];
  onClear: () => void;
  onDismiss: (id: string) => void;
  onReplay: (text: string) => void;
  paused: boolean;
  onPauseToggle: () => void;
}

export function DeviceActivityFeed({
  items,
  onClear,
  onDismiss,
  onReplay,
  paused,
  onPauseToggle,
}: DeviceActivityFeedProps) {
  const [filter, setFilter] = useState<KindFilter>("all");

  const filtered = filter === "all" ? items : items.filter((i) => i.kind === filter);

  return (
    <section className="feed-section">
      <div className="feed-toolbar">
        <h2>
          Device Activity
          {items.length > 0 && <span className="feed-count">{items.length}</span>}
        </h2>
        <div className="feed-filters">
          {(["all", "sent", "status"] as KindFilter[]).map((f) => (
            <button
              key={f}
              className={`feed-filter-btn ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "sent" ? "Sent" : "Status"}
            </button>
          ))}
        </div>
        <div className="feed-actions">
          <button
            className={`feed-action-btn ${paused ? "active" : ""}`}
            onClick={onPauseToggle}
            title={paused ? "Resume feed" : "Pause feed"}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            className="feed-action-btn clear"
            onClick={onClear}
            disabled={items.length === 0}
            title="Clear all"
          >
            Clear
          </button>
        </div>
      </div>
      {paused && <div className="feed-paused-bar">Feed paused</div>}
      <div className="event-feed">
        {filtered.length === 0 ? (
          <p className="empty-msg">
            {items.length === 0
              ? "No device activity yet"
              : `No ${filter} items`}
          </p>
        ) : (
          filtered.map((item) => (
            <FeedItem
              key={item.id}
              item={item}
              onDismiss={onDismiss}
              onReplay={onReplay}
            />
          ))
        )}
      </div>
    </section>
  );
}
