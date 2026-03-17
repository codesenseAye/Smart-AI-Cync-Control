import { useState } from "react";
import "../../styles/cloud-sync.css";

interface CloudSyncPanelProps {
  visible: boolean;
  onSyncComplete: () => void;
}

export function CloudSyncPanel({ visible, onSyncComplete }: CloudSyncPanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [status, setStatus] = useState<{ msg: string; error: boolean } | null>(null);
  const [otpSending, setOtpSending] = useState(false);
  const [syncing, setSyncing] = useState(false);

  if (!visible) return null;

  const requestOtp = async () => {
    if (!email.trim()) return;
    setOtpSending(true);
    setStatus({ msg: "Requesting OTP...", error: false });

    try {
      const result = await window.api.cloudRequestOtp(email.trim());
      if (result.ok) {
        setStatus({ msg: "OTP sent! Check your email.", error: false });
        setShowAuth(true);
      } else {
        setStatus({ msg: result.error || "Failed to send OTP", error: true });
      }
    } catch (err: any) {
      setStatus({ msg: err.message || "Failed to send OTP", error: true });
    } finally {
      setOtpSending(false);
    }
  };

  const sync = async () => {
    if (!email.trim() || !password || !otp.trim()) return;
    setSyncing(true);
    setStatus({ msg: "Authenticating and fetching devices...", error: false });

    try {
      const result = await window.api.cloudSync(email.trim(), password, otp.trim());
      if (result.ok) {
        setStatus({ msg: `Synced ${result.deviceCount} devices into ${result.roomCount} rooms`, error: false });
        onSyncComplete();
      } else {
        setStatus({ msg: result.error || "Sync failed", error: true });
      }
    } catch (err: any) {
      setStatus({ msg: err.message || "Sync failed", error: true });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="cloud-sync-panel">
      <div className="sync-step">
        <input
          type="email"
          placeholder="Cync account email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="sync-btn" disabled={otpSending} onClick={requestOtp}>
          {otpSending ? "Sending..." : "Send OTP"}
        </button>
      </div>
      {showAuth && (
        <div className="sync-step">
          <input
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            type="text"
            placeholder="OTP code"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
          <button className="sync-btn" disabled={syncing} onClick={sync}>
            {syncing ? "Syncing..." : "Sync"}
          </button>
        </div>
      )}
      {status && (
        <div className={`sync-status ${status.error ? "sync-error" : "sync-info"}`}>
          {status.msg}
        </div>
      )}
    </div>
  );
}
