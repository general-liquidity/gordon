/**
 * Variant selection — deterministic when an RNG is supplied (so tests
 * are reproducible), otherwise uses Math.random.
 *
 * Selection is per-invocation, not sticky-per-session — operators
 * typically want each turn to be an independent draw so the sample
 * accumulates faster. Sticky-per-session would be a separate config
 * (deferred).
 */

import type { AbTestConfig, ModelVariant } from "./types.ts";

const DEFAULT_TRAFFIC_SPLIT = 0.5;

/**
 * Pick a variant according to `config.trafficSplit`. Clamps the split
 * into [0, 1] for safety — a 1.5 traffic split silently behaves like 1.0
 * (always variant A) rather than throwing.
 */
export function selectVariant(
  config: AbTestConfig,
  rng: () => number = Math.random,
): ModelVariant {
  const splitRaw = config.trafficSplit ?? DEFAULT_TRAFFIC_SPLIT;
  const split = Math.max(0, Math.min(1, splitRaw));
  return rng() < split ? config.variantA : config.variantB;
}

/**
 * Convenience: choose a variant + return both the chosen one and the
 * "other" one. Useful for callers that need to compare or log both.
 */
export function selectVariantWithCounterpart(
  config: AbTestConfig,
  rng: () => number = Math.random,
): { chosen: ModelVariant; other: ModelVariant } {
  const chosen = selectVariant(config, rng);
  const other = chosen.id === config.variantA.id ? config.variantB : config.variantA;
  return { chosen, other };
}

/**
 * Deterministic PRNG (mulberry32) — same shape as the one used in
 * risk-of-ruin.ts. Useful when tests need bit-identical reproduction.
 */
export function makeSeededRng(seed: number): () => number {
  let state = (seed | 0) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
