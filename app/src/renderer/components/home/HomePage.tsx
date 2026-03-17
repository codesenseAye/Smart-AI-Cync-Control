import type { FeedItem, ParsedCommand } from "../../types";
import { CommandInput } from "./CommandInput";
import { DeviceActivityFeed } from "./DeviceActivityFeed";

interface HomePageProps {
  items: FeedItem[];
  onCommandSent: (interpreted: ParsedCommand, originalText?: string) => void;
  onClear: () => void;
  onDismiss: (id: string) => void;
  paused: boolean;
  onPauseToggle: () => void;
}

export function HomePage({
  items,
  onCommandSent,
  onClear,
  onDismiss,
  paused,
  onPauseToggle,
}: HomePageProps) {
  const handleReplay = async (text: string) => {
    try {
      const result = await window.api.sendCommand(text);
      if (result.ok && result.interpreted) {
        onCommandSent(result.interpreted, text);
      }
    } catch {}
  };

  return (
    <div className="container">
      <CommandInput onCommandSent={onCommandSent} />
      <DeviceActivityFeed
        items={items}
        onClear={onClear}
        onDismiss={onDismiss}
        onReplay={handleReplay}
        paused={paused}
        onPauseToggle={onPauseToggle}
      />
    </div>
  );
}
