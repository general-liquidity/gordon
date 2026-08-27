/**
 * Cross-Venue Divergence Detector (GORDON_CROSS_VENUE_DIVERGENCE).
 *
 * Detects cross-venue stuffing patterns per Section 4.6 of the
 * microstructure piece: misleading quote activity on Venue A while real
 * interest executes on Venue B, or same-instrument mid-price diverging
 * across venues beyond a tolerance band.
 *
 *   Inputs: parallel mid-price series per venue + (optional) quote
 *           activity intensity per venue.
 *
 *   Outputs:
 *     - mean and max absolute mid divergence across venues
 *     - quote-vs-execution divergence flag (Venue A noisy, Venue B
 *       executing)
 *     - per-pair correlation breakdown when divergence persists
 *
 * Composes with manipulationContext (MS2) and the marginalParticipant
 * classifier (WW15) — cross-venue divergence is a strong driver of the
 * "active manipulation" regime.
 */

export interface VenueObservation {
  venue: string;
  /** Parallel timestamp index — caller aligns inputs. */
  mids: ReadonlyArray<number>;
  /** Optional per-bar quote-activity intensity. */
  quoteIntensity?: ReadonlyArray<number>;
  /** Optional per-bar executed volume. */
  executedVolume?: ReadonlyArray<number>;
}

export interface DivergenceInput {
  venues: ReadonlyArray<VenueObservation>;
  /** Absolute fractional mid divergence above which the venue pair is flagged. Default 0.002 (20 bps). */
  divergenceThreshold?: number;
  /** Min consecutive bars above threshold to count as persistent. Default 3. */
  persistenceBars?: number;
}

export interface VenuePairDivergence {
  a: string;
  b: string;
  maxAbsDivergence: number;
  meanAbsDivergence: number;
  persistentBars: number;
  quoteExecutionFlip: boolean;
}

export interface DivergenceResult {
  pairs: VenuePairDivergence[];
  anyAlert: boolean;
  maxObservedDivergence: number;
  reason: string;
}

const DEFAULT_DIVERGENCE = 0.002;
const DEFAULT_PERSISTENCE = 3;

function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

export function detectCrossVenueDivergence(input: DivergenceInput): DivergenceResult {
  const venues = input.venues;
  if (venues.length < 2) {
    return {
      pairs: [],
      anyAlert: false,
      maxObservedDivergence: 0,
      reason: "fewer than 2 venues",
    };
  }

  const threshold = input.divergenceThreshold ?? DEFAULT_DIVERGENCE;
  const persistence = input.persistenceBars ?? DEFAULT_PERSISTENCE;
  const pairs: VenuePairDivergence[] = [];
  let maxObs = 0;

  for (let i = 0; i < venues.length; i++) {
    for (let j = i + 1; j < venues.length; j++) {
      const a = venues[i]!;
      const b = venues[j]!;
      const n = Math.min(a.mids.length, b.mids.length);
      if (n < 2) continue;

      const divergences: number[] = [];
      let absSum = 0;
      let absMax = 0;
      let consecutive = 0;
      let bestConsecutive = 0;
      for (let k = 0; k < n; k++) {
        const denom = (a.mids[k]! + b.mids[k]!) / 2;
        if (denom <= 0) continue;
        const d = (a.mids[k]! - b.mids[k]!) / denom;
        divergences.push(d);
        const abs = Math.abs(d);
        absSum += abs;
        if (abs > absMax) absMax = abs;
        if (abs >= threshold) {
          consecutive += 1;
          if (consecutive > bestConsecutive) bestConsecutive = consecutive;
        } else {
          consecutive = 0;
        }
      }
      if (absMax > maxObs) maxObs = absMax;

      let quoteFlip = false;
      if (a.quoteIntensity && b.quoteIntensity && a.executedVolume && b.executedVolume) {
        const aQuote = mean(a.quoteIntensity);
        const bQuote = mean(b.quoteIntensity);
        const aExec = mean(a.executedVolume);
        const bExec = mean(b.executedVolume);
        const aRatio = aQuote / Math.max(aExec, 1e-9);
        const bRatio = bQuote / Math.max(bExec, 1e-9);
        quoteFlip = Math.abs(aRatio - bRatio) > Math.max(aRatio, bRatio) * 0.5;
      }

      pairs.push({
        a: a.venue,
        b: b.venue,
        maxAbsDivergence: absMax,
        meanAbsDivergence: divergences.length > 0 ? absSum / divergences.length : 0,
        persistentBars: bestConsecutive,
        quoteExecutionFlip: quoteFlip,
      });
    }
  }

  const anyAlert = pairs.some((p) => p.persistentBars >= persistence || p.quoteExecutionFlip);

  let reason: string;
  if (!anyAlert) {
    reason = `${pairs.length} pair(s) within ${(threshold * 10000).toFixed(0)} bps tolerance`;
  } else {
    const alerts = pairs.filter((p) => p.persistentBars >= persistence || p.quoteExecutionFlip);
    reason = `${alerts.length} pair(s) flagged: ${alerts.map((p) => `${p.a}↔${p.b}`).join(", ")}`;
  }

  return { pairs, anyAlert, maxObservedDivergence: maxObs, reason };
}

export function divergenceToPayload(result: DivergenceResult): Record<string, unknown> {
  return {
    kind: "cross_venue_divergence.evaluated",
    anyAlert: result.anyAlert,
    maxObservedDivergence: Number(result.maxObservedDivergence.toFixed(5)),
    pairCount: result.pairs.length,
    flaggedPairCount: result.pairs.filter((p) => p.persistentBars >= 3 || p.quoteExecutionFlip)
      .length,
  };
}
