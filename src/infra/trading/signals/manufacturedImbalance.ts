/**
 * Manufactured Imbalance Detector (GORDON_MANUFACTURED_IMBALANCE).
 *
 * Flags order book imbalances that build rapidly and then disappear
 * without execution. The L2 signature of directional / layered quote
 * stuffing per Section 4.2-4.3 of the 2026 microstructure piece.
 *
 *   Phase 1: rapid buildup of displayed depth on one side
 *   Phase 2: short-lived imbalance in the book
 *   Phase 3: reaction from other participants
 *   Phase 4: real execution elsewhere or on the opposite side
 *   Phase 5: cancellation of the original displayed interest
 *
 * Detector operates on a sliding window of L2 depth snapshots plus
 * trade prints. Outputs a per-window verdict + a confidence score.
 */

export const MANUFACTURED_IMBALANCE_FLAG_ENV = "GORDON_MANUFACTURED_IMBALANCE";

export function isManufacturedImbalanceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[MANUFACTURED_IMBALANCE_FLAG_ENV] === "1" ||
    env[MANUFACTURED_IMBALANCE_FLAG_ENV] === "true"
  );
}

export interface DepthSnapshot {
  /** Timestamp in ms. */
  t: number;
  /** Aggregated bid size across top-K levels. */
  bidSize: number;
  /** Aggregated ask size across top-K levels. */
  askSize: number;
  /** Optional cumulative executed volume since prior snapshot. */
  executedVolume?: number;
}

export interface ImbalanceWindow {
  snapshots: ReadonlyArray<DepthSnapshot>;
  /** Minimum peak |OBI| to consider "imbalance built up." Default 0.4. */
  peakThreshold?: number;
  /** Fraction of peak |OBI| at end that flags "imbalance vanished." Default 0.25. */
  decayThreshold?: number;
  /** Min volume traded inside window to negate manufactured-flag. Default 0. */
  executionFloor?: number;
}

export type ManufacturedVerdict = "clean" | "suspicious" | "manufactured";

export interface ImbalanceResult {
  verdict: ManufacturedVerdict;
  peakObi: number;
  endObi: number;
  decayRatio: number;
  executedInWindow: number;
  confidence: number;
  reason: string;
}

const DEFAULT_PEAK = 0.4;
const DEFAULT_DECAY = 0.25;

function obi(snap: DepthSnapshot): number {
  const denom = snap.bidSize + snap.askSize;
  return denom === 0 ? 0 : (snap.bidSize - snap.askSize) / denom;
}

export function detectManufacturedImbalance(input: ImbalanceWindow): ImbalanceResult {
  const peakT = input.peakThreshold ?? DEFAULT_PEAK;
  const decayT = input.decayThreshold ?? DEFAULT_DECAY;
  const exFloor = input.executionFloor ?? 0;
  const snaps = input.snapshots;

  if (snaps.length < 3) {
    return {
      verdict: "clean",
      peakObi: 0,
      endObi: 0,
      decayRatio: 0,
      executedInWindow: 0,
      confidence: 0,
      reason: "insufficient snapshots",
    };
  }

  let peakAbs = 0;
  let peakSigned = 0;
  for (const s of snaps) {
    const v = obi(s);
    if (Math.abs(v) > peakAbs) {
      peakAbs = Math.abs(v);
      peakSigned = v;
    }
  }
  const endSigned = obi(snaps[snaps.length - 1]!);
  const decayRatio = peakAbs > 0 ? Math.abs(endSigned) / peakAbs : 1;
  const executed = snaps.reduce((s, x) => s + (x.executedVolume ?? 0), 0);

  let verdict: ManufacturedVerdict = "clean";
  let confidence = 0;
  let reason = "imbalance within normal range";

  if (peakAbs >= peakT && decayRatio <= decayT && executed <= exFloor) {
    verdict = "manufactured";
    confidence = Math.min(1, peakAbs * (1 - decayRatio));
    reason = `OBI peaked at ${peakSigned.toFixed(2)}, decayed to ${endSigned.toFixed(2)} (${(decayRatio * 100).toFixed(0)}%), executions=${executed}`;
  } else if (peakAbs >= peakT && decayRatio <= decayT * 2) {
    verdict = "suspicious";
    confidence = Math.min(0.6, peakAbs * (1 - decayRatio) * 0.5);
    reason = `OBI peaked at ${peakSigned.toFixed(2)} then decayed but executions present`;
  }

  return {
    verdict,
    peakObi: peakSigned,
    endObi: endSigned,
    decayRatio,
    executedInWindow: executed,
    confidence,
    reason,
  };
}

export function imbalanceToPayload(result: ImbalanceResult): Record<string, unknown> {
  return {
    kind: "manufactured_imbalance.evaluated",
    verdict: result.verdict,
    peakObi: Number(result.peakObi.toFixed(3)),
    endObi: Number(result.endObi.toFixed(3)),
    decayRatio: Number(result.decayRatio.toFixed(3)),
    executedInWindow: result.executedInWindow,
    confidence: Number(result.confidence.toFixed(3)),
  };
}
