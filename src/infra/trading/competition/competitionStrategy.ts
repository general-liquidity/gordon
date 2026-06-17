/**
 * FROZEN competition strategy — the single source of truth for the live week.
 *
 * Both the paper-mode rehearsal (`scripts/competition/rehearsals/rehearsal.ts`) and the live
 * runner (`scripts/competition/live-runner.ts`) import this, so WHAT WE REHEARSE IS
 * EXACTLY WHAT GOES LIVE — no drift between the tested config and the armed config.
 *
 * Strategy = beta-stripped TIME-SERIES MOMENTUM. Each instrument independently goes
 * long if its own price trended up over `lookback`, short if down, with a deadband
 * to skip chop and vol-scaled brackets. This is the one lead the exhaustive alpha
 * search surfaced (long-short TSMOM stayed positive OOS while buy-hold fell ~60%):
 * it doesn't clear the deflated bar (so it's NOT a claimed return edge), but its
 * low-drawdown, beta-stripped shape is exactly what the competition's Drawdown (15%)
 * and Sharpe (10%) ranks + the §17 Best-Sharpe Award reward — the controllable score.
 *
 * Sized by `COMPETITION_RISK_SURVIVAL` (tight vol budget, low leverage, −3% daily
 * kill). See that preset for the survive-and-rank rationale. Execution is TAKER —
 * Cypher is FOK/IOC-only (no resting maker orders).
 */

import type { Mt5Bar } from "../../broker/mt5/bridgeClient.ts";
import type { SignalFn, LiveTraderConfig } from "./liveTrader.ts";
import {
  COMPETITION_RISK_SURVIVAL,
  type CompetitionRiskParams,
} from "../../../core/risk-management/competition-risk-preset.ts";

/**
 * The 15 competition-tradeable instruments (FX majors + gold/silver + 5 crypto).
 *
 * Note on `BARUSD`: the Syphonix MT5 catalog labels the 5th crypto symbol "BARUSD" (description
 * "BAR vs USD", currency_base "BAR"), but Discord (Lotus) clarified the UNDERLYING is HBAR
 * (Hedera), not the Barcelona fan-token. So `BARUSD` is the platform's TRADING SYMBOL and HBAR is
 * the asset — our data-fetch maps BARUSD → Binance HBARUSDT, so data/momq/bars/BARUSD_M15.json is
 * correctly Hedera. Keep the symbol as `BARUSD` to match the catalog. Only residual: confirm at
 * login the live symbol string is still "BARUSD" (if they renamed it "HBARUSD", update the label).
 */
export const COMPETITION_TRADEABLE: readonly string[] = [
  "EURUSD", "GBPUSD", "USDCHF", "USDJPY", "USDCAD", "AUDUSD", "EURGBP", "EURCHF",
  "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD",
];

export interface TsmomOptions {
  /** Bars over which the trend is measured (M15 bars). Default 64 (~16h). */
  lookback?: number;
  /** Minimum |move| in ATR units before a trend is tradeable (skips chop). Default 0.6. */
  deadbandAtr?: number;
  /** Protective stop distance in ATR units. Default 2. */
  stopAtr?: number;
  /** Take-profit distance in ATR units. Default 3. */
  targetAtr?: number;
}

/**
 * Build the frozen time-series-momentum SignalFn. Long if the close is above its
 * value `lookback` bars ago by more than the deadband, short if below; brackets
 * scale with the recent average bar range (a simple ATR), so stops are wide in
 * volatile names and tight in calm ones — the per-instrument vol normalization that
 * keeps the book's risk balanced before `sizeCompetitionTrade` even runs.
 */
export function makeTsmomSignal(opts: TsmomOptions = {}): SignalFn {
  const lookback = opts.lookback ?? 64;
  const deadbandAtr = opts.deadbandAtr ?? 0.6;
  const stopAtr = opts.stopAtr ?? 2;
  const targetAtr = opts.targetAtr ?? 3;

  return (bars: Mt5Bar[]) => {
    if (bars.length < lookback + 1) return null;
    const closes = bars.map((b) => b.close);
    const last = closes[closes.length - 1]!;
    const past = closes[closes.length - 1 - lookback]!;
    if (!(last > 0) || !(past > 0)) return null;

    // ATR proxy: mean true-ish range over the lookback window.
    const window = bars.slice(-lookback);
    let rangeSum = 0;
    let rangeN = 0;
    for (const b of window) {
      const r = b.high - b.low;
      if (r > 0) {
        rangeSum += r;
        rangeN += 1;
      }
    }
    const atr = rangeN > 0 ? rangeSum / rangeN : last * 0.001;
    if (!(atr > 0)) return null;

    const move = last - past;
    if (Math.abs(move) < deadbandAtr * atr) return null; // chop → stand aside

    return {
      side: move > 0 ? "long" : "short",
      stopDistance: stopAtr * atr,
      targetDistance: targetAtr * atr,
    };
  };
}

/** Frozen per-symbol signal map over the tradeable universe (one TSMOM per symbol). */
export function competitionSignals(symbols: readonly string[] = COMPETITION_TRADEABLE): Record<string, SignalFn> {
  const sig = makeTsmomSignal();
  const out: Record<string, SignalFn> = {};
  for (const s of symbols) out[s] = sig;
  return out;
}

/** Frozen live-trader config — taker (FOK/IOC venue), M15, −3% daily kill. */
export const COMPETITION_LIVE_CONFIG: LiveTraderConfig = {
  execution: "taker",
  barsLookback: 96, // ≥ lookback + headroom for the ATR window
  dailyLossKillPct: COMPETITION_RISK_SURVIVAL.dailyLossKillPct,
  timeframe: "M15",
};

/** The frozen risk preset for the live week. */
export const COMPETITION_RISK: CompetitionRiskParams = COMPETITION_RISK_SURVIVAL;
