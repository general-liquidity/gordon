/**
 * Funding Alert Producer
 *
 * Periodic producer that fetches Hyperliquid perpetual funding rates from
 * the public API (no auth needed) and fires a `funding_alert` candidate when
 * a monitored coin's funding is anomalous. Two trigger conditions:
 *
 *   1. Annualized funding > 20% (long-biased squeeze risk)
 *   2. Annualized funding < -20% (short-biased squeeze risk)
 *
 * Hyperliquid funding is quoted per hour; annualized = hourly * 24 * 365.
 * We use the public `metaAndAssetCtxs` POST endpoint which returns market
 * metadata including current funding per coin.
 *
 * State: tracks last-seen funding rate per coin so we only fire on a
 * meaningful change (sign flip, or ±5 percentage points of annualized rate).
 */

import type { CandidateProducer } from "../engine/proactiveEngine.ts";
import { buildCandidate } from "../engine/proactiveEngine.ts";
import type { ProactiveSuggestion } from "../types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("funding-alert-producer");

// Coins to watch — top-liquidity Hyperliquid perps. Users can override later
// via a configure tool if desired.
const MONITORED_COINS = ["BTC", "ETH", "SOL", "HYPE", "DOGE"];

const HOURLY_TO_ANNUAL = 24 * 365;
const HIGH_FUNDING_ANNUAL_PCT = 20; // |rate| > 20% annualized → alert
const CHANGE_THRESHOLD_PCT = 5; // Require 5pp change from last fire

interface FundingState {
  lastAnnualizedPct: number;
  lastFiredAt: number;
}

const stateByCoin = new Map<string, FundingState>();

interface HyperliquidMetaResponse {
  universe?: Array<{ name: string }>;
}

/**
 * Hyperliquid's metaAndAssetCtxs endpoint returns a TUPLE:
 *   [meta, assetCtxs]
 * where assetCtxs[i] has current funding for universe[i]. Public, no auth.
 */
interface AssetCtx {
  funding?: string; // hourly rate as string
  openInterest?: string;
  markPx?: string;
  midPx?: string;
  prevDayPx?: string;
}

async function fetchHyperliquidFunding(): Promise<Map<string, number>> {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "gordon-cli/0.7" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.debug("Hyperliquid metaAndAssetCtxs returned non-OK", { status: res.status });
      return new Map();
    }
    const json = (await res.json()) as [HyperliquidMetaResponse, AssetCtx[]];
    if (!Array.isArray(json) || json.length < 2) return new Map();
    const [meta, ctxs] = json;
    const universe = meta?.universe ?? [];
    const fundingByCoin = new Map<string, number>();
    for (let i = 0; i < universe.length && i < ctxs.length; i++) {
      const name = universe[i]?.name;
      const fundingStr = ctxs[i]?.funding;
      if (!name || !fundingStr) continue;
      const hourlyRate = Number(fundingStr);
      if (!Number.isFinite(hourlyRate)) continue;
      fundingByCoin.set(name, hourlyRate);
    }
    return fundingByCoin;
  } catch (err) {
    logger.debug("Hyperliquid funding fetch failed", { err: String(err) });
    return new Map();
  }
}

export const fundingAlertProducer: CandidateProducer = async (obs): Promise<ProactiveSuggestion[]> => {
  if (obs.source !== "monitor_loop" || obs.eventType !== "tick_funding") return [];

  const fundingMap = await fetchHyperliquidFunding();
  if (fundingMap.size === 0) return [];

  const candidates: ProactiveSuggestion[] = [];

  for (const coin of MONITORED_COINS) {
    const hourlyRate = fundingMap.get(coin);
    if (hourlyRate === undefined) continue;

    const annualizedPct = hourlyRate * HOURLY_TO_ANNUAL * 100;
    const state = stateByCoin.get(coin);

    // Not anomalous → skip, but update state
    if (Math.abs(annualizedPct) < HIGH_FUNDING_ANNUAL_PCT) {
      stateByCoin.set(coin, { lastAnnualizedPct: annualizedPct, lastFiredAt: state?.lastFiredAt ?? 0 });
      continue;
    }

    // Anomalous — check if we've fired recently for this coin with similar reading
    if (state) {
      const priceChange = Math.abs(annualizedPct - state.lastAnnualizedPct);
      const signFlipped = Math.sign(annualizedPct) !== Math.sign(state.lastAnnualizedPct) && state.lastAnnualizedPct !== 0;
      const recentFire = Date.now() - state.lastFiredAt < 2 * 60 * 60 * 1000; // 2 hour recency
      if (recentFire && !signFlipped && priceChange < CHANGE_THRESHOLD_PCT) {
        continue; // Same alert essentially — suppress
      }
    }

    const direction = annualizedPct > 0 ? "longs paying shorts" : "shorts paying longs";
    const pressure = annualizedPct > 0 ? "long-biased" : "short-biased";
    const flipWarning = state && Math.sign(annualizedPct) !== Math.sign(state.lastAnnualizedPct) && state.lastAnnualizedPct !== 0
      ? ` FUNDING FLIPPED from ${state.lastAnnualizedPct.toFixed(1)}%.`
      : "";

    candidates.push(
      buildCandidate(
        "funding_alert",
        `${coin}-PERP funding ${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(1)}% annualized`,
        `Hyperliquid ${coin} perpetual funding is ${annualizedPct > 0 ? "+" : ""}${annualizedPct.toFixed(2)}% ` +
          `annualized (${direction}).${flipWarning} ` +
          `${pressure} positioning at this extreme is historically associated with elevated squeeze risk — ` +
          `${annualizedPct > 0
            ? "overextended longs can get flushed on any pullback"
            : "overextended shorts can get squeezed on any rally"}. ` +
          `Worth reviewing any open ${coin} positions and adjusting risk.`,
        {
          confidence: Math.abs(annualizedPct) > 40 ? 0.88 : 0.75,
          action: `Check open ${coin} positions and consider hedging or reducing exposure`,
          triggers: {
            source: "monitor_loop",
            eventType: "tick_funding",
            symbol: `${coin}-PERP`,
            metadata: {
              hourlyRate,
              annualizedPct,
              venue: "hyperliquid",
              previousAnnualizedPct: state?.lastAnnualizedPct,
            },
          },
          // No operation — funding alerts are informational; user decides next action
        },
      ),
    );

    stateByCoin.set(coin, { lastAnnualizedPct: annualizedPct, lastFiredAt: Date.now() });
  }

  return candidates;
};

/** Reset state. Called on producer unregister. */
export function resetFundingAlertProducerState(): void {
  stateByCoin.clear();
}
