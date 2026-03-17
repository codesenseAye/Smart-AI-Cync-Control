import { useState, useEffect } from "react";
import "../../styles/cloud-sync.css";

interface CloudSyncPanelProps {
  visible: boolean;
  onClose: () => void;
  onSyncComplete: () => void;
}

type Step = "email" | "verify" | "syncing" | "done";

interface SyncResult {
  ok: boolean;
  deviceCount?: number;
  roomCount?: number;
  error?: string;
}

export function CloudSyncPanel({ visible, onClose, onSyncComplete }: CloudSyncPanelProps) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setShow(true));
    } else {
      setShow(false);
    }
  }, [visible]);

  const reset = () => {
    setStep("email");
    setEmail("");
    setPassword("");
    setOtp("");
    setError("");
    setResult(null);
    setOtpSending(false);
  };

  const handleClose = () => {
    setShow(false);
    setTimeout(() => {
      reset();
      onClose();
    }, 200);
  };

  const requestOtp = async () => {
    if (!email.trim()) return;
    setOtpSending(true);
    setError("");

    try {
      const res = await window.api.cloudRequestOtp(email.trim());
      if (res.ok) {
        setStep("verify");
      } else {
        setError(res.error || "Failed to send OTP");
      }
    } catch (err: any) {
      setError(err.message || "Failed to send OTP");
    } finally {
      setOtpSending(false);
    }
  };

  const sync = async () => {
    if (!email.trim() || !password || !otp.trim()) return;
    setError("");
    setStep("syncing");

    try {
      const res = await window.api.cloudSync(email.trim(), password, otp.trim());
      setResult(res);
      setStep("done");
      if (res.ok) onSyncComplete();
    } catch (err: any) {
      setResult({ ok: false, error: err.message || "Sync failed" });
      setStep("done");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === "Enter") action();
  };

  if (!visible) return null;

  const stepIndex = { email: 0, verify: 1, syncing: 2, done: 3 }[step];
  const stepLabels = ["Email", "Verify", "Sync", "Done"];

  return (
    <div className={`cs-overlay ${show ? "cs-overlay--visible" : ""}`} onClick={handleClose}>
      <div className={`cs-modal ${show ? "cs-modal--visible" : ""}`} onClick={(e) => e.stopPropagation()}>
        <button className="cs-close" onClick={handleClose} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="cs-header">
          <div className="cs-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
              <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" />
            </svg>
          </div>
          <h2 className="cs-title">Cloud Sync</h2>
          <p className="cs-subtitle">Import devices from your Cync account</p>
        </div>

        <div className="cs-steps">
          {stepLabels.map((label, i) => {
            const isDone = step === "done" ? i <= stepIndex : i < stepIndex;
            return (
            <div key={label} className={`cs-step-dot ${i <= stepIndex ? "cs-step-dot--active" : ""} ${isDone ? "cs-step-dot--done" : ""}`}>
              <div className="cs-dot">
                {isDone ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="10" height="10">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <span className="cs-step-label">{label}</span>
            </div>
            );
          })}
          <div className="cs-step-line">
            <div className={`cs-step-line-fill ${step === "done" ? "cs-step-line-fill--done" : ""}`} style={{ width: `${(stepIndex / 3) * 100}%` }} />
          </div>
        </div>

        <div className="cs-body">
          {step === "email" && (
            <div className="cs-pane cs-pane--enter">
              <label className="cs-label">Cync account email</label>
              <input
                className="cs-input"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, requestOtp)}
              />
              {error && <div className="cs-error">{error}</div>}
              <button
                className="cs-btn cs-btn--primary"
                disabled={otpSending || !email.trim()}
                onClick={requestOtp}
              >
                {otpSending ? (
                  <>
                    <span className="cs-spinner" />
                    Sending...
                  </>
                ) : (
                  "Send verification code"
                )}
              </button>
            </div>
          )}

          {step === "verify" && (
            <div className="cs-pane cs-pane--enter">
              <p className="cs-hint">
                A verification code was sent to <strong>{email}</strong>
              </p>
              <label className="cs-label">Password</label>
              <input
                className="cs-input"
                type="password"
                placeholder="Cync account password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <label className="cs-label">Verification code</label>
              <input
                className="cs-input"
                type="text"
                placeholder="Enter code from email"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, sync)}
              />
              {error && <div className="cs-error">{error}</div>}
              <button
                className="cs-btn cs-btn--primary"
                disabled={!password || !otp.trim()}
                onClick={sync}
              >
                Sync devices
              </button>
              <button className="cs-btn cs-btn--ghost" onClick={() => { setStep("email"); setError(""); }}>
                Back
              </button>
            </div>
          )}

          {step === "syncing" && (
            <div className="cs-pane cs-pane--enter cs-pane--center">
              <div className="cs-sync-animation">
                <div className="cs-pulse-ring" />
                <div className="cs-pulse-ring cs-pulse-ring--delayed" />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32" className="cs-sync-icon">
                  <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" />
                </svg>
              </div>
              <p className="cs-sync-text">Syncing your devices...</p>
              <p className="cs-sync-subtext">Fetching device data from Cync cloud</p>
            </div>
          )}

          {step === "done" && result && (
            <div className="cs-pane cs-pane--enter cs-pane--center">
              {result.ok ? (
                <>
                  <div className="cs-result-icon cs-result-icon--success">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="36" height="36">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <p className="cs-result-title">Sync complete</p>
                  <p className="cs-result-detail">
                    {result.deviceCount} device{result.deviceCount !== 1 ? "s" : ""} synced into {result.roomCount} room{result.roomCount !== 1 ? "s" : ""}
                  </p>
                </>
              ) : (
                <>
                  <div className="cs-result-icon cs-result-icon--error">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="36" height="36">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </div>
                  <p className="cs-result-title">Sync failed</p>
                  <p className="cs-result-detail cs-result-detail--error">{result.error}</p>
                </>
              )}
              <button
                className={`cs-btn ${result.ok ? "cs-btn--primary" : "cs-btn--ghost"}`}
                onClick={result.ok ? handleClose : () => { setStep("verify"); setResult(null); }}
              >
                {result.ok ? "Done" : "Try again"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
