// ============================================================================
// Alerts Command — Manage price alerts
//
// Usage: /alerts set <symbol> <price>   — set alert when price hits target
//        /alerts list                   — list active alerts
//        /alerts delete <id>            — delete an alert
//        /alerts clear                  — clear all alerts
// ============================================================================

import { randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getGordonDir } from "../../infra/storage/paths.ts";

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  direction: "above" | "below";
  createdAt: string;
  triggered: boolean;
}

function alertsPath(): string {
  return join(getGordonDir(), "alerts.json");
}

function isPriceAlert(value: unknown): value is PriceAlert {
  if (!value || typeof value !== "object") return false;
  const alert = value as Record<string, unknown>;
  return (
    typeof alert.id === "string" &&
    typeof alert.symbol === "string" &&
    typeof alert.targetPrice === "number" &&
    Number.isFinite(alert.targetPrice) &&
    alert.targetPrice > 0 &&
    (alert.direction === "above" || alert.direction === "below") &&
    typeof alert.createdAt === "string" &&
    typeof alert.triggered === "boolean"
  );
}

function loadAlerts(path: string): PriceAlert[] {
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!Array.isArray(parsed) || !parsed.every(isPriceAlert)) {
    throw new Error("alerts.json does not contain a valid alert list");
  }
  return parsed;
}

function saveAlerts(path: string, alerts: PriceAlert[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(alerts, null, 2), { encoding: "utf8", flag: "wx" });
    renameSync(tmp, path);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

function executeAlertsCommand(args: string, path: string): string {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "list";

  switch (subcommand) {
    case "set": {
      const symbol = parts[1]?.toUpperCase();
      const price = parseFloat(parts[2] ?? "0");
      const direction = parts[3]?.toLowerCase() === "below" ? "below" : "above";

      if (!symbol || !price || Number.isNaN(price)) {
        return "Usage: /alerts set <symbol> <price> [above|below]";
      }

      const alert: PriceAlert = {
        id: `alert_${randomUUID()}`,
        symbol,
        targetPrice: price,
        direction,
        createdAt: new Date().toISOString(),
        triggered: false,
      };

      const alerts = loadAlerts(path);
      alerts.push(alert);
      saveAlerts(path, alerts);

      return `Alert set: ${symbol} ${direction} $${price.toFixed(2)} (ID: ${alert.id})`;
    }

    case "list": {
      const alerts = loadAlerts(path).filter((a) => !a.triggered);
      if (alerts.length === 0)
        return "No active alerts. Use `/alerts set <symbol> <price>` to create one.";

      const lines = ["Active Alerts:", ""];
      for (const alert of alerts) {
        lines.push(
          `  ${alert.symbol.padEnd(12)} ${alert.direction.padEnd(6)} $${alert.targetPrice.toFixed(2).padStart(12)}  (${alert.id})`,
        );
      }
      lines.push("", `${alerts.length} alert${alerts.length > 1 ? "s" : ""} active`);
      return lines.join("\n");
    }

    case "delete": {
      const id = parts[1];
      if (!id) return "Usage: /alerts delete <id>";

      const alerts = loadAlerts(path);
      const filtered = alerts.filter((a) => a.id !== id);
      if (filtered.length === alerts.length) return `Alert not found: ${id}`;

      saveAlerts(path, filtered);
      return `Alert deleted: ${id}`;
    }

    case "clear": {
      saveAlerts(path, []);
      return "All alerts cleared.";
    }

    default:
      return "Usage: /alerts [set|list|delete|clear] <symbol> [price]";
  }
}

export function handleAlertsCommand(args: string): string {
  try {
    return executeAlertsCommand(args, alertsPath());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `Alerts unavailable: ${reason}`;
  }
}
