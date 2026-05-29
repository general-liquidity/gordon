/**
 * Survivorship-bias risk classifier.
 *
 * From "Survivorship-Free Momentum and Trend-Following Strategies". A backtest
 * that selects instruments from TODAY's universe across a historical window is
 * tilted toward winners — the names that went bankrupt, merged, or delisted are
 * silently excluded, and they're not random (many disappeared because they
 * performed badly). The article's measured damage: a Nasdaq-100 momentum
 * backtest fell from 46% CAGR / 41% maxDD to 16.4% / 83% once delisted names
 * were included.
 *
 * Gordon has no point-in-time delisting feed, so it CANNOT reconstruct the
 * historical universe to correct the bias. What it can do is classify the RISK
 * from how the universe was constructed + the window + the asset class, and
 * suggest a return haircut. This is a flag, not a fix.
 *
 * Key facts the classifier encodes (from the article):
 *   - Single-instrument and broad-liquid (SPY/QQQ) strategies are effectively
 *     immune — no cross-sectional selection from a survivor-tilted pool.
 *   - Point-in-time universes (delisted names included) are survivorship-free.
 *   - Current-snapshot cross-sectional selection is the biased case; risk grows
 *     with window length (more time for names to die), universe breadth (more
 *     failed candidates excluded), and delisting intensity of the asset class
 *     (crypto delists far more aggressively than large-cap equity).
 *
 * Pure function. No I/O.
 */

export type UniverseConstruction =
  | "single_symbol" // one instrument — immune
  | "liquid_broad" // SPY/QQQ/BTC-major index proxy — effectively immune
  | "current_snapshot" // selected from today's universe across a historical window — BIASED
  | "point_in_time"; // reconstructed historical membership incl. delisted — unbiased

export type AssetClass = "crypto" | "equity" | "other";
export type SurvivorshipRiskTier = "none" | "low" | "medium" | "high";

export interface SurvivorshipRiskInput {
  /** Does the strategy SELECT among multiple instruments (cross-sectional),
   *  or trade a fixed instrument? Single-instrument strategies are immune. */
  crossSectional: boolean;
  /** How the backtest universe was assembled. */
  universeConstruction: UniverseConstruction;
  /** Number of distinct instruments selected among. Default 1. */
  universeSize?: number;
  /** Backtest window length in days — longer = more delisting opportunity. */
  windowDays?: number;
  /** Asset class — crypto delists far more aggressively than large-cap equity. */
  assetClass?: AssetClass;
}

export interface SurvivorshipRiskResult {
  tier: SurvivorshipRiskTier;
  /** Multiply reported CAGR/return by this to get a survivorship-adjusted
   *  estimate. 1.0 = no haircut. Spans the article's observed 0.36–0.73. */
  returnHaircut: number;
  reasons: string[];
  /** The article's confirm-before-trusting questions. */
  checklist: string[];
  interpretation: string;
}

const YEAR = 365;

const HAIRCUT_BY_TIER: Record<SurvivorshipRiskTier, number> = {
  none: 1.0,
  low: 0.85,
  medium: 0.65,
  high: 0.45,
};

const CHECKLIST: string[] = [
  "Would these instruments actually have been in the dataset at the time, or only the survivors?",
  "Would I have known in advance which names would survive?",
  "Does the test include names that went bankrupt, merged, delisted, or were removed from the index/exchange?",
];

export function classifySurvivorshipRisk(input: SurvivorshipRiskInput): SurvivorshipRiskResult {
  const universeSize = input.universeSize ?? 1;
  const windowDays = input.windowDays ?? 0;
  const assetClass = input.assetClass ?? "other";
  if (!Number.isFinite(universeSize) || universeSize < 1) {
    throw new Error("survivorshipRisk: universeSize must be >= 1");
  }
  if (!Number.isFinite(windowDays) || windowDays < 0) {
    throw new Error("survivorshipRisk: windowDays must be >= 0");
  }

  const reasons: string[] = [];

  // Immune cases — no survivor-tilted cross-sectional selection.
  if (!input.crossSectional || input.universeConstruction === "single_symbol") {
    reasons.push(
      "Single-instrument / non-selective strategy — no cross-sectional selection from a survivor-tilted pool (single-symbol and day-trading strategies are immune).",
    );
    return {
      tier: "none",
      returnHaircut: 1.0,
      reasons,
      checklist: CHECKLIST,
      interpretation: "No survivorship-bias risk: the strategy does not pick winners from a historical universe.",
    };
  }

  if (input.universeConstruction === "point_in_time") {
    reasons.push(
      "Point-in-time universe includes delisted/removed names — survivorship-free by construction.",
    );
    return {
      tier: "none",
      returnHaircut: 1.0,
      reasons,
      checklist: CHECKLIST,
      interpretation: "No survivorship-bias risk: the universe is reconstructed point-in-time with failed names included.",
    };
  }

  if (input.universeConstruction === "liquid_broad") {
    reasons.push(
      "Broad-liquid instrument (e.g. SPY/QQQ or a major-cap proxy) — minimally affected by survivorship; index-level exposure absorbs constituent turnover.",
    );
    return {
      tier: "low",
      returnHaircut: HAIRCUT_BY_TIER.low,
      reasons,
      checklist: CHECKLIST,
      interpretation: "Low survivorship-bias risk: broad-liquid exposure is largely immune, but confirm the proxy itself isn't reconstituted survivor-only.",
    };
  }

  // current_snapshot + cross-sectional = the biased case. Score the severity.
  reasons.push(
    "Cross-sectional selection from a CURRENT-snapshot universe across a historical window — the classic survivorship-biased setup: failed/delisted names that existed then are silently excluded now.",
  );

  let score = 0;
  if (windowDays > 3 * YEAR) {
    score += 2;
    reasons.push(`Long window (${(windowDays / YEAR).toFixed(1)}y) — many names had time to delist and be excluded.`);
  } else if (windowDays > YEAR) {
    score += 1;
    reasons.push(`Multi-year window (${(windowDays / YEAR).toFixed(1)}y) — some delisting exclusion likely.`);
  }

  if (assetClass === "crypto") {
    score += 2;
    reasons.push("Crypto universe — tokens delist/die far more aggressively than large-cap equity, amplifying the bias.");
  } else if (assetClass === "equity") {
    score += 1;
    reasons.push("Equity universe — historical index members are routinely removed; bankrupt/merged names drop out.");
  }

  if (universeSize >= 50) {
    score += 2;
    reasons.push(`Broad universe (${universeSize} names) selecting a small basket — many failed candidates excluded from the pool.`);
  } else if (universeSize >= 10) {
    score += 1;
    reasons.push(`Mid-size universe (${universeSize} names) — a meaningful pool of potential failures excluded.`);
  }

  // Any current-snapshot cross-sectional test is at least low-risk by nature.
  const tier: SurvivorshipRiskTier = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  const returnHaircut = HAIRCUT_BY_TIER[tier];

  const interpretation =
    `${tier.toUpperCase()} survivorship-bias risk. Discount reported return by ~${Math.round((1 - returnHaircut) * 100)}% ` +
    `(haircut ×${returnHaircut.toFixed(2)}) as a first-order adjustment, and confirm point-in-time data before trusting the backtest. ` +
    `This is a risk flag, not a correction — without a delisting feed the true survivorship-free result can only be obtained by re-running on a point-in-time universe.`;

  return { tier, returnHaircut, reasons, checklist: CHECKLIST, interpretation };
}
