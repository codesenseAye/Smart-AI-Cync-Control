import type { FeedItem as FeedItemType } from "../../types";
import { FeedItem } from "./FeedItem";
import "../../styles/feed.css";

interface DeviceActivityFeedProps {
  items: FeedItemType[];
}

export function DeviceActivityFeed({ items }: DeviceActivityFeedProps) {
  return (
    <section className="feed-section">
      <h2>Device Activity</h2>
      <div className="event-feed">
        {items.length === 0 ? (
          <p className="empty-msg">No device activity yet</p>
        ) : (
          items.map((item) => <FeedItem key={item.id} item={item} />)
        )}
      </div>
    </section>
  );
}
