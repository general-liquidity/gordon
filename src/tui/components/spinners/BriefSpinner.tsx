import type React from "react";
import { useState, useEffect } from "react";

// ============================================================================
// BriefSpinner — Spinner that only appears after a minimum delay
//
// Prevents the loading flash for operations that complete quickly.
// The children (actual spinner) are only rendered when BOTH conditions hold:
//   1. visible=true (parent says we're loading)
//   2. delayMs has elapsed since the component mounted
//
// When visible flips to false the children are hidden immediately —
// no lingering indicator after work completes.
// ============================================================================

interface Props {
  /** The actual spinner component to render */
  children: React.ReactNode;
  /** Minimum delay before showing children — default 300 ms */
  delayMs?: number;
  /** Controlled by parent: true = loading, false = done */
  visible: boolean;
}

export function BriefSpinner({ children, delayMs = 300, visible }: Props) {
  const [delayElapsed, setDelayElapsed] = useState(false);

  useEffect(() => {
    // Reset delay state whenever we mount (or delayMs changes)
    setDelayElapsed(false);

    if (delayMs <= 0) {
      setDelayElapsed(true);
      return;
    }

    const timer = setTimeout(() => {
      setDelayElapsed(true);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!visible || !delayElapsed) {
    return null;
  }

  return <>{children}</>;
}
