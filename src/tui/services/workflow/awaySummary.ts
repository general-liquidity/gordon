// ============================================================================
// Away Summary — Generates "while you were away" recaps
//
// Takes last 30 messages + positions, produces a structured summary
// of key events that occurred during absence.
// ============================================================================

interface Message {
  role?: string;
  content?: string;
  variant?: string;
  timestamp?: number;
}

interface Position {
  symbol?: string;
  pnl?: number;
  side?: string;
}

export async function generateAwaySummary(
  messages: Message[],
  positions: Position[],
  awayDurationMs: number,
): Promise<string> {
  const minutes = Math.round(awayDurationMs / 60000);
  const lines: string[] = [`While you were away (${minutes}m):`];

  // Extract key events from recent messages
  const fills = messages.filter((m) => m.variant === "fill");
  const stops = messages.filter((m) => m.variant === "stop");
  const alerts = messages.filter((m) => m.variant === "alert");
  const signals = messages.filter((m) => m.variant === "strategy");

  if (fills.length > 0) {
    lines.push(`  \u2713 ${fills.length} order${fills.length > 1 ? "s" : ""} filled`);
  }

  if (stops.length > 0) {
    lines.push(`  \u2717 ${stops.length} stop${stops.length > 1 ? "s" : ""} triggered`);
  }

  if (alerts.length > 0) {
    lines.push(`  \u26A0 ${alerts.length} alert${alerts.length > 1 ? "s" : ""} fired`);
  }

  if (signals.length > 0) {
    lines.push(
      `  \u25C8 ${signals.length} strategy signal${signals.length > 1 ? "s" : ""} detected`,
    );
  }

  // Position summary
  if (positions.length > 0) {
    const totalPnl = positions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
    const sign = totalPnl >= 0 ? "+" : "";
    lines.push(`  Positions: ${positions.length} open \u00B7 ${sign}$${totalPnl.toFixed(2)} P&L`);
  }

  if (lines.length === 1) {
    lines.push("  No significant events occurred.");
  }

  return lines.join("\n");
}
