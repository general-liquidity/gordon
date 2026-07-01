/**
 * Post-blow-off / parabolic-snapback PRE-ENTRY veto.
 *
 * Gordon already ships several exhaustion detectors, but they run as
 * IN-TRADE exits (get me out of a position that has gone vertical). Nothing
 * consumed them the other way round — as a gate that blocks OPENING a fresh
 * position in the direction of a parabolic blow-off (chasing a vertical move
 * that is statistically more likely to snap back than to extend).
 *
 * This primitive composes three shipped signals into that pre-entry veto:
 *   1. ATR daily progression  (atrDailyProgression) — how much of the day's
 *      volatility budget the current range has already spent.
 *   2. Vertical extension of the last N bars — the net close-to-close move
 *      over the trailing window measured in per-bar ATR multiples, plus how
 *      one-directional those bars were (parabolic = fast + one-way).
 *   3. Volume exhaustion (volume-exhaustion) — volume fading INTO the vertical
 *      move, the classic blow-off climax tell.
 *
 * The veto only bites when the proposed entry is IN THE SAME DIRECTION as the
 * detected blow-off (a long into a vertical rip, a short into a vertical
 * flush). A counter-trend entry, or any entry when no blow-off is present, is
 * always allowed — this gate never blocks fading the move.
 *
 * Pure compute over injected bars. No I/O, never throws.
 */

import { computeAtrProgression, type AtrProgressionCandle } from "./atrDailyProgression.ts";
import {
  detectVolumeExhaustion,
  type ExhaustionSeverity,
} from "../../../core/alpha/volume-exhaustion.ts";

export interface BlowOffCandle {
  /** Epoch milliseconds (used for the daily ATR-progression grouping). */
  timestamp: number;
  high: number;
  low: number;
  close: number;
  /** USD volume for this bar. Optional — enables the volume-exhaustion leg. */
  volumeUsd?: number;
}

export interface BlowOffVetoInput {
  /** Direction of the proposed FRESH entry. */
  side: "long" | "short";
  /** Intraday candles, oldest-first. */
  candles: ReadonlyArray<BlowOffCandle>;
  /** Trailing-bar window that defines the "vertical move". Default 5. */
  extensionBars?: number;
  /** Per-bar ATR lookback for the vertical-extension leg. Default 14. */
  atrLookback?: number;
  /** Prior-day lookback for the daily ATR-progression leg. Default 14. */
  dailyAtrLookback?: number;
  /**
   * Net move (in per-bar ATR multiples over `extensionBars`) that counts as
   * parabolic. Default 3 — i.e. price travelled >= 3 ATRs in one direction
   * across the trailing window.
   */
  parabolicAtrMultiple?: number;
  /**
   * Minimum fraction of the trailing bars that must move in the net direction
   * for the move to count as parabolic (one-directional). Default 0.6.
   */
  minDirectionalAgreement?: number;
}

export type BlowOffVerdict = "allow" | "downgrade" | "veto";

export interface BlowOffVetoResult {
  /** allow = open normally, downgrade = size down, veto = do not chase. */
  verdict: BlowOffVerdict;
  /** 0-100 pressure that the entry is chasing an exhausted vertical move. */
  vetoScore: number;
  /** Suggested position-size multiplier (1 = full, 0.5 = downgrade, 0 = veto). */
  sizeMultiplier: number;
  /** Whether a parabolic blow-off was detected in the trailing bars. */
  blowOffDetected: boolean;
  blowOffDirection: "up" | "down" | "none";
  /** True when the proposed entry chases the blow-off (same direction). */
  chasing: boolean;
  /** Net trailing-window move measured in per-bar ATR multiples. */
  extensionAtrMultiple: number;
  /** Fraction of trailing bars moving in the net direction (0..1). */
  directionalAgreement: number;
  /** Sub-scores (0-100) that fed the composite. */
  components: {
    extension: number;
    progression: number;
    volume: number;
  };
  atrProgression: {
    progressionPct: number;
    zone: string;
    suggestedAction: string;
  } | null;
  volumeExhaustion: {
    applicable: boolean;
    severity: ExhaustionSeverity;
    dropFraction: number;
  } | null;
  reasoning: string;
}

const DEFAULT_EXTENSION_BARS = 5;
const DEFAULT_ATR_LOOKBACK = 14;
const DEFAULT_DAILY_ATR_LOOKBACK = 14;
const DEFAULT_PARABOLIC_ATR_MULTIPLE = 3;
const DEFAULT_MIN_DIRECTIONAL_AGREEMENT = 0.6;

const VETO_THRESHOLD = 65;
const DOWNGRADE_THRESHOLD = 40;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function allow(
  reasoning: string,
  partial: Partial<BlowOffVetoResult> = {},
): BlowOffVetoResult {
  return {
    verdict: "allow",
    vetoScore: 0,
    sizeMultiplier: 1,
    blowOffDetected: false,
    blowOffDirection: "none",
    chasing: false,
    extensionAtrMultiple: 0,
    directionalAgreement: 0,
    components: { extension: 0, progression: 0, volume: 0 },
    atrProgression: null,
    volumeExhaustion: null,
    reasoning,
    ...partial,
  };
}

/** Wilder per-bar ATR (SMA of true range over the last `lookback` bars). */
function perBarAtr(candles: ReadonlyArray<BlowOffCandle>, lookback: number): number {
  const n = candles.length;
  const trs: number[] = [];
  for (let i = Math.max(1, n - lookback); i < n; i++) {
    const cur = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    trs.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prevClose),
        Math.abs(cur.low - prevClose),
      ),
    );
  }
  if (trs.length === 0) return 0;
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function severityScore(severity: ExhaustionSeverity): number {
  if (severity === "severe") return 80;
  if (severity === "mild") return 45;
  return 0;
}

export function assessBlowOffEntryVeto(input: BlowOffVetoInput): BlowOffVetoResult {
  const extensionBars = Math.max(2, Math.floor(input.extensionBars ?? DEFAULT_EXTENSION_BARS));
  const atrLookback = Math.max(2, Math.floor(input.atrLookback ?? DEFAULT_ATR_LOOKBACK));
  const parabolicMult = input.parabolicAtrMultiple ?? DEFAULT_PARABOLIC_ATR_MULTIPLE;
  const minAgreement = input.minDirectionalAgreement ?? DEFAULT_MIN_DIRECTIONAL_AGREEMENT;
  const candles = input.candles;
  const n = candles.length;

  if (n < extensionBars + 1) {
    return allow(`insufficient bars for vertical-extension (need >= ${extensionBars + 1}, got ${n})`);
  }

  // Vertical extension: net close-to-close move over the trailing window.
  const lastClose = candles[n - 1]!.close;
  const priorClose = candles[n - 1 - extensionBars]!.close;
  const netMove = lastClose - priorClose;
  const moveDir: "up" | "down" = netMove >= 0 ? "up" : "down";

  const atr = perBarAtr(candles, atrLookback);
  const extensionAtrMultiple = atr > 0 ? Math.abs(netMove) / atr : 0;

  // Directional agreement: fraction of trailing bars moving in the net dir.
  let agree = 0;
  for (let i = n - extensionBars; i < n; i++) {
    const delta = candles[i]!.close - candles[i - 1]!.close;
    if ((moveDir === "up" && delta > 0) || (moveDir === "down" && delta < 0)) agree += 1;
  }
  const directionalAgreement = agree / extensionBars;

  const parabolic = extensionAtrMultiple >= parabolicMult && directionalAgreement >= minAgreement;
  const blowOffDirection: "up" | "down" | "none" = parabolic ? moveDir : "none";
  const chasing =
    (input.side === "long" && moveDir === "up") ||
    (input.side === "short" && moveDir === "down");

  // ── ATR daily-progression leg ──
  const progCandles: AtrProgressionCandle[] = candles.map((c) => ({
    timestamp: c.timestamp,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
  const prog = computeAtrProgression({
    candles: progCandles,
    atrLookback: input.dailyAtrLookback ?? DEFAULT_DAILY_ATR_LOOKBACK,
  });
  const progressionComponent = clamp(prog.reversalProbability * 100, 0, 100);
  const atrProgression =
    prog.daysObserved >= 2
      ? {
          progressionPct: Number(prog.progressionPct.toFixed(2)),
          zone: prog.zone,
          suggestedAction: prog.suggestedAction,
        }
      : null;

  // ── Volume-exhaustion leg (only when volumes are supplied) ──
  let volumeComponent = 0;
  let volumeExhaustion: BlowOffVetoResult["volumeExhaustion"] = null;
  const hasVolume = candles.every((c) => typeof c.volumeUsd === "number");
  if (hasVolume && n >= extensionBars * 2) {
    const recent = candles.slice(n - extensionBars);
    const prior = candles.slice(n - extensionBars * 2, n - extensionBars);
    const meanVol = (xs: ReadonlyArray<BlowOffCandle>) =>
      xs.reduce((s, c) => s + (c.volumeUsd ?? 0), 0) / xs.length;
    const vres = detectVolumeExhaustion({
      strategy: "breakout",
      baselineMeanVolUSD: meanVol(prior),
      currentMeanVolUSD: meanVol(recent),
      postEntryCandles: extensionBars,
      minPostEntryCandles: extensionBars,
    });
    volumeComponent = severityScore(vres.severity);
    volumeExhaustion = {
      applicable: vres.applicable,
      severity: vres.severity,
      dropFraction: vres.dropFraction,
    };
  }

  const extensionComponent = clamp((extensionAtrMultiple / parabolicMult) * 50, 0, 100);

  // Composite: weighted mean of the available legs (volume drops out when
  // no volume was supplied).
  const legs: Array<{ score: number; weight: number }> = [
    { score: extensionComponent, weight: 1.5 },
    { score: progressionComponent, weight: 1.0 },
  ];
  if (volumeExhaustion) legs.push({ score: volumeComponent, weight: 1.0 });
  const totalWeight = legs.reduce((s, l) => s + l.weight, 0);
  const vetoScore = Math.round(legs.reduce((s, l) => s + l.score * l.weight, 0) / totalWeight);

  const components = {
    extension: Math.round(extensionComponent),
    progression: Math.round(progressionComponent),
    volume: Math.round(volumeComponent),
  };

  const base: BlowOffVetoResult = {
    verdict: "allow",
    vetoScore,
    sizeMultiplier: 1,
    blowOffDetected: parabolic,
    blowOffDirection,
    chasing,
    extensionAtrMultiple: Number(extensionAtrMultiple.toFixed(2)),
    directionalAgreement: Number(directionalAgreement.toFixed(2)),
    components,
    atrProgression,
    volumeExhaustion,
    reasoning: "",
  };

  if (!parabolic) {
    return {
      ...base,
      vetoScore: 0,
      reasoning:
        `no parabolic blow-off (${extensionAtrMultiple.toFixed(2)} ATR over ${extensionBars} bars, ` +
        `agreement ${(directionalAgreement * 100).toFixed(0)}%, need >= ${parabolicMult} ATR & ` +
        `${(minAgreement * 100).toFixed(0)}%) — entry allowed`,
    };
  }

  if (!chasing) {
    return {
      ...base,
      vetoScore: 0,
      reasoning:
        `blow-off is ${blowOffDirection} but ${input.side} entry fades it — counter-trend entry allowed`,
    };
  }

  let verdict: BlowOffVerdict;
  let sizeMultiplier: number;
  if (vetoScore >= VETO_THRESHOLD) {
    verdict = "veto";
    sizeMultiplier = 0;
  } else if (vetoScore >= DOWNGRADE_THRESHOLD) {
    verdict = "downgrade";
    sizeMultiplier = 0.5;
  } else {
    verdict = "allow";
    sizeMultiplier = 1;
  }

  const reasoning =
    `${input.side} entry chases a ${blowOffDirection} blow-off ` +
    `(${extensionAtrMultiple.toFixed(2)} ATR over ${extensionBars} bars, ` +
    `agreement ${(directionalAgreement * 100).toFixed(0)}%). ` +
    `veto score ${vetoScore}/100 [ext ${components.extension}, prog ${components.progression}` +
    (volumeExhaustion ? `, vol ${components.volume}` : "") +
    `] -> ${verdict}`;

  return { ...base, verdict, sizeMultiplier, reasoning };
}

export function blowOffVetoToPayload(result: BlowOffVetoResult): Record<string, unknown> {
  return {
    kind: "blow_off_entry_veto.computed",
    verdict: result.verdict,
    vetoScore: result.vetoScore,
    sizeMultiplier: result.sizeMultiplier,
    blowOffDetected: result.blowOffDetected,
    blowOffDirection: result.blowOffDirection,
    chasing: result.chasing,
    extensionAtrMultiple: result.extensionAtrMultiple,
  };
}
