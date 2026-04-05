/**
 * Temporal Decay Scoring
 *
 * Older memories get their relevance score multiplied by an exponential
 * decay factor. Recent trades/reflections rank higher than stale ones.
 *
 * Half-life: default 30 days (a score halves every 30 days).
 *
 * "Evergreen" memory entries (durable user facts, strategy rules, risk
 * preferences) are exempt from decay — they stay relevant indefinitely.
 */

export interface TemporalDecayConfig {
  enabled: boolean;
  halfLifeDays: number;
}

export const DEFAULT_TEMPORAL_DECAY: TemporalDecayConfig = {
  enabled: true,
  halfLifeDays: 30,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function toDecayLambda(halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 0;
  return Math.LN2 / halfLifeDays;
}

export function decayMultiplier(ageInDays: number, halfLifeDays: number): number {
  const lambda = toDecayLambda(halfLifeDays);
  const age = Math.max(0, ageInDays);
  if (lambda <= 0 || !Number.isFinite(age)) return 1;
  return Math.exp(-lambda * age);
}

export interface DecayableItem {
  score: number;
  /** Unix ms timestamp, or null if the entry is evergreen (no decay). */
  timestamp: number | null;
}

export function applyTemporalDecay<T extends DecayableItem>(
  items: T[],
  config: TemporalDecayConfig = DEFAULT_TEMPORAL_DECAY,
  nowMs: number = Date.now(),
): T[] {
  if (!config.enabled) return items;
  return items.map((item) => {
    if (item.timestamp == null) return item;
    const ageDays = (nowMs - item.timestamp) / DAY_MS;
    const mult = decayMultiplier(ageDays, config.halfLifeDays);
    return { ...item, score: item.score * mult };
  });
}
