/**
 * Model to Market — official scoring model (the competition's TRUE objective
 * function). Transcribed from the published "AI Trading Competition Rules"
 * (Sections 11–13). Gordon optimizes against THIS, not a proxy.
 *
 *   Final Score = 0.70·ReturnRank + 0.15·DrawdownRank + 0.10·SharpeRank
 *               + 0.05·RiskDiscipline
 *
 * The ranking is CROSS-SECTIONAL and RELATIVE: each metric is converted to a
 * 0–100 rank score against the other active participants, so absolute numbers
 * matter only via where they place you in the field. Return dominates (70%);
 * drawdown and a non-annualized 15-minute Sharpe shape the rest; risk discipline
 * is a small additive that mostly punishes red-line behaviour.
 *
 * Pure: caller supplies each participant's 15-minute equity samples (and,
 * optionally, a risk-metric series for the discipline score). No I/O.
 *
 * Interpretation choices where the rules leave a gap are marked INTERP and kept
 * conservative; see each site.
 */

export const COMPETITION_INITIAL_EQUITY = 1_000_000;

export const COMPETITION_SCORE_WEIGHTS = {
  returnRank: 0.7,
  drawdownRank: 0.15,
  sharpeRank: 0.1,
  riskDiscipline: 0.05,
} as const;

/** Section 12.5 — Sharpe Rank is capped at 50 below this many 15-min observations. */
export const MIN_SHARPE_OBSERVATIONS = 8;

// ----------------------------------------------------------------------------
// Raw per-participant metrics
// ----------------------------------------------------------------------------

/** Section 12.1 — net return off the fixed 1,000,000 baseline. */
export function computeReturn(finalEquity: number, initialEquity = COMPETITION_INITIAL_EQUITY): number {
  return (finalEquity - initialEquity) / initialEquity;
}

/** Section 12.3 — max peak-to-trough equity decline (fraction, ≥ 0). */
export function computeMaxDrawdown(equityCurve: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    if (peak > 0) {
      const dd = (peak - eq) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

export interface NonAnnualizedSharpe {
  sharpe: number;
  /** Count of valid 15-min interval returns used (drives the < 8 → cap-50 rule). */
  nObs: number;
}

/**
 * Section 12.5 — NON-annualized Sharpe = Mean(r) / Std(r) over 15-minute equity
 * returns. Std == 0 → Sharpe 0. INTERP: population standard deviation (divide by
 * n), matching a literal "standard deviation of the returns"; the field-relative
 * ranking is unaffected by the n vs n-1 choice since it is monotonic.
 */
export function computeNonAnnualizedSharpe(equity15m: number[]): NonAnnualizedSharpe {
  const r: number[] = [];
  for (let i = 1; i < equity15m.length; i++) {
    const prev = equity15m[i - 1]!;
    if (prev > 0) r.push((equity15m[i]! - prev) / prev);
  }
  if (r.length < 2) return { sharpe: 0, nObs: r.length };
  const mean = r.reduce((s, v) => s + v, 0) / r.length;
  const variance = r.reduce((s, v) => s + (v - mean) ** 2, 0) / r.length;
  const std = Math.sqrt(variance);
  return { sharpe: std === 0 ? 0 : mean / std, nObs: r.length };
}

// ----------------------------------------------------------------------------
// Risk Discipline (Section 13)
// ----------------------------------------------------------------------------

export interface RiskSample {
  /** Used Margin / Equity. */
  marginUsage: number;
  /** Gross Notional Exposure / Equity. */
  leverage: number;
  /** Largest single-instrument notional / gross notional. */
  singleInstrumentExposure: number;
  /** Net directional notional / gross notional. */
  netDirectionalExposure: number;
}

export interface RiskDeduction {
  rule: string;
  points: number;
}

export interface RiskDisciplineResult {
  /** Starts at 100, floored at 0. */
  score: number;
  deductions: RiskDeduction[];
  /** A "triggers compliance review" threshold was breached (not an automatic deduction). */
  complianceReview: boolean;
}

/** Longest run (in samples) for which `pred` holds on consecutive samples. */
function longestRun(samples: RiskSample[], pred: (s: RiskSample) => boolean): number {
  let best = 0;
  let cur = 0;
  for (const s of samples) {
    cur = pred(s) ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return best;
}

/**
 * Section 13 — per-round Risk Discipline from a sampled risk-metric series.
 * Each round resets to 100. INTERP: a run of m consecutive in-violation samples
 * spans m·intervalMinutes of violation (conservative — flags the breach as soon
 * as a full window is covered). Within margin/leverage, only the single most
 * severe triggered tier is applied (the tiers are nested); concentration
 * penalties are independent and additive. The ">98% / ~30x for ≥10min" tiers
 * raise `complianceReview` rather than a fixed deduction, per the rules.
 */
export function computeRiskDiscipline(samples: RiskSample[], intervalMinutes: number): RiskDisciplineResult {
  const deductions: RiskDeduction[] = [];
  let complianceReview = false;
  const minutes = (runSamples: number) => runSamples * intervalMinutes;

  // --- Margin usage (Section 13.1) ---
  if (minutes(longestRun(samples, (s) => s.marginUsage > 0.98)) >= 10) {
    complianceReview = true;
  }
  if (minutes(longestRun(samples, (s) => s.marginUsage > 0.95)) >= 15) {
    deductions.push({ rule: "margin>95%≥15m", points: 30 });
  } else if (minutes(longestRun(samples, (s) => s.marginUsage > 0.9)) >= 30) {
    deductions.push({ rule: "margin>90%≥30m", points: 20 });
  }

  // --- Leverage usage (Section 13.2) ---
  if (minutes(longestRun(samples, (s) => s.leverage >= 30)) >= 10) {
    complianceReview = true;
  }
  if (minutes(longestRun(samples, (s) => s.leverage > 29)) >= 15) {
    deductions.push({ rule: "leverage>29x≥15m", points: 30 });
  } else if (minutes(longestRun(samples, (s) => s.leverage > 28)) >= 30) {
    deductions.push({ rule: "leverage>28x≥30m", points: 20 });
  }

  // --- Exposure concentration (Section 13.3) — independent, additive ---
  if (minutes(longestRun(samples, (s) => s.singleInstrumentExposure > 0.9)) >= 30) {
    deductions.push({ rule: "singleInstrument>90%≥30m", points: 10 });
  }
  if (minutes(longestRun(samples, (s) => s.netDirectionalExposure > 0.95)) >= 30) {
    deductions.push({ rule: "netDirectional>95%≥30m", points: 10 });
  }

  const total = deductions.reduce((s, d) => s + d.points, 0);
  return { score: Math.max(0, 100 - total), deductions, complianceReview };
}

// ----------------------------------------------------------------------------
// Cross-sectional ranking + final score
// ----------------------------------------------------------------------------

export interface ParticipantRound {
  id: string;
  /** 15-minute equity samples over the round, first sample = round-open equity. */
  equity15m: number[];
  /** 0–100 risk-discipline score; default 100 if omitted. */
  riskDiscipline?: number;
  /** Red-line / forced-liquidation flag → excluded from the active field, score 0. */
  disqualified?: boolean;
}

export interface ScoredParticipant {
  id: string;
  return: number;
  returnRank: number;
  maxDrawdown: number;
  drawdownRank: number;
  sharpe: number;
  sharpeObs: number;
  sharpeRank: number;
  riskDiscipline: number;
  finalScore: number;
  disqualified: boolean;
}

/**
 * Section 12.2/4/6 rank normalization: best value → 100, worst → 0; a single
 * active participant defaults to 100. Ties share a rank (1 + #strictly-better),
 * so equal metrics yield equal rank scores.
 */
function rankScores<T>(items: T[], value: (t: T) => number, better: "higher" | "lower"): Map<T, number> {
  const n = items.length;
  const out = new Map<T, number>();
  for (const it of items) {
    const v = value(it);
    let strictlyBetter = 0;
    for (const other of items) {
      if (other === it) continue;
      const ov = value(other);
      if (better === "higher" ? ov > v : ov < v) strictlyBetter++;
    }
    const rank = 1 + strictlyBetter; // 1 = best
    out.set(it, n === 1 ? 100 : (100 * (n - rank)) / (n - 1));
  }
  return out;
}

/**
 * Score and rank a round. Disqualified participants are removed from the active
 * field (their red-line wipeout doesn't dilute everyone else's rank) and emitted
 * with finalScore 0. Returns all participants sorted by finalScore descending,
 * with the official tie-breakers (Section 16) applied.
 */
export function scoreCompetitionRound(
  participants: ParticipantRound[],
  opts: { initialEquity?: number; weights?: typeof COMPETITION_SCORE_WEIGHTS } = {},
): ScoredParticipant[] {
  const initial = opts.initialEquity ?? COMPETITION_INITIAL_EQUITY;
  const w = opts.weights ?? COMPETITION_SCORE_WEIGHTS;

  const active = participants.filter((p) => !p.disqualified);

  const metrics = new Map<ParticipantRound, { ret: number; dd: number; sharpe: NonAnnualizedSharpe }>();
  for (const p of active) {
    const finalEquity = p.equity15m.length ? p.equity15m[p.equity15m.length - 1]! : initial;
    metrics.set(p, {
      ret: computeReturn(finalEquity, initial),
      dd: computeMaxDrawdown(p.equity15m),
      sharpe: computeNonAnnualizedSharpe(p.equity15m),
    });
  }

  const retRanks = rankScores(active, (p) => metrics.get(p)!.ret, "higher");
  const ddRanks = rankScores(active, (p) => metrics.get(p)!.dd, "lower");
  const sharpeRanks = rankScores(active, (p) => metrics.get(p)!.sharpe.sharpe, "higher");

  const scored: ScoredParticipant[] = active.map((p) => {
    const m = metrics.get(p)!;
    const rd = p.riskDiscipline ?? 100;
    // Section 12.5 — sparse-data cap on Sharpe Rank.
    let sharpeRank = sharpeRanks.get(p)!;
    if (m.sharpe.nObs < MIN_SHARPE_OBSERVATIONS) sharpeRank = Math.min(sharpeRank, 50);
    const returnRank = retRanks.get(p)!;
    const drawdownRank = ddRanks.get(p)!;
    const finalScore =
      w.returnRank * returnRank +
      w.drawdownRank * drawdownRank +
      w.sharpeRank * sharpeRank +
      w.riskDiscipline * rd;
    return {
      id: p.id,
      return: m.ret,
      returnRank,
      maxDrawdown: m.dd,
      drawdownRank,
      sharpe: m.sharpe.sharpe,
      sharpeObs: m.sharpe.nObs,
      sharpeRank,
      riskDiscipline: rd,
      finalScore,
      disqualified: false,
    };
  });

  const disqualified: ScoredParticipant[] = participants
    .filter((p) => p.disqualified)
    .map((p) => ({
      id: p.id,
      return: 0,
      returnRank: 0,
      maxDrawdown: 0,
      drawdownRank: 0,
      sharpe: 0,
      sharpeObs: 0,
      sharpeRank: 0,
      riskDiscipline: 0,
      finalScore: 0,
      disqualified: true,
    }));

  // Section 16 tie-breakers: finalScore, then return, then lower MaxDD, then
  // Sharpe, then risk discipline.
  scored.sort(
    (a, b) =>
      b.finalScore - a.finalScore ||
      b.return - a.return ||
      a.maxDrawdown - b.maxDrawdown ||
      b.sharpe - a.sharpe ||
      b.riskDiscipline - a.riskDiscipline,
  );

  return [...scored, ...disqualified];
}

// ----------------------------------------------------------------------------
// Best Sharpe Ratio Award (Section 17) — a separate $10k prize, gated behind a
// Top-50 OVERALL finish. Note: chasing 1st place is a PREREQUISITE for this
// award, not a trade-off against it.
// ----------------------------------------------------------------------------

/** Section 17 eligibility floor on executed trades. */
export const BEST_SHARPE_MIN_TRADES = 30;
/** Section 17 eligibility — must finish within the Top-N of the final overall ranking. */
export const BEST_SHARPE_TOP_N = 50;

export interface BestSharpeCandidate {
  id: string;
  /** Reached the Finals (Top 100). */
  reachedFinals: boolean;
  /** 1-based position in the FINAL overall ranking. */
  finalOverallRank: number;
  /** Any confirmed red-line violation (forced liq / exploit / abuse / multi-account). */
  redLineViolation: boolean;
  /** Trades executed over the competition. */
  tradeCount: number;
  /** Non-annualized 15-min Sharpe over the ENTIRE competition (via computeNonAnnualizedSharpe). */
  sharpe: number;
  /** Tie-break 1 — higher Final Return ranks higher. */
  finalReturn: number;
  /** Tie-break 2 — lower MaxDD ranks higher. */
  maxDrawdown: number;
}

export interface BestSharpeResult {
  /** Candidates meeting all four Section-17 criteria, ordered best-first. */
  eligible: BestSharpeCandidate[];
  /** The award winner (highest Sharpe; ties → higher return → lower MaxDD), or null if none eligible. */
  winner: BestSharpeCandidate | null;
}

/** Section 17 — does a candidate meet ALL eligibility criteria? */
export function isBestSharpeEligible(c: BestSharpeCandidate): boolean {
  return (
    c.reachedFinals &&
    c.finalOverallRank <= BEST_SHARPE_TOP_N &&
    !c.redLineViolation &&
    c.tradeCount >= BEST_SHARPE_MIN_TRADES
  );
}

/**
 * Section 17 — select the Best Sharpe Ratio Award winner. Filters to eligible
 * participants (Finals + Top-50 overall + no red-line + ≥30 trades), then ranks
 * by Sharpe with the published tie-breakers (higher Final Return, then lower
 * MaxDD). Pure.
 */
export function selectBestSharpeAward(candidates: BestSharpeCandidate[]): BestSharpeResult {
  const eligible = candidates
    .filter(isBestSharpeEligible)
    .sort(
      (a, b) =>
        b.sharpe - a.sharpe ||
        b.finalReturn - a.finalReturn ||
        a.maxDrawdown - b.maxDrawdown,
    );
  return { eligible, winner: eligible[0] ?? null };
}
