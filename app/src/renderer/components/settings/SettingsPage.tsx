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
  }, []);

  return (
    <div className="settings-page">
      <div className="container">
        <DevicesSection
          onCloudSync={() => setSyncVisible(true)}
          reloadKey={reloadKey}
        />
        <RoomsSection reloadKey={reloadKey} />
        <ConfigSection />
      </div>
      <CloudSyncPanel
        visible={syncVisible}
        onClose={() => setSyncVisible(false)}
        onSyncComplete={handleSyncComplete}
      />
    </div>
  );
}
