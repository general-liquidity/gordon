/**
 * ExportDialog — Export trades, sessions, and strategies to file
 *
 * Options:
 *   - Export Trades (CSV)
 *   - Export Session (JSON)
 *   - Export Strategies (JSON)
 *
 * Uses Select for format choice. Writes to file via fs.writeFile.
 *
 * Phase 17 of the TUI rebuild.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Types
// ============================================================================

export type ExportFormat = "trades-csv" | "session-json" | "strategies-json";

export interface TradeRecord {
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  timestamp: string;
  pnl?: number;
}

export interface SessionRecord {
  sessionId: string;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  startedAt: string;
  endedAt?: string;
}

export interface StrategyRecord {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface Props {
  onClose: () => void;
  trades?: TradeRecord[];
  session?: SessionRecord;
  strategies?: StrategyRecord[];
}

// ============================================================================
// Helpers
// ============================================================================

function tradesToCsv(trades: TradeRecord[]): string {
  const header = "Symbol,Side,Quantity,Price,Timestamp,PnL";
  const rows = trades.map(
    (t) =>
      `${t.symbol},${t.side},${t.quantity},${t.price},${t.timestamp},${t.pnl ?? ""}`,
  );
  return [header, ...rows].join("\n");
}

function getExportDir(): string {
  return path.join(os.homedir(), ".gordon", "exports");
}

function ensureExportDir(): void {
  const dir = getExportDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ============================================================================
// Component
// ============================================================================

export function ExportDialog({ onClose, trades, session, strategies }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [exportedPath, setExportedPath] = useState<string | null>(null);

  useInput((_, key) => {
    if (key.escape) onClose();
  });

  const handleExport = useCallback(
    (format: string) => {
      try {
        ensureExportDir();
        const dir = getExportDir();
        const ts = timestamp();
        let filePath: string;
        let content: string;

        switch (format as ExportFormat) {
          case "trades-csv": {
            filePath = path.join(dir, `trades-${ts}.csv`);
            content = tradesToCsv(trades ?? []);
            break;
          }
          case "session-json": {
            filePath = path.join(dir, `session-${ts}.json`);
            content = JSON.stringify(session ?? {}, null, 2);
            break;
          }
          case "strategies-json": {
            filePath = path.join(dir, `strategies-${ts}.json`);
            content = JSON.stringify(strategies ?? [], null, 2);
            break;
          }
          default:
            setStatus("Unknown format");
            return;
        }

        fs.writeFileSync(filePath, content, "utf-8");
        setExportedPath(filePath);
        setStatus("success");
      } catch (err) {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [trades, session, strategies],
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      <Box>
        <Text bold color="cyan">EXPORT DATA</Text>
      </Box>
      <Text> </Text>

      {status === "success" ? (
        <Box flexDirection="column">
          <Text color="green">{"\u2713"} Export complete</Text>
          <Text dimColor>  {exportedPath}</Text>
          <Text> </Text>
          <Text dimColor>Press Esc to close</Text>
        </Box>
      ) : status ? (
        <Box flexDirection="column">
          <Text color="red">{status}</Text>
          <Text> </Text>
          <Text dimColor>Press Esc to close</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text dimColor>Choose export format:</Text>
          <Text> </Text>
          <Select
            options={[
              { label: "Export Trades (CSV)", value: "trades-csv" },
              { label: "Export Session (JSON)", value: "session-json" },
              { label: "Export Strategies (JSON)", value: "strategies-json" },
            ]}
            onChange={handleExport}
          />
          <Text> </Text>
          <Text dimColor>Esc to cancel</Text>
        </Box>
      )}
    </Box>
  );
}
