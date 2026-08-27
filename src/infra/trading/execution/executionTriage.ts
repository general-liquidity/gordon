/**
 * Execution write-back triage.
 *
 * After execute_plan places its orders, this categorizes the raw result so the
 * agent is handed not just "here's what changed" but "here's what changed, and
 * here's the part you probably got wrong" — a built-in linter on its own trades,
 * the trading analogue of a spreadsheet agent's cell-diff triage.
 *
 * Read-only: it inspects the execution result, it never changes execution. Order
 * shapes vary across venues/tools, so every field is extracted defensively and
 * an order that can't be confidently classified lands in needs-review — the
 * capital-safe default is to SURFACE uncertainty, never to assume clean.
 */

export type TriageBucket = "clean" | "review" | "fix";

export interface TriagedOrder {
  index: number;
  bucket: TriageBucket;
  /** Why it landed here, e.g. "partial fill 0.6/1.0" or "slippage 82bps". */
  reason: string;
  symbol?: string;
  status?: string;
}

export interface ExecutionTriage {
  clean: TriagedOrder[];
  /** Filled-but-suspect: partial, slipped beyond tolerance, or unconfirmed. */
  needsReview: TriagedOrder[];
  /** Rejected / errored / zero-fill — the agent must act. */
  mustFix: TriagedOrder[];
  /** One-line rollup, e.g. "3 orders: 2 clean, 1 needs-review, 0 must-fix". */
  summary: string;
}

/** Default: a fill worse than the reference by more than this is review-worthy. */
const DEFAULT_SLIPPAGE_REVIEW_BPS = 50;

function asRecord(o: unknown): Record<string, unknown> {
  return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
}

function firstNumber(rec: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function firstString(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return undefined;
}

const FAILURE_RE = /reject|fail|error|block|cancel|denied|insufficient/i;
const SUCCESS_RE = /fill|close|complete|success|done|executed|settled/i;

function classify(order: unknown, index: number, slippageReviewBps: number): TriagedOrder {
  const rec = asRecord(order);
  const status = firstString(rec, ["status", "orderStatus", "state"]);
  const symbol = firstString(rec, ["symbol", "ticker", "pair"]);
  const error = firstString(rec, ["error", "reason", "rejectReason", "message"]);
  const success = typeof rec.success === "boolean" ? (rec.success as boolean) : undefined;
  const base = { index, symbol, status };

  // 1. Hard failure — rejected / errored / explicitly unsuccessful.
  if (
    success === false ||
    (status && FAILURE_RE.test(status)) ||
    (error && success !== true && !status)
  ) {
    return { ...base, bucket: "fix", reason: error ?? `order ${status ?? "failed"}` };
  }

  const filled = firstNumber(rec, [
    "filledQty",
    "filled",
    "executedQty",
    "filledQuantity",
    "filledAmount",
  ]);
  const requested = firstNumber(rec, ["requestedQty", "quantity", "amount", "qty", "size"]);

  // 2. Zero fill on a non-rejected order is suspect enough to fix.
  if (filled !== undefined && filled <= 0 && !(status && SUCCESS_RE.test(status))) {
    return { ...base, bucket: "fix", reason: "no fill" };
  }

  // 3. Partial fill — filled, but short of the request.
  if (
    filled !== undefined &&
    requested !== undefined &&
    requested > 0 &&
    filled < requested * 0.999
  ) {
    return { ...base, bucket: "review", reason: `partial fill ${trim(filled)}/${trim(requested)}` };
  }

  // 4. Slippage beyond tolerance — only when both fill and reference are known.
  const fill = firstNumber(rec, [
    "avgFillPrice",
    "averageEntry",
    "fillPrice",
    "averagePrice",
    "price",
  ]);
  const ref = firstNumber(rec, [
    "expectedPrice",
    "limitPrice",
    "refPrice",
    "requestedPrice",
    "referencePrice",
  ]);
  if (fill !== undefined && ref !== undefined && ref > 0) {
    const slipBps = (Math.abs(fill - ref) / ref) * 10_000;
    if (slipBps > slippageReviewBps) {
      return {
        ...base,
        bucket: "review",
        reason: `slippage ${Math.round(slipBps)}bps (fill ${trim(fill)} vs ${trim(ref)})`,
      };
    }
  }

  // 5. Clearly successful.
  if (success === true || (status && SUCCESS_RE.test(status))) {
    return { ...base, bucket: "clean", reason: status ?? "filled" };
  }

  // 6. Unclassifiable (pending / open / unknown) — surface, don't assume clean.
  return { ...base, bucket: "review", reason: `unconfirmed${status ? ` (${status})` : ""}` };
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export function triageExecution(
  orders: unknown[] | undefined,
  opts: { slippageReviewBps?: number } = {},
): ExecutionTriage {
  const list = Array.isArray(orders) ? orders : [];
  const slipBps = opts.slippageReviewBps ?? DEFAULT_SLIPPAGE_REVIEW_BPS;
  const clean: TriagedOrder[] = [];
  const needsReview: TriagedOrder[] = [];
  const mustFix: TriagedOrder[] = [];

  list.forEach((order, i) => {
    const t = classify(order, i, slipBps);
    if (t.bucket === "fix") mustFix.push(t);
    else if (t.bucket === "review") needsReview.push(t);
    else clean.push(t);
  });

  const summary =
    list.length === 0
      ? "No orders placed."
      : `${list.length} order${list.length === 1 ? "" : "s"}: ${clean.length} clean, ${needsReview.length} needs-review, ${mustFix.length} must-fix` +
        (mustFix.length > 0 ? ` — MUST FIX: ${mustFix.map((o) => o.reason).join("; ")}` : "") +
        (needsReview.length > 0 ? ` — review: ${needsReview.map((o) => o.reason).join("; ")}` : "");

  return { clean, needsReview, mustFix, summary };
}
