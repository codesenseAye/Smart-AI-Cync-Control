import type { FeedItem, ParsedCommand } from "../../types";
import { CommandInput } from "./CommandInput";
import { DeviceActivityFeed } from "./DeviceActivityFeed";

interface HomePageProps {
  items: FeedItem[];
  onCommandSent: (interpreted: ParsedCommand) => void;
}

export function HomePage({ items, onCommandSent }: HomePageProps) {
  return (
    <div className="container">
      <CommandInput onCommandSent={onCommandSent} />
      <DeviceActivityFeed items={items} />
    </div>
  );
}
