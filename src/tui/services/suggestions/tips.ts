// ============================================================================
// Tips Service — Contextual trading tips with session-based cooldowns
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Tip { id: string; text: string; category: string; }

const TIPS: Tip[] = [
  { id: "trailing", text: "Use /trailing to set automatic trailing stops", category: "trading" },
  { id: "ensemble", text: "/ensemble runs multiple strategies and combines their signals", category: "strategy" },
  { id: "backtest", text: "Try /backtest to test a strategy on historical data", category: "analysis" },
  { id: "risk", text: "Use /risk-config to customize your risk limits", category: "risk" },
  { id: "palette", text: "Press Ctrl+P to open the command palette", category: "navigation" },
  { id: "compact", text: "Run /compact when context gets large to free memory", category: "performance" },
  { id: "privacy", text: "Press Ctrl+Shift+P to toggle privacy screen", category: "privacy" },
  { id: "defi", text: "/defi opens the DeFi dashboard with yield comparison", category: "defi" },
  { id: "vim", text: 'Vim mode edits the prompt input. Enable it in ~/.gordon/keybindings.json ("vimMode": true).', category: "input" },
  { id: "indicators", text: "/indicators lets you browse all 32 technical indicators", category: "analysis" },
  { id: "consensus", text: "/consensus shows the multi-evaluator trade voting system", category: "analysis" },
  { id: "evolve", text: "/evolve launches genetic strategy optimization", category: "strategy" },
  { id: "search", text: "Press Ctrl+Shift+F to search across all trading data", category: "navigation" },
  { id: "history", text: "Press Ctrl+R to search through past commands", category: "navigation" },
  { id: "background", text: "Press Ctrl+B to background a long-running task", category: "workflow" },
  { id: "whatif", text: "/whatif runs counterfactual analysis on closed trades", category: "analysis" },
  { id: "dsl", text: "/strategy-builder lets you create strategies without code", category: "strategy" },
  { id: "theme", text: "/theme switches between 6 themes including colorblind-safe", category: "display" },
  { id: "market", text: "/market shows market score, regime, and whale activity", category: "analysis" },
  { id: "regime", text: "/regime displays the current market regime per symbol", category: "analysis" },
];

const HISTORY_PATH = join(homedir(), ".gordon", "tip_history.json");

export class TipService {
  private history: Record<string, number> = {};

  constructor() {
    try {
      if (existsSync(HISTORY_PATH)) {
        this.history = JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
      }
    } catch { this.history = {}; }
  }

  getNextTip(sessionNumber: number): Tip | null {
    for (const tip of TIPS) {
      const lastShown = this.history[tip.id] ?? 0;
      if (sessionNumber - lastShown >= 10) {
        this.history[tip.id] = sessionNumber;
        this.save();
        return tip;
      }
    }
    return null;
  }

  private save(): void {
    try { writeFileSync(HISTORY_PATH, JSON.stringify(this.history)); } catch {}
  }
}
