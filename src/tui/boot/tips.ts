import * as fs from "node:fs";
import * as path from "node:path";
import { getGordonDir } from "../../infra/storage/paths.ts";

export const TIPS: readonly string[] = [
  "Type /scan to discover opportunities across all connected venues.",
  "Use /morning-brief for a market overview before your first trade.",
  "Try /analyze BTC to get a deep-dive on any asset.",
  "/trending shows what's pumping right now across crypto markets.",
  "/portfolio gives you a live snapshot of your positions and P&L.",
  "/preview-order lets you see the exact order before it executes.",
  "/positions shows all open positions with real-time P&L.",
  "Switch to paper mode with /paper — trade risk-free against live prices.",
  "Use /auto to let Gordon monitor and trade autonomously.",
  "/backtest runs any strategy against historical data.",
  "/model lets you switch the underlying AI mid-session.",
  "Press Ctrl+P to open the command palette from anywhere.",
  "Press ? to browse all available slash commands.",
  "/history shows your full trade and decision log.",
  "Set a stop-loss in plain English — Gordon understands natural language orders.",
  "Gordon remembers context across the session — no need to repeat yourself.",
  "/export saves a full session transcript for your records.",
  "Use /strict mode to require confirmation before every action.",
  "Connect multiple exchanges with /configure exchange.",
  "/doctor checks your configuration and connectivity in one go.",
];

let sessionTip: string | null = null;

/**
 * Tip scheduler — picks the tip with the longest time since last shown.
 * Reads/writes ~/.gordon/tipHistory.json synchronously. Mirrors Claude Code's
 * tipScheduler.selectTipWithLongestTimeSinceShown() pattern (without the
 * context filters — every tip is eligible for now).
 */
export function pickTip(tips: readonly string[]): string {
  const fallback = () => tips[Math.floor(Math.random() * tips.length)] ?? "";
  if (tips.length === 0) return "";

  try {
    const gordonDir = getGordonDir();
    const historyPath = path.join(gordonDir, "tipHistory.json");

    let lastShown: Record<string, number> = {};
    let sessionCount = 0;
    if (fs.existsSync(historyPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(historyPath, "utf-8")) as {
          lastShown?: Record<string, number>;
          sessionCount?: number;
        };
        lastShown = parsed.lastShown ?? {};
        sessionCount = parsed.sessionCount ?? 0;
      } catch {
        // Corrupt file -> start fresh.
      }
    }
    sessionCount += 1;

    let bestIdx = 0;
    let bestAge = -1;
    for (let i = 0; i < tips.length; i++) {
      const seen = lastShown[String(i)] ?? 0;
      const age = sessionCount - seen;
      if (age > bestAge) {
        bestAge = age;
        bestIdx = i;
      }
    }

    lastShown[String(bestIdx)] = sessionCount;
    try {
      if (!fs.existsSync(gordonDir)) fs.mkdirSync(gordonDir, { recursive: true });
      fs.writeFileSync(historyPath, JSON.stringify({ lastShown, sessionCount }, null, 2));
    } catch {
      // Read-only fs -> tip still shown, just not tracked.
    }

    return tips[bestIdx]!;
  } catch {
    return fallback();
  }
}

/** Picks once per process, caches. BootLivePanel + boot print share this. */
export function getSessionTip(): string {
  sessionTip ??= pickTip(TIPS);
  return sessionTip;
}

export function resetSessionTipForTesting(): void {
  sessionTip = null;
}
