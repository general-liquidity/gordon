/**
 * Discounted Cash Flow (DCF) — pure-function intrinsic-value calc.
 *
 * Standard two-stage model: explicit free-cash-flow projections for N
 * periods + Gordon-growth terminal value, both discounted by WACC.
 * Optional bear / bull cases run the same math with alternative growth
 * and discount rates so the operator gets a sensitivity band.
 *
 * Outputs include the standalone components (enterprise value, equity
 * value) plus a small sensitivity table over a +/- WACC and terminal-
 * growth grid — the operator typically eyeballs this rather than
 * accepting a single point estimate.
 *
 * Assumption surfaced for the operator:
 *   - FCF projections are NOMINAL (no inflation adjustment beyond
 *     what the operator already baked in).
 *   - Terminal value assumes the firm grows perpetually at
 *     terminalGrowthPct AFTER the last projection year.
 *   - WACC > terminalGrowthPct is required (otherwise terminal value
 *     diverges); we error out rather than return Infinity.
 *
 * Not a primitive for: cyclical businesses, growth stocks where
 * terminal value dominates, or pre-revenue firms where FCF is
 * negative. Honest about scope.
 */

export interface DcfCase {
  /** Discount rate. Annual, decimal (e.g. 0.09 for 9%). */
  wacc: number;
  /** Perpetual growth rate after the explicit period. Must be < wacc. */
  terminalGrowthPct: number;
}

export interface DcfInput {
  /** Free cash flow per period, in order. Currency is whatever the
   *  operator supplied — must match `sharesOutstanding` denomination. */
  fcfProjections: number[];
  /** Net cash position at t=0 (cash - debt). Added to enterprise value
   *  to get equity value. Negative when the firm is net-debt. */
  netCash: number;
  /** Diluted shares outstanding for per-share output. Defaults to 1
   *  (returns equity value as-is) when omitted. */
  sharesOutstanding?: number;
  /** Base case. */
  base: DcfCase;
  /** Optional bear case — typically higher WACC + lower terminal
   *  growth. */
  bear?: DcfCase;
  /** Optional bull case — typically lower WACC + higher terminal
   *  growth. */
  bull?: DcfCase;
}

export interface DcfCaseResult {
  enterpriseValue: number;
  equityValue: number;
  pricePerShare: number;
  /** Sum of discounted explicit-period FCFs. */
  pvOfExplicitPeriod: number;
  /** Discounted terminal value. */
  pvOfTerminalValue: number;
  /** Share of equity value coming from terminal value (0..1). High
   *  fraction = high model sensitivity to terminal assumptions. */
  terminalFraction: number;
}

export interface DcfSensitivityRow {
  wacc: number;
  terminalGrowthPct: number;
  pricePerShare: number;
}

export interface DcfResult {
  base: DcfCaseResult;
  bear: DcfCaseResult | null;
  bull: DcfCaseResult | null;
  /** Grid of price-per-share at varying WACC and terminal growth. */
  sensitivity: DcfSensitivityRow[];
  /** One-line operator summary. */
  interpretation: string;
}

function validateCase(c: DcfCase, label: string): void {
  if (!Number.isFinite(c.wacc) || c.wacc <= 0) {
    throw new Error(`DCF ${label}: wacc must be a positive finite number; got ${c.wacc}`);
  }
  if (!Number.isFinite(c.terminalGrowthPct)) {
    throw new Error(`DCF ${label}: terminalGrowthPct must be finite; got ${c.terminalGrowthPct}`);
  }
  if (c.wacc <= c.terminalGrowthPct) {
    throw new Error(
      `DCF ${label}: wacc (${c.wacc}) must exceed terminalGrowthPct (${c.terminalGrowthPct}) — terminal value would diverge.`,
    );
  }
}

function runCase(
  fcfProjections: number[],
  netCash: number,
  shares: number,
  c: DcfCase,
): DcfCaseResult {
  validateCase(c, "case");
  const n = fcfProjections.length;
  if (n === 0) {
    throw new Error("DCF: fcfProjections must have at least one period");
  }

  let pvExplicit = 0;
  for (let t = 0; t < n; t++) {
    const fcf = fcfProjections[t]!;
    if (!Number.isFinite(fcf)) {
      throw new Error(`DCF: fcfProjections[${t}] is not finite`);
    }
    // Discount factor at end-of-period convention: 1/(1+w)^(t+1).
    pvExplicit += fcf / Math.pow(1 + c.wacc, t + 1);
  }

  // Terminal value: TV_N = FCF_N * (1 + g) / (w - g). Discounted back
  // from the END of year N, so divisor exponent is N.
  const lastFcf = fcfProjections[n - 1]!;
  const terminalValue = (lastFcf * (1 + c.terminalGrowthPct)) / (c.wacc - c.terminalGrowthPct);
  const pvTerminal = terminalValue / Math.pow(1 + c.wacc, n);

  const enterpriseValue = pvExplicit + pvTerminal;
  const equityValue = enterpriseValue + netCash;
  const pricePerShare = equityValue / shares;
  const terminalFraction = equityValue > 0 ? pvTerminal / equityValue : 0;

  return {
    enterpriseValue,
    equityValue,
    pricePerShare,
    pvOfExplicitPeriod: pvExplicit,
    pvOfTerminalValue: pvTerminal,
    terminalFraction,
  };
}

/** Sensitivity grid — +/- 100 bps WACC and terminal growth around the
 *  base case. Five points per axis = 25 cells. Cheap to compute,
 *  surfaces how brittle the point estimate is. */
function buildSensitivity(
  fcfProjections: number[],
  netCash: number,
  shares: number,
  base: DcfCase,
): DcfSensitivityRow[] {
  const waccDeltas = [-0.01, -0.005, 0, 0.005, 0.01];
  const growthDeltas = [-0.01, -0.005, 0, 0.005, 0.01];
  const rows: DcfSensitivityRow[] = [];
  for (const dw of waccDeltas) {
    for (const dg of growthDeltas) {
      const w = base.wacc + dw;
      const g = base.terminalGrowthPct + dg;
      if (w <= g || w <= 0) continue;
      try {
        const r = runCase(fcfProjections, netCash, shares, { wacc: w, terminalGrowthPct: g });
        rows.push({ wacc: w, terminalGrowthPct: g, pricePerShare: r.pricePerShare });
      } catch {
        // Diverging cell — skip silently.
      }
    }
  }
  return rows;
}

export function computeDcf(input: DcfInput): DcfResult {
  const shares = input.sharesOutstanding ?? 1;
  if (!(shares > 0)) {
    throw new Error("DCF: sharesOutstanding must be > 0");
  }

  const base = runCase(input.fcfProjections, input.netCash, shares, input.base);
  const bear = input.bear ? runCase(input.fcfProjections, input.netCash, shares, input.bear) : null;
  const bull = input.bull ? runCase(input.fcfProjections, input.netCash, shares, input.bull) : null;
  const sensitivity = buildSensitivity(input.fcfProjections, input.netCash, shares, input.base);

  const parts: string[] = [`base: ${base.pricePerShare.toFixed(2)}`];
  if (bear) parts.push(`bear: ${bear.pricePerShare.toFixed(2)}`);
  if (bull) parts.push(`bull: ${bull.pricePerShare.toFixed(2)}`);
  parts.push(`tv-share: ${(base.terminalFraction * 100).toFixed(0)}%`);

  return {
    base,
    bear,
    bull,
    sensitivity,
    interpretation: parts.join(" | "),
  };
}
