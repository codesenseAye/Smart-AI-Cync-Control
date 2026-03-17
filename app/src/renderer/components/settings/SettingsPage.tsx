import { useState, useCallback } from "react";
import { CloudSyncPanel } from "./CloudSyncPanel";
import { DevicesSection } from "./DevicesSection";
import { RoomsSection } from "./RoomsSection";
import { ConfigSection } from "./ConfigSection";
import "../../styles/settings.css";

export function SettingsPage() {
  const [syncVisible, setSyncVisible] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const handleSyncComplete = useCallback(() => {
    setReloadKey((k) => k + 1);
    setTimeout(() => setSyncVisible(false), 2000);
  }, []);

  return (
    <div className="settings-page">
      <div className="container">
        <CloudSyncPanel visible={syncVisible} onSyncComplete={handleSyncComplete} />
        <DevicesSection
          onCloudSync={() => setSyncVisible((v) => !v)}
          reloadKey={reloadKey}
        />
        <RoomsSection reloadKey={reloadKey} />
        <ConfigSection />
      </div>
    </div>
  );
}
