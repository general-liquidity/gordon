/**
 * Fat-finger / stale-quote ORDER PRICE-DEVIATION guard.
 *
 * Pure, deterministic pre-placement sanity check: how far does an order's
 * intended price sit from a live reference (mid / last / mark)? A limit price
 * wildly off the reference is the classic fat-finger (extra zero, decimal
 * slip) or stale-quote symptom — this catches it before the order leaves.
 *
 * deviationPct = (orderPrice − referencePrice) / referencePrice * 100
 *
 * Side-awareness: a BUY limit far ABOVE the reference, or a SELL limit far
 * BELOW it, is the *dangerous* direction (you cross hard against yourself /
 * pay up into a stale book). The benign direction (buy below / sell above)
 * only ever improves your fill, so we escalate the dangerous direction to a
 * hard `block` while the benign direction stays a `warn`.
 *
 * Returns NULL on non-finite / non-positive inputs — never throws, never
 * fabricates a verdict from garbage prices.
 */

export interface PriceDeviationInput {
  orderPrice: number;
  referencePrice: number;
  /** Absolute deviation (%) above which the order is flagged. Default 2. */
  thresholdPct?: number;
  /** Optional side — enables dangerous-direction escalation. */
  side?: "buy" | "sell";
}

export interface PriceDeviationResult {
  deviationPct: number;
  breached: boolean;
  verdict: "ok" | "warn" | "block";
  interpretation: string;
}

const DEFAULT_THRESHOLD_PCT = 2;

function isPositiveFinite(x: number): boolean {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

export function checkPriceDeviation(input: PriceDeviationInput): PriceDeviationResult | null {
  if (input == null) return null;
  const { orderPrice, referencePrice, side } = input;

  // referencePrice must be strictly positive (it's the denominator); orderPrice
  // must be a finite positive number too — a zero/negative order price is itself
  // a fat-finger, but it's not a *deviation* we can express as a ratio.
  if (!isPositiveFinite(orderPrice) || !isPositiveFinite(referencePrice)) {
    return null;
  }

  const thresholdPctRaw = input.thresholdPct;
  const thresholdPct =
    typeof thresholdPctRaw === "number" && Number.isFinite(thresholdPctRaw) && thresholdPctRaw >= 0
      ? thresholdPctRaw
      : DEFAULT_THRESHOLD_PCT;

  const deviationPctRaw = ((orderPrice - referencePrice) / referencePrice) * 100;
  const deviationPct = parseFloat(deviationPctRaw.toFixed(4));
  const absDev = Math.abs(deviationPct);
  const breached = absDev > thresholdPct;

  // Dangerous direction: buy ABOVE reference (deviation > 0) or sell BELOW
  // reference (deviation < 0). When a side is supplied and the breach is in
  // the dangerous direction, escalate to block; otherwise warn on breach.
  let dangerousDirection = false;
  if (side === "buy" && deviationPct > 0) dangerousDirection = true;
  if (side === "sell" && deviationPct < 0) dangerousDirection = true;

  let verdict: PriceDeviationResult["verdict"];
  if (!breached) {
    verdict = "ok";
  } else if (side == null) {
    // No side context — can't tell benign from dangerous; flag as warn.
    verdict = "warn";
  } else {
    verdict = dangerousDirection ? "block" : "warn";
  }

  const dir = deviationPct > 0 ? "above" : deviationPct < 0 ? "below" : "at";
  const sideLabel = side == null ? "Order" : side === "buy" ? "Buy" : "Sell";
  let interpretation: string;
  if (verdict === "ok") {
    interpretation = `${sideLabel} price ${orderPrice} is ${absDev}% ${dir} reference ${referencePrice} — within ${thresholdPct}% tolerance.`;
  } else if (verdict === "block") {
    interpretation = `BLOCK: ${sideLabel.toLowerCase()} limit ${orderPrice} is ${absDev}% ${dir} reference ${referencePrice} (> ${thresholdPct}% tolerance) in the dangerous direction — likely fat-finger or stale quote.`;
  } else {
    interpretation = `WARN: ${sideLabel.toLowerCase()} price ${orderPrice} deviates ${absDev}% ${dir} reference ${referencePrice} (> ${thresholdPct}% tolerance) — verify before placing.`;
  }

  return { deviationPct, breached, verdict, interpretation };
}
