/**
 * Pre-Trade Risk Layer Gate — institutional 4-layer composite.
 *
 * Premise: institutional risk management enforces FOUR caps BEFORE a
 * trade is placed, multiplied together, never overridden. Retail
 * traders typically gate only one (per-trade risk) and discover the
 * other three after losing them. This primitive composes the four
 * caps as a single agent-callable pre-trade decision:
 *
 *   1. POSITION   — proposed trade's risk %  ≤  maxPerTradeRiskPct
 *   2. CORRELATION — any existing position with |corr| ≥ threshold:
 *                    (proposed + existing) exposure ≤ maxCorrelatedClusterPct
 *   3. SECTOR     — sum of all same-sector exposure + proposed
 *                    ≤ maxSectorExposurePct
 *   4. DRAWDOWN   — most recent day's running PnL ≤ -dailyDrawdownLimitPct
 *                    OR rolling N-day PnL ≤ -weeklyDrawdownLimitPct
 *
 * Output: per-layer verdict (`passed` / `blocked` / `data_gap`) +
 * composite verdict (`allow` / `block_position_size` / `block_correlation` /
 * `block_sector` / `block_drawdown_window` / `data_gap`).
 *
 * The "data_gap" verdict is critical: missing return series for
 * correlation, or insufficient PnL history for drawdown windows, must
 * not silently fall through to "allow." A retail-style override here
 * is precisely the failure mode this primitive prevents.
 *
 * Distinct from:
 *   - `infra/trading/risk/riskClassifier.ts` (15-dim pre-trade audit —
 *     8 base + 7 optional: vol-adjusted sizing, tail risk, regime, etc.;
 *     different axes; doesn't compose the institutional 4-layer cap stack)
 *   - `infra/trading/risk/correlationLimits.ts` (pairwise correlation
 *     multiplier for sizing — this primitive REUSES `pearsonCorrelation`
 *     but applies cluster cap not size multiplier)
 *   - `core/risk-management/daily-limits.ts` (DailyLimitTracker —
 *     day-only; this primitive adds the weekly window)
 *   - `wipeout-cap-sizer.ts` (single-trade wipeout floor — orthogonal
 *     to portfolio-level caps)
 *
 * Composes with:
 *   - `riskClassifier` (use this AFTER the 15-dim audit as the final
 *     pre-trade gate)
 *   - `mae-stop-calibrator` (LV33) (calibrates the per-trade stop;
 *     this gate then enforces the portfolio caps)
 *
 * Pedigree: institutional fund risk practice ("hedge-fund analyst
 * dinner" 2026 essay). Pure compute; no I/O. Reuses Pearson correlation
 * from existing `correlationLimits.ts`.
 */

import { pearsonCorrelation } from "../../infra/trading/risk/correlationLimits.ts";

export type TradeSide = "LONG" | "SHORT";

export interface TradeProposal {
  symbol: string;
  sector: string;
  /**
   * Trade exposure as a fraction of AUM (e.g. 0.05 = 5%). For most
   * institutional usage, callers pass risk-% (size × stop%) here so
   * the position-cap layer is in risk units. Sector layer aggregates
   * the same units across positions.
   */
  exposurePct: number;
  side: TradeSide;
  /**
   * Recent return series (oldest → newest) for correlation. Optional;
   * if missing, correlation layer emits data_gap and the gate blocks.
   */
  returnSeries?: ReadonlyArray<number>;
}

export interface ExistingPosition {
  symbol: string;
  sector: string;
  exposurePct: number;
  side: TradeSide;
  returnSeries?: ReadonlyArray<number>;
}

export interface PreTradeRiskGateOptions {
  /** Max per-trade exposure/risk fraction. Default 0.005 (0.5%). */
  maxPerTradeRiskPct?: number;
  /**
   * Max combined exposure for a "correlated cluster" — proposed + any
   * single existing position with |corr| ≥ correlationThreshold.
   * Default 0.0075 (0.75%).
   */
  maxCorrelatedClusterPct?: number;
  /**
   * |Correlation| threshold to consider two positions "correlated".
   * Default 0.5.
   */
  correlationThreshold?: number;
  /** Max sum-of-exposure within a single sector. Default 0.04 (4%). */
  maxSectorExposurePct?: number;
  /** Daily drawdown limit (positive fraction; block when PnL ≤ -limit). Default 0.01 (1%). */
  dailyDrawdownLimitPct?: number;
  /** Weekly (rolling-N-day) drawdown limit. Default 0.02 (2%). */
  weeklyDrawdownLimitPct?: number;
  /** Rolling window size for the weekly drawdown sum. Default 5 (trading days). */
  weeklyWindowDays?: number;
  /**
   * Minimum return-series length required for correlation. Below this
   * length, correlation is treated as zero (matching pearsonCorrelation
   * semantics). Default 10.
   */
  minReturnSeriesForCorrelation?: number;
}

export type LayerName =
  | "position_size"
  | "correlation"
  | "sector"
  | "drawdown_window";

export type LayerStatus = "passed" | "blocked" | "data_gap";

export interface LayerCheck {
  layer: LayerName;
  status: LayerStatus;
  observed: number;
  threshold: number;
  description: string;
  /** Optional payload depending on the layer. */
  detail?: Record<string, unknown>;
}

export type GateVerdict =
  | "allow"
  | "block_position_size"
  | "block_correlation"
  | "block_sector"
  | "block_drawdown_window"
  | "data_gap";

export interface PreTradeRiskGateResult {
  proposedSymbol: string;
  proposedSector: string;
  proposedExposurePct: number;
  layers: LayerCheck[];
  /** Which layer (if any) is the blocking one. null when verdict is "allow". */
  blockingLayer: LayerName | null;
  verdict: GateVerdict;
  /** True iff verdict === "allow". */
  allowed: boolean;
  summary: string;
}

const DEFAULT_MAX_PER_TRADE = 0.005;
const DEFAULT_MAX_CLUSTER = 0.0075;
const DEFAULT_CORR_THRESHOLD = 0.5;
const DEFAULT_MAX_SECTOR = 0.04;
const DEFAULT_DAILY_DD = 0.01;
const DEFAULT_WEEKLY_DD = 0.02;
const DEFAULT_WEEKLY_WINDOW = 5;
const DEFAULT_MIN_RETURNS = 10;

function describeLayer(
  layer: LayerName,
  status: LayerStatus,
  observed: number,
  threshold: number,
  context: string,
): string {
  const fmt = (x: number) => `${(x * 100).toFixed(3)}%`;
  if (status === "data_gap") {
    return `${layer} — data gap: ${context}`;
  }
  const verb = status === "passed" ? "within" : "exceeds";
  return `${layer} — ${fmt(observed)} ${verb} ${fmt(threshold)} cap (${context}).`;
}

export function checkPreTradeRiskGate(
  proposal: TradeProposal,
  existingPositions: ReadonlyArray<ExistingPosition>,
  recentDailyPnl: ReadonlyArray<number>,
  options: PreTradeRiskGateOptions = {},
): PreTradeRiskGateResult {
  const maxPerTrade = options.maxPerTradeRiskPct ?? DEFAULT_MAX_PER_TRADE;
  const maxCluster = options.maxCorrelatedClusterPct ?? DEFAULT_MAX_CLUSTER;
  const corrThreshold = options.correlationThreshold ?? DEFAULT_CORR_THRESHOLD;
  const maxSector = options.maxSectorExposurePct ?? DEFAULT_MAX_SECTOR;
  const dailyDd = options.dailyDrawdownLimitPct ?? DEFAULT_DAILY_DD;
  const weeklyDd = options.weeklyDrawdownLimitPct ?? DEFAULT_WEEKLY_DD;
  const weeklyWindow = options.weeklyWindowDays ?? DEFAULT_WEEKLY_WINDOW;
  const minReturns = options.minReturnSeriesForCorrelation ?? DEFAULT_MIN_RETURNS;

  const layers: LayerCheck[] = [];

  // === Layer 1: position size ===
  const posStatus: LayerStatus =
    proposal.exposurePct <= maxPerTrade ? "passed" : "blocked";
  layers.push({
    layer: "position_size",
    status: posStatus,
    observed: parseFloat(proposal.exposurePct.toFixed(6)),
    threshold: parseFloat(maxPerTrade.toFixed(6)),
    description: describeLayer(
      "position_size",
      posStatus,
      proposal.exposurePct,
      maxPerTrade,
      `proposed exposure for ${proposal.symbol}`,
    ),
  });

  // === Layer 2: correlation cluster ===
  let corrStatus: LayerStatus = "passed";
  let maxClusterExposure = proposal.exposurePct;
  let mostCorrelatedSymbol: string | null = null;
  let maxCorr = 0;
  let dataGapDetail = "";
  if (existingPositions.length > 0) {
    if (!proposal.returnSeries || proposal.returnSeries.length < minReturns) {
      corrStatus = "data_gap";
      dataGapDetail = `proposal returnSeries length ${proposal.returnSeries?.length ?? 0} < ${minReturns}`;
    } else {
      for (const existing of existingPositions) {
        if (!existing.returnSeries || existing.returnSeries.length < minReturns) {
          corrStatus = "data_gap";
          dataGapDetail = `existing ${existing.symbol} returnSeries length ${existing.returnSeries?.length ?? 0} < ${minReturns}`;
          break;
        }
        const corr = pearsonCorrelation(
          [...proposal.returnSeries],
          [...existing.returnSeries],
        );
        if (Math.abs(corr) >= corrThreshold) {
          const cluster = proposal.exposurePct + existing.exposurePct;
          if (cluster > maxClusterExposure) {
            maxClusterExposure = cluster;
            mostCorrelatedSymbol = existing.symbol;
            maxCorr = corr;
          }
        }
      }
      if (corrStatus !== "data_gap") {
        corrStatus = maxClusterExposure <= maxCluster ? "passed" : "blocked";
      }
    }
  }
  layers.push({
    layer: "correlation",
    status: corrStatus,
    observed: parseFloat(maxClusterExposure.toFixed(6)),
    threshold: parseFloat(maxCluster.toFixed(6)),
    description:
      corrStatus === "data_gap"
        ? describeLayer("correlation", corrStatus, 0, maxCluster, dataGapDetail)
        : describeLayer(
            "correlation",
            corrStatus,
            maxClusterExposure,
            maxCluster,
            mostCorrelatedSymbol
              ? `cluster with ${mostCorrelatedSymbol} (corr=${maxCorr.toFixed(3)})`
              : "no correlated existing position",
          ),
    detail: {
      mostCorrelatedSymbol,
      maxCorrelation: parseFloat(maxCorr.toFixed(4)),
    },
  });

  // === Layer 3: sector aggregate ===
  let sectorExposure = proposal.exposurePct;
  for (const existing of existingPositions) {
    if (existing.sector === proposal.sector) {
      sectorExposure += existing.exposurePct;
    }
  }
  const sectorStatus: LayerStatus =
    sectorExposure <= maxSector ? "passed" : "blocked";
  layers.push({
    layer: "sector",
    status: sectorStatus,
    observed: parseFloat(sectorExposure.toFixed(6)),
    threshold: parseFloat(maxSector.toFixed(6)),
    description: describeLayer(
      "sector",
      sectorStatus,
      sectorExposure,
      maxSector,
      `${proposal.sector} aggregate exposure`,
    ),
    detail: { sector: proposal.sector },
  });

  // === Layer 4: multi-window drawdown ===
  let ddStatus: LayerStatus = "passed";
  let observedDd = 0;
  let ddDescription = "";
  let ddDetail: Record<string, unknown> = {};
  if (recentDailyPnl.length === 0) {
    ddStatus = "data_gap";
    ddDescription = describeLayer(
      "drawdown_window",
      "data_gap",
      0,
      dailyDd,
      "no PnL history supplied",
    );
  } else {
    const today = recentDailyPnl[recentDailyPnl.length - 1]!;
    const window = Math.min(weeklyWindow, recentDailyPnl.length);
    const recent = recentDailyPnl.slice(-window);
    const weekSum = recent.reduce((s, v) => s + v, 0);
    // Block if today's PnL is at-or-below -dailyDd, OR weekSum at-or-below -weeklyDd
    const dailyTriggered = today <= -dailyDd;
    const weeklyTriggered = weekSum <= -weeklyDd;
    ddDetail = {
      todayPnl: parseFloat(today.toFixed(6)),
      weeklyWindowDays: window,
      weeklyWindowSum: parseFloat(weekSum.toFixed(6)),
      dailyLimit: dailyDd,
      weeklyLimit: weeklyDd,
    };
    if (dailyTriggered) {
      ddStatus = "blocked";
      observedDd = -today;
      ddDescription = describeLayer(
        "drawdown_window",
        "blocked",
        observedDd,
        dailyDd,
        `today's PnL ${(today * 100).toFixed(3)}% breached daily cap`,
      );
    } else if (weeklyTriggered) {
      ddStatus = "blocked";
      observedDd = -weekSum;
      ddDescription = describeLayer(
        "drawdown_window",
        "blocked",
        observedDd,
        weeklyDd,
        `${window}-day rolling PnL ${(weekSum * 100).toFixed(3)}% breached weekly cap`,
      );
    } else {
      observedDd = Math.max(-today, -weekSum, 0);
      ddDescription = describeLayer(
        "drawdown_window",
        "passed",
        observedDd,
        Math.min(dailyDd, weeklyDd),
        `today ${(today * 100).toFixed(3)}%, ${window}-day ${(weekSum * 100).toFixed(3)}%`,
      );
    }
  }
  layers.push({
    layer: "drawdown_window",
    status: ddStatus,
    observed: parseFloat(observedDd.toFixed(6)),
    threshold: parseFloat(Math.min(dailyDd, weeklyDd).toFixed(6)),
    description: ddDescription,
    detail: ddDetail,
  });

  // === Verdict ===
  let verdict: GateVerdict = "allow";
  let blockingLayer: LayerName | null = null;
  // Priority: any data_gap → data_gap (institutional discipline:
  // missing data must not silently allow). Otherwise first blocked layer
  // in priority order.
  const dataGapLayer = layers.find((l) => l.status === "data_gap");
  if (dataGapLayer) {
    verdict = "data_gap";
    blockingLayer = dataGapLayer.layer;
  } else {
    const blocked = layers.find((l) => l.status === "blocked");
    if (blocked) {
      blockingLayer = blocked.layer;
      switch (blocked.layer) {
        case "position_size":
          verdict = "block_position_size";
          break;
        case "correlation":
          verdict = "block_correlation";
          break;
        case "sector":
          verdict = "block_sector";
          break;
        case "drawdown_window":
          verdict = "block_drawdown_window";
          break;
      }
    }
  }

  const summary =
    verdict === "allow"
      ? `ALLOW — all 4 layers passed for ${proposal.symbol} (${proposal.sector}).`
      : verdict === "data_gap"
        ? `BLOCKED on ${blockingLayer} (data gap) — institutional discipline requires complete inputs.`
        : `BLOCKED on ${blockingLayer} — ${layers.find((l) => l.layer === blockingLayer)?.description ?? ""}`;

  return {
    proposedSymbol: proposal.symbol,
    proposedSector: proposal.sector,
    proposedExposurePct: parseFloat(proposal.exposurePct.toFixed(6)),
    layers,
    blockingLayer,
    verdict,
    allowed: verdict === "allow",
    summary,
  };
}

export function formatPreTradeRiskGate(result: PreTradeRiskGateResult): string {
  const lines = [
    `Pre-Trade Risk Layer Gate — ${result.verdict.toUpperCase()}${result.allowed ? "" : ` (blocked on ${result.blockingLayer})`}`,
    "",
    `  Symbol:         ${result.proposedSymbol}`,
    `  Sector:         ${result.proposedSector}`,
    `  Exposure:       ${(result.proposedExposurePct * 100).toFixed(3)}%`,
    "",
    `  Layers:`,
  ];
  for (const l of result.layers) {
    const tag =
      l.status === "passed" ? "[PASS]" : l.status === "blocked" ? "[BLOCK]" : "[GAP] ";
    lines.push(`    ${tag} ${l.description}`);
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
