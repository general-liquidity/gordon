/**
 * MEV Detection — Sandwich / Frontrun / Spoofing (GORDON_MEV_DETECTION).
 *
 * Three crypto-specific microstructure detectors that complement Gordon's
 * existing `microstructureToxicity` and `crossVenueDivergence` signals:
 *
 *   - Sandwich: buy-side trade immediately before a large victim buy,
 *     followed by a sell-side trade within `windowMs` of the victim,
 *     with a meaningful price impact on the round trip.
 *   - Frontrun: a small same-side trade fires within `windowMs` before
 *     a much larger same-side trade — classic "I saw the order coming
 *     and got in front of it" pattern.
 *   - Spoof-cancel: large displayed size at a level disappears (cancel,
 *     not fill) very shortly after appearing, repeatedly.
 *
 * Designed to slot next to `microstructureToxicity.ts` and feed its
 * composite roll-up. Pure compute over trade/orderbook event arrays.
 *
 * Pure compute. No I/O.
 */

export const MEV_DETECTION_FLAG_ENV = "GORDON_MEV_DETECTION";

export function isMevDetectionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[MEV_DETECTION_FLAG_ENV] === "1" || env[MEV_DETECTION_FLAG_ENV] === "true";
}

export type MevSide = "buy" | "sell";

export interface MevTrade {
  /** Epoch milliseconds. */
  timestamp: number;
  side: MevSide;
  price: number;
  size: number;
}

export interface MevSpoofEvent {
  appearedAt: number;
  disappearedAt: number;
  size: number;
  /** Whether the level was filled (false → spoof-cancel candidate). */
  filled: boolean;
}

export interface MevDetectionInput {
  trades: ReadonlyArray<MevTrade>;
  spoofEvents?: ReadonlyArray<MevSpoofEvent>;
  /** Sandwich/frontrun temporal window in ms. Default 5000. */
  windowMs?: number;
  /** A "large" trade is ≥ largeMultiplier × median trade size in the input. Default 4. */
  largeMultiplier?: number;
  /** Sandwich requires round-trip price move ≥ minImpactBps. Default 5 bps. */
  minImpactBps?: number;
  /** Spoof lifetime ≤ spoofMaxLifeMs and unfilled. Default 1500 ms. */
  spoofMaxLifeMs?: number;
}

export type MevEventKind = "sandwich" | "frontrun" | "spoof_cancel";

export interface MevEvent {
  kind: MevEventKind;
  /** Centroid timestamp of the event. */
  timestamp: number;
  /** Size of the victim / large trade for sandwich+frontrun; cancelled size for spoof. */
  victimSize: number;
  /** 0–1 severity score. Higher = more confident. */
  severity: number;
  /** Free-form reason for the audit log. */
  reasoning: string;
}

export interface MevDetectionResult {
  events: MevEvent[];
  sandwichCount: number;
  frontrunCount: number;
  spoofCount: number;
  /** Aggregate toxicity score 0–1 — fraction of suspicious activity. */
  toxicityScore: number;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_WINDOW_MS = 5_000;
const DEFAULT_LARGE_MULT = 4;
const DEFAULT_MIN_IMPACT_BPS = 5;
const DEFAULT_SPOOF_MAX_LIFE_MS = 1_500;

function leaveOneOutMean(sizes: ReadonlyArray<number>, excludeIdx: number): number {
  if (sizes.length <= 1) return 0;
  let sum = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (i !== excludeIdx) sum += sizes[i]!;
  }
  return sum / (sizes.length - 1);
}

function detectSandwichesAndFrontruns(
  trades: ReadonlyArray<MevTrade>,
  windowMs: number,
  largeMult: number,
  minImpactBps: number,
): { sandwiches: MevEvent[]; frontruns: MevEvent[] } {
  const sandwiches: MevEvent[] = [];
  const frontruns: MevEvent[] = [];
  if (trades.length < 2) return { sandwiches, frontruns };

  // Stable order by timestamp (input may or may not be sorted).
  const ordered = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const sizes = ordered.map((t) => t.size);

  for (let i = 0; i < ordered.length; i++) {
    const victim = ordered[i]!;
    // "Large" is computed leave-one-out so a single dominant trade isn't
    // its own baseline (which would happen with raw median when N is small).
    const baseline = leaveOneOutMean(sizes, i);
    if (baseline <= 0) continue;
    const largeThreshold = baseline * largeMult;
    if (victim.size < largeThreshold) continue;

    // Sandwich attack on a buy victim:
    //   attacker BUY (front)  →  victim BUY  →  attacker SELL (back, profit-taking)
    // Generally: predecessor SAME side as victim, successor OPPOSITE.
    for (let j = i - 1; j >= 0; j--) {
      const pred = ordered[j]!;
      if (victim.timestamp - pred.timestamp > windowMs) break;
      if (pred.side !== victim.side) continue;
      if (pred.size >= victim.size) continue; // pred should be the smaller attacker leg
      for (let k = i + 1; k < ordered.length; k++) {
        const succ = ordered[k]!;
        if (succ.timestamp - victim.timestamp > windowMs) break;
        if (succ.side === victim.side) continue;
        // Round-trip impact in bps relative to the predecessor price.
        const roundTripBps = Math.abs((succ.price - pred.price) / pred.price) * 10_000;
        if (roundTripBps < minImpactBps) continue;
        const severity = Math.min(
          1,
          (victim.size / largeThreshold) * 0.5 + (roundTripBps / (minImpactBps * 4)) * 0.5,
        );
        sandwiches.push({
          kind: "sandwich",
          timestamp: victim.timestamp,
          victimSize: victim.size,
          severity,
          reasoning:
            `victim ${victim.side} ${victim.size.toFixed(4)}@${victim.price.toFixed(6)}; ` +
            `pred ${pred.side}@${pred.price.toFixed(6)} (${(victim.timestamp - pred.timestamp)}ms before); ` +
            `succ ${succ.side}@${succ.price.toFixed(6)} (${(succ.timestamp - victim.timestamp)}ms after); ` +
            `round-trip ${roundTripBps.toFixed(2)} bps`,
        });
        break;
      }
    }

    // Frontrun: small same-side trade just before victim (no closing leg required).
    for (let j = i - 1; j >= 0; j--) {
      const pred = ordered[j]!;
      if (victim.timestamp - pred.timestamp > windowMs) break;
      if (pred.side !== victim.side) continue;
      if (pred.size >= largeThreshold) continue;
      const sizeRatio = pred.size / victim.size;
      if (sizeRatio > 0.5) continue;
      const severity = Math.min(
        1,
        (victim.size / largeThreshold) * 0.6 + (1 - sizeRatio) * 0.4,
      );
      frontruns.push({
        kind: "frontrun",
        timestamp: victim.timestamp,
        victimSize: victim.size,
        severity,
        reasoning:
          `victim ${victim.side} ${victim.size.toFixed(4)}; ` +
          `pred ${pred.side} ${pred.size.toFixed(4)} (${(victim.timestamp - pred.timestamp)}ms before); ` +
          `size ratio ${sizeRatio.toFixed(3)}`,
      });
      break;
    }
  }

  return { sandwiches, frontruns };
}

function detectSpoofs(
  spoofEvents: ReadonlyArray<MevSpoofEvent>,
  maxLifeMs: number,
): MevEvent[] {
  const out: MevEvent[] = [];
  for (const ev of spoofEvents) {
    if (ev.filled) continue;
    const life = ev.disappearedAt - ev.appearedAt;
    if (life < 0 || life > maxLifeMs) continue;
    const severity = Math.min(1, 1 - life / maxLifeMs);
    out.push({
      kind: "spoof_cancel",
      timestamp: ev.disappearedAt,
      victimSize: ev.size,
      severity,
      reasoning: `level size ${ev.size.toFixed(4)} appeared then cancelled ${life}ms later (≤${maxLifeMs}ms)`,
    });
  }
  return out;
}

export function detectMev(input: MevDetectionInput): MevDetectionResult {
  const trades = input.trades ?? [];
  const spoofEvents = input.spoofEvents ?? [];
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
  const largeMult = input.largeMultiplier ?? DEFAULT_LARGE_MULT;
  const minImpactBps = input.minImpactBps ?? DEFAULT_MIN_IMPACT_BPS;
  const spoofMaxLife = input.spoofMaxLifeMs ?? DEFAULT_SPOOF_MAX_LIFE_MS;

  const { sandwiches, frontruns } = detectSandwichesAndFrontruns(
    trades,
    windowMs,
    largeMult,
    minImpactBps,
  );
  const spoofs = detectSpoofs(spoofEvents, spoofMaxLife);
  const events: MevEvent[] = [...sandwiches, ...frontruns, ...spoofs].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  const total = trades.length + spoofEvents.length;
  const flagged = events.length;
  const toxicityScore = total > 0 ? Math.min(1, flagged / total) : 0;

  const reasoning =
    `${sandwiches.length} sandwich, ${frontruns.length} frontrun, ${spoofs.length} spoof-cancel events ` +
    `over ${trades.length} trades + ${spoofEvents.length} L2 events; ` +
    `toxicity=${(toxicityScore * 100).toFixed(1)}%`;

  return {
    events,
    sandwichCount: sandwiches.length,
    frontrunCount: frontruns.length,
    spoofCount: spoofs.length,
    toxicityScore,
    sampleSize: total,
    reasoning,
  };
}

export function mevDetectionToPayload(result: MevDetectionResult): Record<string, unknown> {
  return {
    kind: "mev_detection.computed",
    sandwichCount: result.sandwichCount,
    frontrunCount: result.frontrunCount,
    spoofCount: result.spoofCount,
    toxicityScore: Number(result.toxicityScore.toFixed(4)),
    sampleSize: result.sampleSize,
  };
}
