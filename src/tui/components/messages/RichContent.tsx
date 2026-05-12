import React from "react";
import { Box, Text } from "../../ink-custom";
import { DataTable, fmtNum, fmtPct, changeColor, type Column } from "../charts/DataTable.tsx";
import { InlineChart } from "../charts/InlineChart.tsx";
import { MarkdownRenderer } from "./MarkdownRenderer.js";
import { getRenderer } from "../../renderers/index.js";

// ============================================================================
// RichContent — Renders message content with rich formatting
//
// Detects structured data in content and renders via appropriate components:
// - JSON table data → DataTable (ticker-grade)
// - Price history arrays → InlineChart (sparkline)
// - Long output → CollapsibleOutput
// - Markdown → formatted text
// ============================================================================

interface Props {
  content: string;
}

export function RichContent({ content }: Props) {
  // Try to detect and render structured JSON data
  const structured = tryParseStructuredData(content);
  if (structured) {
    return <>{structured}</>;
  }

  // Full content always rendered — VirtualMessageList handles scroll.
  return <MarkdownRenderer content={content} />;
}

// ============================================================================
// Structured data detection — JSON tables, price arrays
// ============================================================================

function tryParseStructuredData(content: string): React.ReactNode | null {
  // Look for JSON blocks in the content
  const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]!);
      return renderStructuredJson(data, content.replace(jsonMatch[0], "").trim());
    } catch {
      // Not valid JSON, fall through
    }
  }

  // Try the whole content as JSON
  const trimmed = content.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      return renderStructuredJson(data, "");
    } catch {
      // Not JSON
    }
  }

  return null;
}

function renderStructuredJson(data: unknown, surroundingText: string): React.ReactNode {
  const elements: React.ReactNode[] = [];

  // Surrounding text before the data
  if (surroundingText) {
    elements.push(
      <Box key="text" flexDirection="column">
        {surroundingText.split("\n").map((line, i) => (
          <RichLine key={i} line={line} />
        ))}
      </Box>
    );
  }

  // ── Phase 10: Check if data matches a specialized renderer ──
  const rendererMatch = detectRenderer(data);
  if (rendererMatch) {
    const Renderer = getRenderer(rendererMatch.name);
    if (Renderer) {
      elements.push(<Renderer key="renderer" {...rendererMatch.props} />);
      return <>{elements}</>;
    }
  }

  // Array of objects → DataTable
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
    const rows = data as Record<string, unknown>[];
    const keys = Object.keys(rows[0]!);
    const columns = inferColumns(keys, rows);

    // Check for price history in any row
    const priceKey = keys.find((k) => k.toLowerCase().includes("sparkline") || k.toLowerCase().includes("history"));
    const priceData = priceKey ? rows.map((r) => r[priceKey]).filter(Array.isArray).flat().map(Number) : null;

    elements.push(
      <DataTable
        key="table"
        columns={columns}
        data={rows}
        /* borderColor omitted — DataTable uses plain aligned columns */
      />
    );

    if (priceData && priceData.length > 2) {
      elements.push(
        <Box key="chart" paddingLeft={2} marginBottom={1}>
          <InlineChart data={priceData} width={30} />
        </Box>
      );
    }

    return <>{elements}</>;
  }

  // Single object → key-value display
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const rows = Object.entries(obj).map(([key, value]) => ({
      field: key.toUpperCase(),
      value: typeof value === "number" ? fmtNum(value) : String(value ?? "\u2014"),
    }));

    elements.push(
      <DataTable
        key="kv"
        columns={[
          { key: "field", header: "FIELD", width: 14, align: "left" as const },
          { key: "value", header: "VALUE", width: 20, align: "right" as const },
        ]}
        data={rows}
        /* borderColor omitted — DataTable uses plain aligned columns */
      />
    );

    return <>{elements}</>;
  }

  return null;
}

// ============================================================================
// Renderer shape detection — routes structured data to Phase 10 renderers
// ============================================================================

function detectRenderer(data: unknown): { name: string; props: Record<string, unknown> } | null {
  if (data == null) return null;

  // ── Array shapes ──
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
    const first = data[0] as Record<string, unknown>;
    const keys = Object.keys(first);

    // scan: array with symbol + price + signal
    if (keys.includes("symbol") && keys.includes("price") && keys.includes("signal")) {
      return { name: "scan", props: { data } };
    }

    // position: array with symbol + side + qty + pnl
    if (keys.includes("symbol") && keys.includes("side") && keys.includes("qty") && keys.includes("pnl")) {
      return { name: "position", props: { data } };
    }

    // help: array with name + description + workflow
    if (keys.includes("name") && keys.includes("description") && keys.includes("workflow")) {
      return { name: "help", props: { commands: data } };
    }

    // strategy: array with name + status + pnl + sharpe
    if (keys.includes("name") && keys.includes("status") && keys.includes("pnl") && keys.includes("sharpe")) {
      return { name: "strategy", props: { data } };
    }
  }

  // ── Object shapes ──
  if (typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);

    // analysis: object with supports + resistances
    if (keys.includes("supports") && keys.includes("resistances")) {
      return { name: "analysis", props: { data: obj } };
    }

    // plan: object with symbol + side + entry + stop
    if (keys.includes("symbol") && keys.includes("side") && keys.includes("entry") && keys.includes("stop")) {
      return { name: "plan", props: { data: obj } };
    }

    // backtest: object with strategy + returnPct (or sharpe)
    if (keys.includes("strategy") && (keys.includes("returnPct") || keys.includes("sharpe"))) {
      return { name: "backtest", props: { data: obj } };
    }

    // orderbook: object with bids + asks
    if (keys.includes("bids") && keys.includes("asks")) {
      return { name: "orderbook", props: { data: obj } };
    }

    // doctor: object with checks array
    if (keys.includes("checks") && Array.isArray(obj.checks)) {
      return { name: "doctor", props: { data: obj } };
    }

    // risk: object with positionSize + dailyLoss + drawdown + leverage
    if (keys.includes("positionSize") && keys.includes("dailyLoss") && keys.includes("drawdown") && keys.includes("leverage")) {
      return { name: "risk", props: { data: obj } };
    }

    // marketanalysis: object with symbol + type + summary + signal + confidence (deep/ensemble/mtf)
    if (keys.includes("symbol") && keys.includes("type") && keys.includes("summary") && keys.includes("confidence") &&
        (keys.includes("timeframes") || keys.includes("ensemble") || keys.includes("keyLevels"))) {
      return { name: "marketanalysis", props: { data: obj } };
    }

    // indicator: object with rsi + macd + trend
    if (keys.includes("rsi") && keys.includes("macd") && keys.includes("trend") && keys.includes("macdState")) {
      return { name: "indicator", props: { data: obj } };
    }

    // liquidation: object with currentPrice + levels array
    if (keys.includes("currentPrice") && keys.includes("levels") && Array.isArray(obj.levels)) {
      return { name: "liquidation", props: { data: obj } };
    }
  }

  return null;
}

// ============================================================================
// Infer DataTable columns from data shape
// ============================================================================

function inferColumns(keys: string[], rows: Record<string, unknown>[]): Column<Record<string, unknown>>[] {
  return keys.map((key) => {
    const lower = key.toLowerCase();
    const isNumeric = rows.every((r) => typeof r[key] === "number" || r[key] == null);
    const isPct = lower.includes("pct") || lower.includes("change") || lower.includes("pnl%") || lower.includes("win");
    const isPrice = lower.includes("price") || lower.includes("last") || lower.includes("entry") || lower.includes("mark");
    const isSide = lower === "side";
    const isStatus = lower === "status";
    const isSignal = lower === "signal" || lower === "sig";

    // Header: use short labels for known fields
    const header = HEADER_MAP[lower] ?? key.toUpperCase().slice(0, 8);

    // Width
    const width = lower === "symbol" || lower === "sym" ? 8
      : isPct ? 8
      : isPrice ? 10
      : isNumeric ? 10
      : isSide ? 6
      : isStatus || isSignal ? 8
      : 12;

    // Alignment
    const align = isNumeric || isPct || isPrice ? "right" as const : "left" as const;

    // Color function
    const color = isPct
      ? (val: unknown) => changeColor(Number(val))
      : isSide
      ? (val: unknown) => String(val).toLowerCase().includes("long") || String(val).toLowerCase().includes("buy") ? "green" : "red"
      : isStatus
      ? (val: unknown) => {
          const s = String(val).toLowerCase();
          return s.includes("active") || s.includes("filled") || s.includes("ok") ? "green"
            : s.includes("paused") || s.includes("partial") || s.includes("pending") ? "yellow"
            : s.includes("error") || s.includes("fail") || s.includes("cancelled") ? "red"
            : undefined;
        }
      : undefined;

    // Format function
    const format = isPct
      ? (val: unknown) => fmtPct(Number(val))
      : isPrice || isNumeric
      ? (val: unknown) => fmtNum(Number(val))
      : undefined;

    return { key, header, width, align, color, format };
  });
}

const HEADER_MAP: Record<string, string> = {
  symbol: "SYM",
  sym: "SYM",
  price: "LAST",
  last: "LAST",
  change: "CHG$",
  changepct: "CHG%",
  change_pct: "CHG%",
  volume: "VOL",
  vol: "VOL",
  signal: "SIG",
  side: "SIDE",
  qty: "QTY",
  quantity: "QTY",
  entry: "ENTRY",
  mark: "MARK",
  pnl: "PNL",
  pnlpct: "PNL%",
  pnl_pct: "PNL%",
  leverage: "LEV",
  status: "STATUS",
  name: "NAME",
  strategy: "STRAT",
  winrate: "WIN%",
  win_rate: "WIN%",
  sharpe: "SHARPE",
  maxdrawdown: "MDD%",
  max_drawdown: "MDD%",
  trades: "TRADES",
};

// ============================================================================
// Line-level rendering (markdown-aware)
// ============================================================================

function RichLine({ line }: { line: string }) {
  if (line.trim() === "") return <Text> </Text>;

  if (line.startsWith("### ")) return <Text bold>  {line.slice(4)}</Text>;
  if (line.startsWith("## ")) return <Text bold>  {line.slice(3)}</Text>;
  if (line.startsWith("# ")) return <Text bold color="yellow">  {line.slice(2)}</Text>;

  if (line.startsWith("```")) return <Text dimColor>  {"\u2500".repeat(30)}</Text>;

  if (line.match(/^\s*[-*]\s/)) return <Text>  {"\u2022"} {line.replace(/^\s*[-*]\s/, "")}</Text>;
  if (line.match(/^\s*\d+\.\s/)) return <Text>  {line.trimStart()}</Text>;

  // Pipe-separated table rows — render as a single Text with padded cells.
  // Previously used nested Box children with fixed widths that made Ink
  // word-wrap each cell into 2-3 character columns, producing the classic
  // multi-column-interleave glitch. The fix: join cells with spacing into
  // one string; if the row is too wide for the terminal, Ink's own Text
  // wrap handles it gracefully instead of per-cell flexbox collapse.
  if (line.includes("|") && line.split("|").length >= 3) {
    // Skip separator rows (---|---|---)
    if (line.match(/^\s*\|?\s*[-:]+\s*\|/)) return null;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    return <Text>  {cells.join("  ")}</Text>;
  }

  if (line.startsWith("> ")) return <Text dimColor>  {line.slice(2)}</Text>;

  return <Text>  {line}</Text>;
}
