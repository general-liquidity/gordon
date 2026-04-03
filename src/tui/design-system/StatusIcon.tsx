import React, { useState, useEffect } from "react";
import { Text } from "ink";

// ============================================================================
// StatusIcon — Semantic status indicator
//
// ✓ success (green)    ✗ error (red)      ⚠ warning (yellow)
// ℹ info (cyan)        ○ pending (gray)   ● loading (cyanBright, pulses)
// ============================================================================

type StatusType = "success" | "error" | "warning" | "info" | "pending" | "loading";

interface Props {
  type: StatusType;
}

const staticIcons: Record<Exclude<StatusType, "loading">, { char: string; color?: string; dimColor?: boolean }> = {
  success: { char: "\u2713", color: "green" },
  error: { char: "\u2717", color: "red" },
  warning: { char: "\u26A0", color: "yellow" },
  info: { char: "\u2139", color: "cyan" },
  pending: { char: "\u25CB", dimColor: true },
};

export function StatusIcon({ type }: Props) {
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    if (type !== "loading") return;
    const interval = setInterval(() => {
      setPulse((v) => !v);
    }, 400);
    return () => clearInterval(interval);
  }, [type]);

  if (type === "loading") {
    return (
      <Text color="cyanBright">{pulse ? "\u25CF" : "\u25CB"}</Text>
    );
  }

  const icon = staticIcons[type];
  return (
    <Text color={icon.color} dimColor={icon.dimColor}>
      {icon.char}
    </Text>
  );
}
