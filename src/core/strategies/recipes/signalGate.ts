/**
 * Signal-vs-execution gate recipe.
 *
 * Concept (clean-room re-implementation): an indicator can be right
 * about *direction* and wrong about *timing*. A trend-following moving-
 * average crossover is the canonical timing reference: if RSI says go
 * long but fastMA is still below slowMA, the trend hasn't turned yet —
 * holding the entry until fastMA confirms tends to give a better fill
 * than firing immediately.
 *
 * The gate decouples signal generation from execution:
 *   - In: a raw "long" / "short" / "none" signal + fastMA + slowMA + price
 *   - Out: an execution decision + status (executed / pending / passthrough)
 *
 * State carries the pending signal across calls. When the gate fills,
 * we record the price benefit (or cost) of waiting so callers can
 * audit whether the gate is actually paying off in their dataset.
 *
 * Caller owns state — pure function, state in / state out.
 */

export type GateSide = "long" | "short" | "none";

export interface SignalGateState {
  pendingSignal: GateSide;
  pendingPrice: number;
  /** Price benefit (positive = better fill from waiting) on each gate
   *  fill; caller can summarize. Stored as a small ring buffer to keep
   *  state size bounded. */
  benefits: number[];
}

export interface SignalGateInput {
  state: SignalGateState;
  rawSignal: GateSide;
  fastMa: number;
  slowMa: number;
  price: number;
  /** Cap on how many benefit records to retain. Default 100. */
  benefitsCap?: number;
}

export interface SignalGateResult {
  /** What the caller should actually trade now. */
  execute: GateSide;
  /** Why this output was produced. */
  status:
    | "executed-immediately"
    | "executed-after-confirmation"
    | "pending"
    | "passthrough"
    | "cancelled";
  state: SignalGateState;
  /** Set when status is "executed-after-confirmation". Positive means
   *  waiting paid off relative to the original signal price. */
  benefit?: number;
}

export function newSignalGateState(): SignalGateState {
  return { pendingSignal: "none", pendingPrice: 0, benefits: [] };
}

function maAlignsWith(side: GateSide, fastMa: number, slowMa: number): boolean {
  if (side === "long") return fastMa >= slowMa;
  if (side === "short") return fastMa <= slowMa;
  return false;
}

export function applySignalGate(input: SignalGateInput): SignalGateResult {
  const { rawSignal, fastMa, slowMa, price } = input;
  const benefitsCap = input.benefitsCap ?? 100;
  const prev = input.state;
  const next: SignalGateState = {
    pendingSignal: prev.pendingSignal,
    pendingPrice: prev.pendingPrice,
    benefits: prev.benefits,
  };

  // 1. If we have a pending signal, see if the MA now aligns.
  if (prev.pendingSignal !== "none") {
    if (maAlignsWith(prev.pendingSignal, fastMa, slowMa)) {
      // Confirmation arrived — fire the gated signal.
      const benefit =
        prev.pendingSignal === "long"
          ? // Long benefit: lower fill price = positive.
            (prev.pendingPrice - price) / prev.pendingPrice
          : // Short benefit: higher fill price = positive.
            (price - prev.pendingPrice) / prev.pendingPrice;
      const benefits = [...prev.benefits, benefit].slice(-benefitsCap);
      const exec = prev.pendingSignal;
      return {
        execute: exec,
        status: "executed-after-confirmation",
        state: { pendingSignal: "none", pendingPrice: 0, benefits },
        benefit,
      };
    }

    // Still waiting. If a fresh raw signal points the *opposite* way,
    // cancel the pending entry — the thesis flipped before we could
    // execute, no point waiting on stale conviction.
    if (rawSignal !== "none" && rawSignal !== prev.pendingSignal) {
      return {
        execute: "none",
        status: "cancelled",
        state: { pendingSignal: "none", pendingPrice: 0, benefits: prev.benefits },
      };
    }

    return {
      execute: "none",
      status: "pending",
      state: next,
    };
  }

  // 2. No pending signal. Process the raw signal.
  if (rawSignal === "none") {
    return { execute: "none", status: "passthrough", state: next };
  }

  if (maAlignsWith(rawSignal, fastMa, slowMa)) {
    // MA already confirms — fire immediately.
    return { execute: rawSignal, status: "executed-immediately", state: next };
  }

  // MA disagrees — park the signal.
  return {
    execute: "none",
    status: "pending",
    state: { pendingSignal: rawSignal, pendingPrice: price, benefits: prev.benefits },
  };
}
