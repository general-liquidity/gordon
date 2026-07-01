/**
 * Regret Ledger — rejected-candidate falsification loop (T+5 / T+20)
 *
 * A gate that rejects a trade candidate makes a hidden bet: that the rejection
 * saved a loss rather than cost a gain. That bet is normally never scored — the
 * counterfactual just evaporates. This ledger makes it falsifiable:
 *
 *   1. Log every rejected candidate with the reason, the rejecting gate, and the
 *      hypothetical bracket (entry / stop / target) it WOULD have traded.
 *   2. Review at horizons (T+5, T+20) against injected price paths, scoring
 *      whether the gate SAVED a loss or COST a gain (a signed regret in R units).
 *   3. Aggregate per-gate so a gate that repeatedly costs gains surfaces as an
 *      amendment candidate (loosen), while one that keeps saving losses is
 *      confirmed (keep).
 *
 * This is aligned with Edge-Driven Development: the gate rule is a hypothesis and
 * the ledger is its out-of-sample falsification test.
 *
 * PURE. No I/O, no clock. `asOf` and every price observation are injected so the
 * same inputs always produce the same review — it is a deterministic reduction,
 * safe to run offline over a captured ledger.
 */

import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

export const RegretSideSchema = z.enum(["long", "short"]);
export type RegretSide = z.infer<typeof RegretSideSchema>;

/** The trade the gate declined to take. */
export const HypotheticalBracketSchema = z.object({
  entry: z.number().finite(),
  stop: z.number().finite(),
  target: z.number().finite(),
});
export type HypotheticalBracket = z.infer<typeof HypotheticalBracketSchema>;

export const RejectedCandidateSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  side: RegretSideSchema,
  /** ISO date/time the candidate was rejected. Horizon clocks start here. */
  rejectedAt: z.string().datetime(),
  /** Free-text reason the gate gave. */
  reason: z.string().min(1),
  /** Stable id of the rejecting gate/rule — the aggregation key. */
  gate: z.string().min(1),
  bracket: HypotheticalBracketSchema,
});
export type RejectedCandidate = z.infer<typeof RejectedCandidateSchema>;

/**
 * Injected price path for one candidate at one horizon. `high`/`low` span the
 * window [rejectedAt, rejectedAt + horizonDays] so the bracket's stop or target
 * can be resolved; `close` is the mark at the horizon.
 */
export const HorizonObservationSchema = z.object({
  candidateId: z.string().min(1),
  horizonDays: z.number().positive(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
});
export type HorizonObservation = z.infer<typeof HorizonObservationSchema>;

export const RegretOutcomeSchema = z.enum([
  "would_have_won",
  "would_have_lost",
  "ambiguous",
  "open",
]);
export type RegretOutcome = z.infer<typeof RegretOutcomeSchema>;

export interface RegretEntry {
  candidateId: string;
  gate: string;
  reason: string;
  symbol: string;
  side: RegretSide;
  horizonDays: number;
  outcome: RegretOutcome;
  /**
   * Signed regret in R (risk) multiples.
   *   > 0  the gate COST a gain (the declined trade would have profited)
   *   < 0  the gate SAVED a loss (the declined trade would have lost)
   *   = 0  neutral
   */
  regretR: number;
  savedLoss: boolean;
  costGain: boolean;
  detail: string;
}

export type AmendmentSignal = "loosen" | "keep" | "insufficient_data";

export interface GateRegretSummary {
  gate: string;
  reviewed: number;
  savedCount: number;
  costCount: number;
  ambiguousCount: number;
  openCount: number;
  /** Sum of regretR across reviewed entries. */
  netRegretR: number;
  /** Mean regretR across reviewed entries. */
  meanRegretR: number;
  amendmentSignal: AmendmentSignal;
}

export interface RegretReview {
  asOf: string;
  entries: RegretEntry[];
  byGate: GateRegretSummary[];
}

export const DEFAULT_HORIZON_DAYS = [5, 20] as const;

export interface SummarizeOptions {
  /** Below this reviewed count a gate is not judged. Default 5. */
  minSample?: number;
  /** netRegretR above which a cost-dominant gate is flagged to loosen. Default 1. */
  loosenThreshold?: number;
}

// ============================================================================
// Construction / boundary validation
// ============================================================================

/**
 * Validate + normalize a rejected-candidate log entry. Throws on an incoherent
 * bracket (this is a system boundary — the injected data is trusted only after
 * this check). Coherence:
 *   long  → stop < entry < target
 *   short → target < entry < stop
 */
export function buildRejectedCandidate(input: RejectedCandidate): RejectedCandidate {
  const c = RejectedCandidateSchema.parse(input);
  const { entry, stop, target } = c.bracket;
  if (c.side === "long") {
    if (!(stop < entry && entry < target)) {
      throw new Error(
        `Incoherent long bracket for ${c.id}: expected stop < entry < target, got stop=${stop} entry=${entry} target=${target}`,
      );
    }
  } else {
    if (!(target < entry && entry < stop)) {
      throw new Error(
        `Incoherent short bracket for ${c.id}: expected target < entry < stop, got target=${target} entry=${entry} stop=${stop}`,
      );
    }
  }
  return c;
}

// ============================================================================
// Horizon clock
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole + fractional days elapsed from `fromISO` to `toISO` (may be negative). */
export function elapsedDays(fromISO: string, toISO: string): number {
  return (Date.parse(toISO) - Date.parse(fromISO)) / MS_PER_DAY;
}

// ============================================================================
// Scoring
// ============================================================================

/**
 * Score one candidate against one horizon observation. Pure.
 *
 * R (risk per unit) is the entry→stop distance. regretR is expressed in R
 * multiples so a +2R target and a -1R stop are directly comparable across
 * symbols with different price scales.
 */
export function scoreCandidateAtHorizon(
  candidate: RejectedCandidate,
  obs: HorizonObservation,
): RegretEntry {
  const { entry, stop, target } = candidate.bracket;
  const isLong = candidate.side === "long";
  const risk = isLong ? entry - stop : stop - entry;

  const targetHit = isLong ? obs.high >= target : obs.low <= target;
  const stopHit = isLong ? obs.low <= stop : obs.high >= stop;
  const reward = isLong ? target - entry : entry - target;
  // Mark-to-market PnL of the declined trade at the horizon close, in price units.
  const mtm = isLong ? obs.close - entry : entry - obs.close;

  let outcome: RegretOutcome;
  let pnlR: number;
  let detail: string;

  if (targetHit && !stopHit) {
    outcome = "would_have_won";
    pnlR = reward / risk;
    detail = `target ${target} reached (no stop) within ${obs.horizonDays}d — gate cost ${round(pnlR)}R`;
  } else if (stopHit && !targetHit) {
    outcome = "would_have_lost";
    pnlR = -1;
    detail = `stop ${stop} hit (no target) within ${obs.horizonDays}d — gate saved 1R`;
  } else if (targetHit && stopHit) {
    // Both levels touched; path order is unknown from high/low alone. Resolve
    // by the horizon close (conservative, mark-to-market) and flag ambiguous.
    outcome = "ambiguous";
    pnlR = mtm / risk;
    detail = `both stop ${stop} and target ${target} touched within ${obs.horizonDays}d — resolved by close ${obs.close} = ${round(pnlR)}R`;
  } else {
    outcome = "open";
    pnlR = mtm / risk;
    detail = `neither level hit within ${obs.horizonDays}d — mark-to-market close ${obs.close} = ${round(pnlR)}R`;
  }

  const regretR = pnlR;
  return {
    candidateId: candidate.id,
    gate: candidate.gate,
    reason: candidate.reason,
    symbol: candidate.symbol,
    side: candidate.side,
    horizonDays: obs.horizonDays,
    outcome,
    regretR,
    savedLoss: regretR < 0,
    costGain: regretR > 0,
    detail,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================================
// Review + aggregation
// ============================================================================

export interface ReviewParams {
  asOf: string;
  candidates: RejectedCandidate[];
  /** Injected price paths, matched to a candidate by id + horizonDays. */
  observations: HorizonObservation[];
  /** Horizons to score. Default T+5 / T+20. */
  horizons?: readonly number[];
  summarize?: SummarizeOptions;
}

/**
 * Review the ledger as of `asOf`. A candidate is scored at a horizon only when
 * (a) that many days have actually elapsed since rejection AND (b) an injected
 * observation exists for that (candidate, horizon). Everything else is deferred
 * to a later review — no fabricated prices.
 */
export function reviewRegret(params: ReviewParams): RegretReview {
  const horizons = params.horizons ?? DEFAULT_HORIZON_DAYS;
  const obsIndex = new Map<string, HorizonObservation>();
  for (const o of params.observations) {
    obsIndex.set(observationKey(o.candidateId, o.horizonDays), o);
  }

  const entries: RegretEntry[] = [];
  for (const candidate of params.candidates) {
    const elapsed = elapsedDays(candidate.rejectedAt, params.asOf);
    for (const horizon of horizons) {
      if (elapsed < horizon) continue;
      const obs = obsIndex.get(observationKey(candidate.id, horizon));
      if (!obs) continue;
      entries.push(scoreCandidateAtHorizon(candidate, obs));
    }
  }

  return {
    asOf: params.asOf,
    entries,
    byGate: summarizeByGate(entries, params.summarize),
  };
}

function observationKey(candidateId: string, horizonDays: number): string {
  return `${candidateId}::${horizonDays}`;
}

/**
 * Roll regret entries up per gate into an amendment signal.
 *
 * Signals (heuristic operator thresholds, NOT dataset-fitted — they act on the
 * ledger's own output, so re-tune freely per book):
 *   insufficient_data — fewer than `minSample` reviewed entries
 *   loosen            — net positive regret past `loosenThreshold` AND more
 *                       cost-a-gain than saved-a-loss entries
 *   keep              — otherwise (the gate is pulling its weight)
 */
export function summarizeByGate(
  entries: RegretEntry[],
  opts: SummarizeOptions = {},
): GateRegretSummary[] {
  const minSample = opts.minSample ?? 5;
  const loosenThreshold = opts.loosenThreshold ?? 1;

  const groups = new Map<string, RegretEntry[]>();
  for (const e of entries) {
    const g = groups.get(e.gate);
    if (g) g.push(e);
    else groups.set(e.gate, [e]);
  }

  const summaries: GateRegretSummary[] = [];
  for (const [gate, gateEntries] of groups) {
    const reviewed = gateEntries.length;
    let savedCount = 0;
    let costCount = 0;
    let ambiguousCount = 0;
    let openCount = 0;
    let netRegretR = 0;
    for (const e of gateEntries) {
      netRegretR += e.regretR;
      if (e.outcome === "ambiguous") ambiguousCount += 1;
      if (e.outcome === "open") openCount += 1;
      if (e.savedLoss) savedCount += 1;
      else if (e.costGain) costCount += 1;
    }
    const meanRegretR = reviewed > 0 ? netRegretR / reviewed : 0;

    let amendmentSignal: AmendmentSignal;
    if (reviewed < minSample) {
      amendmentSignal = "insufficient_data";
    } else if (netRegretR > loosenThreshold && costCount > savedCount) {
      amendmentSignal = "loosen";
    } else {
      amendmentSignal = "keep";
    }

    summaries.push({
      gate,
      reviewed,
      savedCount,
      costCount,
      ambiguousCount,
      openCount,
      netRegretR: round(netRegretR),
      meanRegretR: round(meanRegretR),
      amendmentSignal,
    });
  }

  summaries.sort((a, b) => b.netRegretR - a.netRegretR);
  return summaries;
}
