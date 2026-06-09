/**
 * Competition runner — one configured entry point for the Model to Market hack
 * (and any short, leveraged, Sharpe-judged session).
 *
 * Composes pieces Gordon already has — the competition risk preset, the
 * asset-class universe, a survive-and-compound mandate — into a single config
 * the autonomous loop / executor consumes. ADDITIVE: it does NOT change default
 * live behavior; on kickoff you point the loop at this config and set the venue.
 *
 * Symbols are resolved from the venue catalog at runtime (NOT hardcoded) — the
 * config scopes ASSET CLASSES. FX/metals are structural (ISO-4217 pairs, XAU/XAG);
 * crypto bases come from the Syphonix instrument catalog on June 15.
 */

import {
  COMPETITION_RISK_DEFAULTS,
  sizeCompetitionTrade,
  type CompetitionRiskParams,
  type CompetitionTradeInput,
  type CompetitionTradeResult,
} from "../risk-management/competition-risk-preset.ts";

export type CompetitionVenue = "paper" | "syphonix";
export type CompetitionAssetClass = "fx" | "metals" | "crypto";

export interface CompetitionRunConfig {
  venue: CompetitionVenue;
  startingEquity: number;
  /** Asset classes in scope; concrete symbols are resolved from the venue catalog at runtime. */
  assetClasses: CompetitionAssetClass[];
  riskProfile: CompetitionRiskParams;
  /** Live-trading window length (days) — the Sharpe-judged session. */
  sessionHorizonDays: number;
  mandate: string;
}

export const COMPETITION_MANDATE =
  "Maximize risk-adjusted return (Sharpe) over the session while guaranteeing no wipeout: " +
  "size every trade through the competition risk preset (min-of-caps), halt the day on the daily-loss kill, " +
  "never exceed the concurrent-exposure cap, and prefer robust systematic signals over leaderboard-gaming. " +
  "Survive-and-compound — the blind phase rewards consistency, not variance.";

export function buildCompetitionRunConfig(overrides: Partial<CompetitionRunConfig> = {}): CompetitionRunConfig {
  const base: CompetitionRunConfig = {
    venue: "paper",
    startingEquity: 1_000_000,
    assetClasses: ["fx", "metals", "crypto"],
    riskProfile: COMPETITION_RISK_DEFAULTS,
    sessionHorizonDays: 5,
    mandate: COMPETITION_MANDATE,
  };
  return {
    ...base,
    ...overrides,
    // merge a partial riskProfile over the preset rather than replacing it wholesale
    riskProfile: { ...COMPETITION_RISK_DEFAULTS, ...overrides.riskProfile },
  };
}

/** Size the next order under the competition risk profile (delegates to the preset). */
export function sizeCompetitionOrder(input: CompetitionTradeInput): CompetitionTradeResult {
  return sizeCompetitionTrade({ ...input, params: { ...COMPETITION_RISK_DEFAULTS, ...input.params } });
}
