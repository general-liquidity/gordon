import { useState, useEffect } from "react";

// ============================================================================
// useBlink — Synchronized blinking animation from shared clock
// ============================================================================

export function useBlink(options: { periodMs?: number; enabled?: boolean } = {}): { visible: boolean } {
  const { periodMs = 800, enabled = true } = options;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!enabled) { setVisible(true); return; }
    const interval = setInterval(() => {
      setVisible((prev) => !prev);
    }, periodMs);
    return () => clearInterval(interval);
  }, [periodMs, enabled]);

  return { visible: enabled ? visible : true };
}
