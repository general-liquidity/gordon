/**
 * Correlation Checker
 *
 * Checks whether a new position is too correlated with existing portfolio
 * holdings. Uses predefined correlation groups (BTC ecosystem, L1 alts,
 * DeFi, memes, etc.) and a simple heuristic correlation model.
 *
 * In production this could be replaced with a data-driven correlation
 * matrix from historical price data. The static groups provide a
 * reasonable baseline for crypto markets.
 *
 * A pair the table does not cover is reported as `status: "unknown"`, never
 * as a low-correlation pass, and a check that throws is reported as
 * `status: "error"`. Neither may be scored as a clean result.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import type { OpenPosition } from "./portfolio-context.ts";

const logger = createModuleLogger("correlation-checker");

// ============================================================================
// Types
// ============================================================================

/**
 * Outcome of a correlation check.
 *
 * - `checked`: every symbol involved is in the correlation table, so the
 *   numbers below are the model's real verdict.
 * - `unknown`: at least one symbol is absent from the table. The estimates
 *   below are a crypto-beta guess, not a measurement. Never score this as a
 *   clean pass: silence about a pair is not evidence that it is uncorrelated.
 * - `error`: the check threw. Nothing was measured and nothing here may be
 *   scored.
 */
export type CorrelationStatus = "checked" | "unknown" | "error";

export interface CorrelationResult {
  /** Outcome class of the check. Callers must branch on this before scoring. */
  status: CorrelationStatus;
  /** Whether the new position passes the correlation check */
  acceptable: boolean;
  /**
   * Correlation score of the new position with existing portfolio (0-1).
   * `null` when nothing was computed (`status: "error"`).
   */
  maxCorrelation: number | null;
  /** The symbol most correlated with the new position */
  mostCorrelatedWith: string | null;
  /** The correlation group the new position belongs to */
  group: string | null;
  /**
   * Percentage of portfolio in the same correlation group.
   * `null` when nothing was computed (`status: "error"`).
   */
  groupExposurePercent: number | null;
  /** Symbols absent from the correlation table, hence unmodelled */
  unknownSymbols: string[];
  /** Human-readable explanation */
  details: string;
}

// ============================================================================
// Correlation Groups
// ============================================================================

/**
 * Predefined correlation groups for crypto assets.
 * Assets in the same group tend to move together.
 *
 * Intra-group correlation is assumed to be ~0.7-0.9.
 * Cross-group correlation is assumed to be ~0.3-0.5.
 * BTC correlates with everything at ~0.4-0.6.
 */
const CORRELATION_GROUPS: Map<string, string[]> = new Map([
  // BTC ecosystem
  ["btc_ecosystem", ["BTCUSDT", "WBTCUSDT", "BTCBUSDT"]],

  // Major L1s (high BTC correlation)
  [
    "major_l1",
    [
      "ETHUSDT",
      "SOLUSDT",
      "ADAUSDT",
      "AVAXUSDT",
      "DOTUSDT",
      "ATOMUSDT",
      "NEARUSDT",
      "APTUSDT",
      "SUIUSDT",
      "SEIUSDT",
    ],
  ],

  // L2 / Ethereum ecosystem
  [
    "eth_l2",
    ["MATICUSDT", "ARBUSDT", "OPUSDT", "STRKUSDT", "ZKUSDT", "MANTAUSDT", "METISUSDT", "IMXUSDT"],
  ],

  // DeFi
  [
    "defi",
    [
      "UNIUSDT",
      "AAVEUSDT",
      "MKRUSDT",
      "COMPUSDT",
      "SUSHIUSDT",
      "CRVUSDT",
      "LDOUSDT",
      "PENDLEUSDT",
      "JUPUSDT",
      "RAYUSDT",
      "DYDXUSDT",
      "1INCHUSDT",
    ],
  ],

  // Meme coins
  [
    "meme",
    [
      "DOGEUSDT",
      "SHIBUSDT",
      "PEPEUSDT",
      "FLOKIUSDT",
      "BONKUSDT",
      "WIFUSDT",
      "MEMEUSDT",
      "BOMEUSDT",
    ],
  ],

  // AI tokens
  ["ai", ["FETUSDT", "AGIXUSDT", "OCEANUSDT", "RENDERUSDT", "TAOUSDT", "AKTUSDT", "ARKMUSDT"]],

  // Gaming / Metaverse
  [
    "gaming",
    [
      "AXSUSDT",
      "SANDUSDT",
      "MANAUSDT",
      "GALAUSDT",
      "ENJUSDT",
      "ILVUSDT",
      "PIXELUSDT",
      "PORTALUSDT",
    ],
  ],

  // Exchange tokens
  ["exchange", ["BNBUSDT", "FTMUSDT", "OKBUSDT", "CAKEUSDT"]],

  // Staking / Infrastructure
  ["infra", ["LINKUSDT", "GRTUSDT", "FILUSDT", "ARUSDT", "THETAUSDT", "HNTUSDT"]],
]);

/**
 * Reverse lookup: symbol -> group name
 */
const SYMBOL_TO_GROUP: Map<string, string> = new Map();
for (const [group, symbols] of CORRELATION_GROUPS) {
  for (const symbol of symbols) {
    SYMBOL_TO_GROUP.set(symbol, group);
  }
}

/**
 * Intra-group correlation coefficients (how correlated assets within
 * the same group are assumed to be).
 */
const INTRA_GROUP_CORRELATION: Record<string, number> = {
  btc_ecosystem: 0.95,
  major_l1: 0.8,
  eth_l2: 0.85,
  defi: 0.75,
  meme: 0.7,
  ai: 0.75,
  gaming: 0.7,
  exchange: 0.6,
  infra: 0.65,
};

/** Default cross-group correlation (BTC beta) */
const DEFAULT_CROSS_GROUP_CORRELATION = 0.4;

/** Default intra-group correlation for unknown groups */
const DEFAULT_INTRA_GROUP_CORRELATION = 0.5;

// ============================================================================
// Correlation Checker
// ============================================================================

export class CorrelationChecker {
  private correlationGroups: Map<string, string[]>;
  private symbolToGroup: Map<string, string>;

  constructor() {
    this.correlationGroups = new Map(CORRELATION_GROUPS);
    this.symbolToGroup = new Map(SYMBOL_TO_GROUP);
  }

  /**
   * Check if a new position is too correlated with existing holdings.
   *
   * @param newSymbol - The symbol of the new position
   * @param newSide - The side of the new position (long/short)
   * @param existingPositions - Current open positions
   * @param maxCorrelatedExposurePercent - Maximum allowed exposure in correlated group (default: 40%)
   * @param totalEquity - Total portfolio equity for exposure calculation
   */
  async checkCorrelation(
    newSymbol: string,
    newSide: "long" | "short",
    existingPositions: OpenPosition[],
    maxCorrelatedExposurePercent: number = 40,
    totalEquity: number = 0,
  ): Promise<CorrelationResult> {
    try {
      if (existingPositions.length === 0) {
        // Nothing to correlate against, so an unlisted symbol is not a gap here.
        return {
          status: "checked",
          acceptable: true,
          maxCorrelation: 0,
          mostCorrelatedWith: null,
          group: this.getGroup(newSymbol),
          groupExposurePercent: 0,
          unknownSymbols: [],
          details: "No existing positions. Correlation check passed.",
        };
      }

      const newGroup = this.getGroup(newSymbol);
      const unknownSymbols = this.collectUnknownSymbols(newSymbol, existingPositions);
      let maxCorrelation = 0;
      let mostCorrelatedWith: string | null = null;

      // Calculate correlation with each existing position
      for (const pos of existingPositions) {
        const correlation = this.getCorrelation(newSymbol, pos.symbol);

        // If opposite sides, effective correlation is negative (hedging)
        const effectiveCorrelation = newSide === pos.side ? correlation : -correlation;

        if (effectiveCorrelation > maxCorrelation) {
          maxCorrelation = effectiveCorrelation;
          mostCorrelatedWith = pos.symbol;
        }
      }

      // Calculate group exposure
      let groupExposureValue = 0;
      if (newGroup && totalEquity > 0) {
        for (const pos of existingPositions) {
          const posGroup = this.getGroup(pos.symbol);
          if (posGroup === newGroup) {
            groupExposureValue += pos.size * pos.currentPrice;
          }
        }
      }

      const groupExposurePercent = totalEquity > 0 ? (groupExposureValue / totalEquity) * 100 : 0;

      // Determine if acceptable
      const acceptable = groupExposurePercent < maxCorrelatedExposurePercent;

      const status: CorrelationStatus = unknownSymbols.length > 0 ? "unknown" : "checked";

      let details: string;
      if (!acceptable) {
        details = `Correlation group "${newGroup}" already has ${groupExposurePercent.toFixed(1)}% exposure (limit: ${maxCorrelatedExposurePercent}%). Adding ${newSymbol} would increase concentrated risk.`;
      } else if (status === "unknown") {
        details = `Correlation is UNKNOWN, not low: ${unknownSymbols.join(", ")} ${unknownSymbols.length === 1 ? "is" : "are"} absent from the correlation table, so no correlation with the existing portfolio was measured. The ${maxCorrelation.toFixed(2)} figure is an unverified crypto-beta assumption.`;
      } else if (maxCorrelation > 0.8) {
        details = `High correlation (${maxCorrelation.toFixed(2)}) with ${mostCorrelatedWith}. Group exposure: ${groupExposurePercent.toFixed(1)}%.`;
      } else if (maxCorrelation > 0.5) {
        details = `Moderate correlation (${maxCorrelation.toFixed(2)}) with ${mostCorrelatedWith}. Diversification acceptable.`;
      } else {
        details = `Low correlation with existing positions. Good diversification.`;
      }

      logger.debug("Correlation check completed", {
        newSymbol,
        status,
        group: newGroup,
        maxCorrelation: maxCorrelation.toFixed(2),
        mostCorrelatedWith,
        groupExposurePercent: groupExposurePercent.toFixed(1),
        acceptable,
      });

      return {
        status,
        acceptable,
        maxCorrelation,
        mostCorrelatedWith,
        group: newGroup,
        groupExposurePercent,
        unknownSymbols,
        details,
      };
    } catch (error) {
      logger.error("Error checking correlation", error as Error);
      // A risk check that throws has measured nothing. Reporting a pass here
      // would make the gate unfailable, which reads as evidence of safety and
      // is not. The numeric fields stay null so no caller can score them.
      return {
        status: "error",
        acceptable: false,
        maxCorrelation: null,
        mostCorrelatedWith: null,
        group: null,
        groupExposurePercent: null,
        unknownSymbols: [],
        details: `Correlation check failed to run: ${(error as Error).message}. Correlated-exposure limits were not verified.`,
      };
    }
  }

  /**
   * Symbols involved in the check that the static table has never heard of.
   * Their correlation is assumed, not measured.
   */
  private collectUnknownSymbols(newSymbol: string, existingPositions: OpenPosition[]): string[] {
    const unknown = new Set<string>();
    if (!this.getGroup(newSymbol)) unknown.add(newSymbol.toUpperCase());
    for (const pos of existingPositions) {
      if (!this.getGroup(pos.symbol)) unknown.add(pos.symbol.toUpperCase());
    }
    return Array.from(unknown);
  }

  /**
   * Get the estimated correlation between two symbols.
   * Uses group membership as a proxy.
   *
   * @param symbolA - First symbol
   * @param symbolB - Second symbol
   * @param _period - Lookback period in days (reserved for future data-driven implementation)
   * @returns Correlation coefficient (0-1)
   */
  getCorrelation(symbolA: string, symbolB: string, _period?: number): number {
    // Same symbol = perfect correlation
    if (symbolA === symbolB) return 1.0;

    const groupA = this.getGroup(symbolA);
    const groupB = this.getGroup(symbolB);

    // Both in the same group
    if (groupA && groupB && groupA === groupB) {
      return INTRA_GROUP_CORRELATION[groupA] ?? DEFAULT_INTRA_GROUP_CORRELATION;
    }

    // BTC correlates more with everything
    const isBtcRelated = (s: string) => s.startsWith("BTC") || this.getGroup(s) === "btc_ecosystem";

    if (isBtcRelated(symbolA) || isBtcRelated(symbolB)) {
      // BTC vs major L1 = higher correlation
      const other = isBtcRelated(symbolA) ? symbolB : symbolA;
      const otherGroup = this.getGroup(other);
      if (otherGroup === "major_l1") return 0.65;
      if (otherGroup === "eth_l2") return 0.55;
      return 0.5;
    }

    // Different groups (or unknown)
    if (groupA && groupB) {
      return DEFAULT_CROSS_GROUP_CORRELATION;
    }

    // One or both unknown — assume moderate correlation (crypto beta)
    return 0.35;
  }

  /**
   * Get the correlation group for a symbol.
   */
  getGroup(symbol: string): string | null {
    return this.symbolToGroup.get(symbol.toUpperCase()) ?? null;
  }

  /**
   * Get all symbols in a correlation group.
   */
  getGroupMembers(groupName: string): string[] {
    return this.correlationGroups.get(groupName) ?? [];
  }

  /**
   * Get all known correlation group names.
   */
  getGroupNames(): string[] {
    return Array.from(this.correlationGroups.keys());
  }
}

/** Default singleton instance */
export const correlationChecker = new CorrelationChecker();
