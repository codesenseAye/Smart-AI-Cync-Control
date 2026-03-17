import { useState } from "react";
import { TabBar } from "./components/TabBar";
import { HomePage } from "./components/home/HomePage";
import { ServerPage } from "./components/server/ServerPage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { useRoomsConfig } from "./hooks/useRoomsConfig";
import { useDeviceEvents } from "./hooks/useDeviceEvents";
import { useServiceStatus } from "./hooks/useServiceStatus";
import { useServerLogs } from "./hooks/useServerLogs";

export function App() {
  const [activeTab, setActiveTab] = useState("home");
  const { resolveDeviceInfo } = useRoomsConfig();
  const { items, addSentItem } = useDeviceEvents(resolveDeviceInfo);
  const statuses = useServiceStatus();
  const { logs, logRef } = useServerLogs();

  return (
    <>
      <div className="page" style={{ display: activeTab === "home" ? "block" : "none" }}>
        <HomePage items={items} onCommandSent={addSentItem} />
      </div>
      <div className="page" style={{ display: activeTab === "server" ? "block" : "none" }}>
        <ServerPage statuses={statuses} logs={logs} logRef={logRef} />
      </div>
      <div className="page" style={{ display: activeTab === "settings" ? "block" : "none" }}>
        <SettingsPage />
      </div>
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </>
  );
}
