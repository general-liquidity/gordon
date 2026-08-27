/**
 * Portfolio Diff — Before/After Visualization
 *
 * Trading equivalent of Claude Code's diff viewer. Shows red/green
 * inline diffs of any proposed portfolio change: rebalance, new position,
 * exit, stop-loss adjustment.
 *
 * Generates structured diff objects that the TUI can render as colored
 * terminal output (green = added/increased, red = removed/decreased).
 */

// ============================================================================
// Types
// ============================================================================

export interface PositionState {
  symbol: string;
  side: "long" | "short" | "none";
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  notionalUsd: number;
  weightPct: number;
  unrealizedPnl: number;
}

export interface PortfolioState {
  timestamp: string;
  totalValueUsd: number;
  cashUsd: number;
  positions: PositionState[];
}

export type DiffAction = "added" | "removed" | "increased" | "decreased" | "unchanged" | "modified";

export interface PositionDiff {
  symbol: string;
  action: DiffAction;
  before: PositionState | null;
  after: PositionState | null;
  /** Change in quantity. */
  quantityDelta: number;
  /** Change in notional USD. */
  notionalDelta: number;
  /** Change in portfolio weight. */
  weightDelta: number;
  /** Estimated P&L impact of the change. */
  estimatedPnlImpact: number;
  /** Estimated fee cost of the change. */
  estimatedFeesUsd: number;
}

export interface PortfolioDiff {
  before: PortfolioState;
  after: PortfolioState;
  positions: PositionDiff[];
  /** Net cash change. */
  cashDelta: number;
  /** Total estimated fees. */
  totalFeesUsd: number;
  /** Total estimated P&L impact. */
  totalPnlImpact: number;
  /** Number of trades required. */
  tradesRequired: number;
  /** Summary statistics. */
  summary: {
    added: number;
    removed: number;
    increased: number;
    decreased: number;
    unchanged: number;
  };
}

// ============================================================================
// Diff Computation
// ============================================================================

/**
 * Compute the diff between two portfolio states.
 *
 * @param before - Current portfolio
 * @param after - Proposed portfolio
 * @param feeRate - Estimated fee rate for trades (default 0.1%)
 */
export function computePortfolioDiff(
  before: PortfolioState,
  after: PortfolioState,
  feeRate: number = 0.001,
): PortfolioDiff {
  const beforeMap = new Map(before.positions.map((p) => [p.symbol, p]));
  const afterMap = new Map(after.positions.map((p) => [p.symbol, p]));
  const allSymbols = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const positions: PositionDiff[] = [];
  const summary = { added: 0, removed: 0, increased: 0, decreased: 0, unchanged: 0 };
  let totalFees = 0;
  let totalPnlImpact = 0;
  let tradesRequired = 0;

  for (const symbol of allSymbols) {
    const b = beforeMap.get(symbol) ?? null;
    const a = afterMap.get(symbol) ?? null;

    const bQty = b?.quantity ?? 0;
    const aQty = a?.quantity ?? 0;
    const bNotional = b?.notionalUsd ?? 0;
    const aNotional = a?.notionalUsd ?? 0;
    const bWeight = b?.weightPct ?? 0;
    const aWeight = a?.weightPct ?? 0;

    let action: DiffAction;
    if (!b && a) {
      action = "added";
      summary.added++;
    } else if (b && !a) {
      action = "removed";
      summary.removed++;
    } else if (aQty > bQty) {
      action = "increased";
      summary.increased++;
    } else if (aQty < bQty) {
      action = "decreased";
      summary.decreased++;
    } else if (b && a && (b.side !== a.side || Math.abs(b.avgPrice - a.avgPrice) > 0.01)) {
      action = "modified";
      summary.decreased++; // Count as change
    } else {
      action = "unchanged";
      summary.unchanged++;
    }

    const qtyDelta = aQty - bQty;
    const notionalDelta = aNotional - bNotional;
    const tradeNotional = Math.abs(notionalDelta);
    const fees = tradeNotional * feeRate;

    // P&L impact: for removals/decreases, realize current unrealized P&L
    let pnlImpact = 0;
    if (b && (action === "removed" || action === "decreased")) {
      const closingQty = Math.abs(qtyDelta);
      const pnlPerUnit =
        b.side === "long" ? b.currentPrice - b.avgPrice : b.avgPrice - b.currentPrice;
      pnlImpact = pnlPerUnit * closingQty - fees;
    }

    if (action !== "unchanged") {
      tradesRequired++;
      totalFees += fees;
      totalPnlImpact += pnlImpact;
    }

    positions.push({
      symbol,
      action,
      before: b,
      after: a,
      quantityDelta: qtyDelta,
      notionalDelta,
      weightDelta: aWeight - bWeight,
      estimatedPnlImpact: pnlImpact,
      estimatedFeesUsd: fees,
    });
  }

  // Sort: changes first (added, removed, modified), then unchanged
  const actionOrder: Record<DiffAction, number> = {
    added: 0,
    removed: 1,
    increased: 2,
    decreased: 3,
    modified: 4,
    unchanged: 5,
  };
  positions.sort((a, b) => actionOrder[a.action] - actionOrder[b.action]);

  return {
    before,
    after,
    positions,
    cashDelta: after.cashUsd - before.cashUsd,
    totalFeesUsd: totalFees,
    totalPnlImpact: totalPnlImpact,
    tradesRequired,
    summary,
  };
}

// ============================================================================
// Formatting (for terminal display)
// ============================================================================

const ACTION_SYMBOLS: Record<DiffAction, string> = {
  added: "+",
  removed: "-",
  increased: "▲",
  decreased: "▼",
  modified: "~",
  unchanged: " ",
};

const ACTION_COLORS: Record<DiffAction, "green" | "red" | "yellow" | "dim"> = {
  added: "green",
  removed: "red",
  increased: "green",
  decreased: "red",
  modified: "yellow",
  unchanged: "dim",
};

/**
 * Format a portfolio diff as terminal-ready lines with color hints.
 */
export function formatPortfolioDiff(diff: PortfolioDiff): Array<{
  text: string;
  color: "green" | "red" | "yellow" | "dim" | "default";
}> {
  const lines: Array<{ text: string; color: "green" | "red" | "yellow" | "dim" | "default" }> = [];

  lines.push({ text: "Portfolio Diff", color: "default" });
  lines.push({
    text: `  ${diff.summary.added} added, ${diff.summary.removed} removed, ${diff.summary.increased} increased, ${diff.summary.decreased} decreased`,
    color: "default",
  });
  lines.push({
    text: `  ${diff.tradesRequired} trades, ~$${diff.totalFeesUsd.toFixed(2)} fees, ~$${diff.totalPnlImpact.toFixed(2)} P&L impact`,
    color: "default",
  });
  lines.push({ text: "", color: "default" });

  for (const pos of diff.positions) {
    if (pos.action === "unchanged") continue;

    const sym = ACTION_SYMBOLS[pos.action];
    const color = ACTION_COLORS[pos.action];
    const before = pos.before ? `${pos.before.quantity} @ $${pos.before.avgPrice.toFixed(2)}` : "—";
    const after = pos.after ? `${pos.after.quantity} @ $${(pos.after.avgPrice).toFixed(2)}` : "—";
    const weight = pos.after ? `${pos.after.weightPct.toFixed(1)}%` : "0%";

    lines.push({
      text: `  ${sym} ${pos.symbol.padEnd(12)} ${before.padEnd(20)} → ${after.padEnd(20)} (${weight})`,
      color,
    });

    if (pos.estimatedPnlImpact !== 0) {
      const pnlSign = pos.estimatedPnlImpact >= 0 ? "+" : "";
      lines.push({
        text: `    P&L: ${pnlSign}$${pos.estimatedPnlImpact.toFixed(2)}, Fees: $${pos.estimatedFeesUsd.toFixed(2)}`,
        color: pos.estimatedPnlImpact >= 0 ? "green" : "red",
      });
    }
  }

  lines.push({ text: "", color: "default" });
  lines.push({
    text: `  Cash: $${diff.before.cashUsd.toFixed(2)} → $${diff.after.cashUsd.toFixed(2)} (${diff.cashDelta >= 0 ? "+" : ""}$${diff.cashDelta.toFixed(2)})`,
    color: diff.cashDelta >= 0 ? "green" : "red",
  });

  return lines;
}
