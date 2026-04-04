// ============================================================================
// Alerts Command — Manage price alerts
//
// Usage: /alerts set <symbol> <price>   — set alert when price hits target
//        /alerts list                   — list active alerts
//        /alerts delete <id>            — delete an alert
//        /alerts clear                  — clear all alerts
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ALERTS_PATH = join(homedir(), ".gordon", "alerts.json");

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  direction: "above" | "below";
  createdAt: string;
  triggered: boolean;
}

function loadAlerts(): PriceAlert[] {
  try {
    if (existsSync(ALERTS_PATH)) {
      return JSON.parse(readFileSync(ALERTS_PATH, "utf-8"));
    }
  } catch {}
  return [];
}

function saveAlerts(alerts: PriceAlert[]): void {
  try {
    writeFileSync(ALERTS_PATH, JSON.stringify(alerts, null, 2));
  } catch {}
}

export function handleAlertsCommand(args: string): string {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "list";

  switch (subcommand) {
    case "set": {
      const symbol = parts[1]?.toUpperCase();
      const price = parseFloat(parts[2] ?? "0");
      const direction = parts[3]?.toLowerCase() === "below" ? "below" : "above";

      if (!symbol || !price || isNaN(price)) {
        return "Usage: /alerts set <symbol> <price> [above|below]";
      }

      const alert: PriceAlert = {
        id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        symbol,
        targetPrice: price,
        direction,
        createdAt: new Date().toISOString(),
        triggered: false,
      };

      const alerts = loadAlerts();
      alerts.push(alert);
      saveAlerts(alerts);

      return `Alert set: ${symbol} ${direction} $${price.toFixed(2)} (ID: ${alert.id})`;
    }

    case "list": {
      const alerts = loadAlerts().filter((a) => !a.triggered);
      if (alerts.length === 0) return "No active alerts. Use `/alerts set <symbol> <price>` to create one.";

      const lines = ["Active Alerts:", ""];
      for (const alert of alerts) {
        lines.push(`  ${alert.symbol.padEnd(12)} ${alert.direction.padEnd(6)} $${alert.targetPrice.toFixed(2).padStart(12)}  (${alert.id})`);
      }
      lines.push("", `${alerts.length} alert${alerts.length > 1 ? "s" : ""} active`);
      return lines.join("\n");
    }

    case "delete": {
      const id = parts[1];
      if (!id) return "Usage: /alerts delete <id>";

      const alerts = loadAlerts();
      const filtered = alerts.filter((a) => a.id !== id);
      if (filtered.length === alerts.length) return `Alert not found: ${id}`;

      saveAlerts(filtered);
      return `Alert deleted: ${id}`;
    }

    case "clear": {
      saveAlerts([]);
      return "All alerts cleared.";
    }

    default:
      return "Usage: /alerts [set|list|delete|clear] <symbol> [price]";
  }
}
