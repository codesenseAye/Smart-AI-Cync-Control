import { useState, useRef, useEffect } from "react";
import "../../styles/command.css";

interface CommandInputProps {
  onCommandSent: (interpreted: any) => void;
}

export function CommandInput({ onCommandSent }: CommandInputProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (error) {
      if (errorTimeout.current) clearTimeout(errorTimeout.current);
      errorTimeout.current = setTimeout(() => setError(null), 5000);
    }
    return () => {
      if (errorTimeout.current) clearTimeout(errorTimeout.current);
    };
  }, [error]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setSending(true);
    setError(null);

    try {
      const result = await window.api.sendCommand(trimmed);
      if (result.ok) {
        if (result.interpreted) onCommandSent(result.interpreted);
        setText("");
      } else {
        setError(result.error || "Unknown error");
      }
    } catch (err: any) {
      setError(err.message || "Failed to send command");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") send();
  };

  return (
    <section className="command-section">
      <div className="command-input-row">
        <input
          ref={inputRef}
          className="command-input"
          type="text"
          placeholder='e.g. "kitchen warm dim"'
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="send-btn" disabled={sending} onClick={send}>
          Run
        </button>
      </div>
      {error && <div className="command-error">{error}</div>}
    </section>
  );
}
