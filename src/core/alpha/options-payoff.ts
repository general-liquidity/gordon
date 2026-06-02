/**
 * Options-Strategy Expiry-Payoff Calculator
 *
 * Computes the terminal (at-expiry) profit/loss profile of an arbitrary
 * multi-leg options strategy. Each leg is a European call or put, long or
 * short, with a strike, a per-contract premium, and an optional quantity.
 *
 * Per-leg expiry payoff (intrinsic minus premium paid/received):
 *
 *   long  call:  qty * (max(S - K, 0) - premium)
 *   long  put:   qty * (max(K - S, 0) - premium)
 *   short call:  qty * (premium - max(S - K, 0))
 *   short put:   qty * (premium - max(K - S, 0))
 *
 * The strategy payoff at a terminal price S is the sum across legs. The
 * module evaluates this over a price grid (auto-built around the strikes
 * when none is supplied), then derives net debit/credit, max profit, max
 * loss (null when unbounded), and the breakeven price(s) where payoff
 * crosses zero (linear interpolation between adjacent grid points).
 *
 * Convenience constructors build the canonical volatility strategies:
 * long/short straddle and long/short strangle.
 *
 * NULL-on-invalid: malformed input (no legs, non-positive strike/premium,
 * non-finite numbers) returns a result with valid=false and null analytic
 * fields rather than throwing. Boundary validation only.
 *
 * Pure compute. No I/O. Deterministic.
 */

export type OptionLegType = "call" | "put";
export type OptionLegSide = "long" | "short";

export interface OptionLeg {
  type: OptionLegType;
  side: OptionLegSide;
  strike: number;
  premium: number;
  quantity?: number;
}

export interface OptionsPayoffInput {
  legs: OptionLeg[];
  spot?: number;
  priceGrid?: number[];
}

export interface PayoffPoint {
  price: number;
  payoff: number;
}

export interface OptionsPayoffResult {
  valid: boolean;
  netPremium: number | null;
  netKind: "debit" | "credit" | "even" | null;
  payoffCurve: PayoffPoint[];
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[];
  interpretation: string;
}

const DEFAULT_QTY = 1;

function isValidLeg(leg: OptionLeg): boolean {
  if (leg.type !== "call" && leg.type !== "put") return false;
  if (leg.side !== "long" && leg.side !== "short") return false;
  if (!Number.isFinite(leg.strike) || leg.strike <= 0) return false;
  if (!Number.isFinite(leg.premium) || leg.premium < 0) return false;
  const qty = leg.quantity ?? DEFAULT_QTY;
  if (!Number.isFinite(qty) || qty <= 0) return false;
  return true;
}

function legPayoff(leg: OptionLeg, S: number): number {
  const qty = leg.quantity ?? DEFAULT_QTY;
  const intrinsic =
    leg.type === "call" ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
  const longPnl = intrinsic - leg.premium;
  const perContract = leg.side === "long" ? longPnl : -longPnl;
  return perContract * qty;
}

function strategyPayoff(legs: OptionLeg[], S: number): number {
  let sum = 0;
  for (const leg of legs) sum = sum + legPayoff(leg, S);
  return sum;
}

function netPremiumOf(legs: OptionLeg[]): number {
  let net = 0;
  for (const leg of legs) {
    const qty = leg.quantity ?? DEFAULT_QTY;
    net = net + (leg.side === "long" ? -leg.premium : leg.premium) * qty;
  }
  return net;
}

function autoGrid(legs: OptionLeg[]): number[] {
  const strikes = legs.map((l) => l.strike);
  const minK = Math.min(...strikes);
  const maxK = Math.max(...strikes);
  const hi = maxK * 2;
  // Unit-or-finer step so the grid lands on round prices and every kink is
  // sampled. Sub-$1 strikes get a 100th-of-min-strike step.
  const step = minK >= 2 ? 1 : parseFloat((minK / 100).toFixed(6));
  const pts = new Set<number>();
  for (let p = 0; p <= hi + step / 2; p = parseFloat((p + step).toFixed(6))) {
    pts.add(parseFloat(p.toFixed(6)));
  }
  for (const k of strikes) pts.add(k);
  pts.add(parseFloat(Math.max(minK - 0.5, 0).toFixed(6)));
  pts.add(parseFloat((maxK + 0.5).toFixed(6)));
  return [...pts].sort((a, b) => a - b);
}

function callExposure(legs: OptionLeg[]): number {
  let net = 0;
  for (const leg of legs) {
    if (leg.type !== "call") continue;
    const qty = leg.quantity ?? DEFAULT_QTY;
    net = net + (leg.side === "long" ? 1 : -1) * qty;
  }
  return net;
}

function findBreakevens(curve: PayoffPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (a.payoff === 0) {
      out.push(parseFloat(a.price.toFixed(4)));
      continue;
    }
    if (a.payoff < 0 !== b.payoff < 0 && b.payoff !== 0) {
      const frac = a.payoff / (a.payoff - b.payoff);
      const x = a.price + frac * (b.price - a.price);
      out.push(parseFloat(x.toFixed(4)));
    }
  }
  const last = curve[curve.length - 1];
  if (last && last.payoff === 0) out.push(parseFloat(last.price.toFixed(4)));
  const dedup: number[] = [];
  for (const x of out) {
    if (!dedup.some((y) => Math.abs(y - x) < 1e-4)) dedup.push(x);
  }
  return dedup;
}

export function computeOptionsPayoff(
  input: OptionsPayoffInput,
): OptionsPayoffResult {
  const invalid = (why: string): OptionsPayoffResult => ({
    valid: false,
    netPremium: null,
    netKind: null,
    payoffCurve: [],
    maxProfit: null,
    maxLoss: null,
    breakevens: [],
    interpretation: `Invalid options-payoff input: ${why}`,
  });

  const legs = input.legs;
  if (!Array.isArray(legs) || legs.length === 0) return invalid("no legs supplied");
  for (let i = 0; i < legs.length; i++) {
    if (!isValidLeg(legs[i]!)) {
      return invalid(`leg ${i} malformed (type/side/strike/premium/quantity)`);
    }
  }

  let grid: number[];
  if (input.priceGrid && input.priceGrid.length > 0) {
    const g = input.priceGrid.filter((p) => Number.isFinite(p) && p >= 0);
    if (g.length === 0) return invalid("priceGrid contains no finite non-negative prices");
    grid = [...g].sort((a, b) => a - b);
  } else {
    grid = autoGrid(legs);
  }

  const payoffCurve: PayoffPoint[] = grid.map((price) => ({
    price: parseFloat(price.toFixed(6)),
    payoff: parseFloat(strategyPayoff(legs, price).toFixed(6)),
  }));

  const net = netPremiumOf(legs);
  const netRounded = parseFloat(net.toFixed(6));
  const netKind: "debit" | "credit" | "even" =
    Math.abs(netRounded) < 1e-9 ? "even" : netRounded < 0 ? "debit" : "credit";

  const payoffs = payoffCurve.map((p) => p.payoff);
  const sampledMax = Math.max(...payoffs);
  const sampledMin = Math.min(...payoffs);

  const callNet = callExposure(legs);
  const unboundedAbove = callNet > 0;
  const unboundedBelow = callNet < 0;

  const maxProfit = unboundedAbove ? null : parseFloat(sampledMax.toFixed(6));
  const maxLoss = unboundedBelow ? null : parseFloat(sampledMin.toFixed(6));

  const breakevens = findBreakevens(payoffCurve);

  const sideSummary = legs
    .map((l) => {
      const qty = l.quantity ?? DEFAULT_QTY;
      const qtyStr = qty === 1 ? "" : `${qty}x `;
      return `${l.side} ${qtyStr}${l.type} K=${l.strike}@${l.premium}`;
    })
    .join(", ");
  const netStr =
    netKind === "even"
      ? "net even"
      : `net ${netKind} ${Math.abs(netRounded).toFixed(2)}`;
  const beStr =
    breakevens.length > 0
      ? `breakeven(s) ${breakevens.map((b) => b.toFixed(2)).join(", ")}`
      : "no breakeven in grid";
  const mpStr = maxProfit == null ? "unbounded" : maxProfit.toFixed(2);
  const mlStr = maxLoss == null ? "unbounded" : maxLoss.toFixed(2);

  const interpretation =
    `${legs.length}-leg strategy [${sideSummary}]: ${netStr}; ` +
    `max profit ${mpStr}, max loss ${mlStr}; ${beStr}` +
    (input.spot != null ? ` (spot ${input.spot})` : "");

  return {
    valid: true,
    netPremium: netRounded,
    netKind,
    payoffCurve,
    maxProfit,
    maxLoss,
    breakevens,
    interpretation,
  };
}

export function longStraddle(
  strike: number,
  callPremium: number,
  putPremium: number,
): OptionLeg[] {
  return [
    { type: "call", side: "long", strike, premium: callPremium },
    { type: "put", side: "long", strike, premium: putPremium },
  ];
}

export function shortStraddle(
  strike: number,
  callPremium: number,
  putPremium: number,
): OptionLeg[] {
  return [
    { type: "call", side: "short", strike, premium: callPremium },
    { type: "put", side: "short", strike, premium: putPremium },
  ];
}

export function longStrangle(
  callStrike: number,
  putStrike: number,
  callPremium: number,
  putPremium: number,
): OptionLeg[] {
  return [
    { type: "call", side: "long", strike: callStrike, premium: callPremium },
    { type: "put", side: "long", strike: putStrike, premium: putPremium },
  ];
}

export function shortStrangle(
  callStrike: number,
  putStrike: number,
  callPremium: number,
  putPremium: number,
): OptionLeg[] {
  return [
    { type: "call", side: "short", strike: callStrike, premium: callPremium },
    { type: "put", side: "short", strike: putStrike, premium: putPremium },
  ];
}
