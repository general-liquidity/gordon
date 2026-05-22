/**
 * Canonical historical-break events for the replay framework.
 *
 * Four events the "Don't Trust Your Backtest" post identifies as the
 * minimum stress-test set for any FX / indices / metals systematic
 * book. Operators trading other asset classes (pure equities, crypto)
 * should add their own events — the catalog is a starting point, not
 * an exhaustive list.
 *
 * Each entry encodes:
 *   - Window bounds (slightly wider than the event itself to give the
 *     strategy "before / during / after" context)
 *   - The vol-expansion start timestamp (the moment the move actually
 *     began — used to measure risk-engine response time)
 *   - Primary + contagion assets the operator should populate with
 *     historical data
 *   - Characteristics flags so the slippage model can react
 *
 * References point to regulator announcements / post-mortems for
 * operator verification.
 */

import type { HistoricalEvent } from "./types.ts";

export const CHF_UNPEG_2015: HistoricalEvent = {
  id: "chf-unpeg-2015-01-15",
  name: "Swiss Franc unpeg",
  description:
    "SNB removed the EURCHF 1.20 floor at 10:30 CET on 15 January 2015. " +
    "EURCHF moved roughly 30% in minutes, gapping through liquidity " +
    "levels. Multiple FX brokers went insolvent within 24 hours. " +
    "Canonical test for FX strategies that hold positions through " +
    "low-vol regimes and rely on stops behaving normally.",
  windowStart: "2015-01-14T22:00:00Z",
  windowEnd: "2015-01-16T22:00:00Z",
  volExpansionStart: "2015-01-15T09:30:00Z",
  primaryAssets: [
    { symbol: "EURCHF", market: "fx", reactionNote: "Down ~30% in minutes, gapped through 1.20 floor" },
    { symbol: "USDCHF", market: "fx", reactionNote: "Down ~28% on the move" },
    { symbol: "GBPCHF", market: "fx", reactionNote: "Down ~32% — illiquid crosses worst hit" },
  ],
  contagionAssets: [
    { symbol: "EURUSD", market: "fx", reactionNote: "Initial -1% before reversal" },
    { symbol: "XAUUSD", market: "metals", reactionNote: "Spiked ~2% as safe-haven flow" },
  ],
  characteristics: {
    primaryMove: "EURCHF -30% in minutes; gap-through-floor execution; broker insolvencies",
    gapRisk: true,
    spreadWidening: true,
    sessionsHalted: false,
  },
  references: [
    "SNB press release, 15 Jan 2015",
    "FSB / FCA post-mortems on FX broker insolvencies",
  ],
};

export const PBOC_CNY_DEVALUATION_2015: HistoricalEvent = {
  id: "pboc-cny-devaluation-2015-08-11",
  name: "PBOC CNY devaluation",
  description:
    "PBOC changed the CNY daily fix methodology on 11 August 2015. " +
    "Yuan dropped ~2% over two days, dragging AUD, NZD, copper, and " +
    "risk indices with it. Even strategies that don't trade CNY are " +
    "tested here for hidden USD-bloc / risk-on factor exposure that " +
    "calm-regime correlations miss.",
  windowStart: "2015-08-10T22:00:00Z",
  windowEnd: "2015-08-14T22:00:00Z",
  volExpansionStart: "2015-08-11T01:15:00Z",
  primaryAssets: [
    { symbol: "USDCNH", market: "fx", reactionNote: "Up ~2% over 48 hours" },
    { symbol: "AUDUSD", market: "fx", reactionNote: "Down ~3% — AU exports correlation" },
    { symbol: "NZDUSD", market: "fx", reactionNote: "Down ~3%" },
  ],
  contagionAssets: [
    { symbol: "COPPER", market: "commodity", reactionNote: "Down ~5% across the event" },
    { symbol: "AUDJPY", market: "fx", reactionNote: "Down ~4% — classic risk-off cross" },
    { symbol: "DAX", market: "equity_index", reactionNote: "Down ~6% over the week" },
    { symbol: "SPX", market: "equity_index", reactionNote: "Down ~5%" },
  ],
  characteristics: {
    primaryMove: "USDCNH +2% over 48h; cross-asset contagion via USD-bloc factor",
    gapRisk: false,
    spreadWidening: true,
    sessionsHalted: false,
  },
  references: [
    "PBOC fixing-mechanism announcement, 11 Aug 2015",
    "BIS quarterly review on cross-asset spillovers",
  ],
};

export const US_ELECTION_OVERNIGHT_2016: HistoricalEvent = {
  id: "us-election-overnight-2016-11-08",
  name: "US Election overnight",
  description:
    "Spot moves of ~3% in major FX pairs in 60 minutes between US " +
    "session close on Tuesday 8 Nov 2016 and Asia open on Wednesday. " +
    "Index futures hit circuit-breakers. Gold spiked then collapsed. " +
    "Canonical test for gap risk: what does your strategy do across " +
    "the close/open window when you can't manage positions?",
  windowStart: "2016-11-08T20:00:00Z",
  windowEnd: "2016-11-09T22:00:00Z",
  volExpansionStart: "2016-11-09T03:00:00Z",
  primaryAssets: [
    { symbol: "MXNUSD", market: "fx", reactionNote: "Peso -13% before partial reversal — worst-hit major" },
    { symbol: "USDJPY", market: "fx", reactionNote: "Down ~4% then reversed to +2%" },
    { symbol: "EURUSD", market: "fx", reactionNote: "Up ~2.5% then mostly reversed" },
  ],
  contagionAssets: [
    { symbol: "SPX", market: "equity_index", reactionNote: "Futures down ~5%, circuit-breakered, then closed +1%" },
    { symbol: "XAUUSD", market: "metals", reactionNote: "Spiked +5%, ended -1%" },
    { symbol: "BTCUSD", market: "crypto", reactionNote: "+5% safe-haven bid, sustained" },
  ],
  characteristics: {
    primaryMove: "Major FX +/- 3-13% in 60min; index futures circuit-breakered; overnight management gap",
    gapRisk: true,
    spreadWidening: true,
    sessionsHalted: true,
  },
  references: [
    "CME circuit-breaker logs, 8-9 Nov 2016",
    "BIS market commentary on election-night FX",
  ],
};

export const COVID_VOL_SPIKE_2020: HistoricalEvent = {
  id: "covid-vol-spike-2020-03-11",
  name: "COVID-19 volatility spike",
  description:
    "VIX hit 82.69 on 16 March 2020. SPX dropped ~12% in a single " +
    "session that day. FX vol surfaces lifted across the dollar bloc. " +
    "Multiple ETFs traded materially below NAV. Test for: mean-" +
    "reversion strategies assuming prior regime persists, vol-targeted " +
    "sizing that should have cut size, and CFD brokers that widened " +
    "spreads beyond strategy economics.",
  windowStart: "2020-03-09T13:30:00Z",
  windowEnd: "2020-03-24T20:00:00Z",
  volExpansionStart: "2020-03-11T13:00:00Z",
  primaryAssets: [
    { symbol: "SPX", market: "equity_index", reactionNote: "Down ~12% on 16 March; multiple limit-down events" },
    { symbol: "VIX", market: "equity_index", reactionNote: "82.69 close on 16 March — second-highest ever" },
    { symbol: "DXY", market: "fx", reactionNote: "Spiked from 95 to 103 in 10 days — dollar squeeze" },
  ],
  contagionAssets: [
    { symbol: "AUDUSD", market: "fx", reactionNote: "Down ~10% from 0.66 to 0.55" },
    { symbol: "EURUSD", market: "fx", reactionNote: "Down ~5% then reversed sharply" },
    { symbol: "XAUUSD", market: "metals", reactionNote: "Down ~12% mid-event despite safe-haven status (liquidation flow)" },
    { symbol: "WTI", market: "commodity", reactionNote: "Down ~50% across the event" },
    { symbol: "BTCUSD", market: "crypto", reactionNote: "Down ~50% on March 12" },
  ],
  characteristics: {
    primaryMove: "VIX 82+; SPX -12% in a day; dollar squeeze; vol surfaces lifted globally",
    gapRisk: true,
    spreadWidening: true,
    sessionsHalted: true,
  },
  references: [
    "BIS quarterly review, dash-for-cash analysis",
    "Fed announcement of unlimited QE, 23 Mar 2020",
  ],
};

/**
 * Canonical event catalog — the minimum stress-test set for any
 * FX / indices / metals systematic book.
 */
export const CANONICAL_EVENTS: HistoricalEvent[] = [
  CHF_UNPEG_2015,
  PBOC_CNY_DEVALUATION_2015,
  US_ELECTION_OVERNIGHT_2016,
  COVID_VOL_SPIKE_2020,
];

/**
 * Look up a canonical event by id. Returns undefined when the id
 * isn't in the catalog (operator should add their own to a custom
 * registry rather than mutating this list).
 */
export function getCanonicalEvent(id: string): HistoricalEvent | undefined {
  return CANONICAL_EVENTS.find((e) => e.id === id);
}
