/**
 * Observational Memory (OM) config builder — opt-in Mastra-native compaction.
 *
 * Mastra 1.23 ships "Observational Memory": a native background 3-tier
 * compaction pipeline — raw messages -> observations (Observer agent) ->
 * reflections (Reflector agent). It runs on token thresholds and is
 * prompt-cache-stable (buffered observations activate in place, so the
 * injected prefix does not churn every turn).
 *
 * This module builds that config. It is wired ONLY when the operator sets
 * `GORDON_OBSERVATIONAL_MEMORY=1`. With the flag unset, `createMemory`
 * omits the `observationalMemory` key entirely, so the native path stays
 * inert and Gordon's hand-rolled 5-stage summarizer + contextCollapse
 * (src/infra/domain/memory/) remain the sole, default compaction path.
 *
 * Note on the two guards that always apply, in BOTH paths:
 *   - `memoryGate` char-cap (MAX_WORKING_MEMORY_CHARS) governs the
 *     always-injected working-memory hot tier. Mastra/OM does not cap
 *     working-memory chars, so the gate stays wrapped regardless of flag.
 *   - The durable WORKING_MEMORY_TEMPLATE hot tier is orthogonal to OM's
 *     observation/reflection tiers; OM compresses conversation history,
 *     not the trader-profile template.
 */

import { Extractor } from "@mastra/memory";
import { z } from "zod";
import type { MastraModelConfig } from "../../runtime/providers/registry.ts";
import { WORKING_MEMORY_LABELS } from "../capabilityTruth.ts";

/** Env flag that activates the native OM path. Default off. */
export const OBSERVATIONAL_MEMORY_FLAG = "GORDON_OBSERVATIONAL_MEMORY";

export function isObservationalMemoryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[OBSERVATIONAL_MEMORY_FLAG] === "1";
}

/**
 * Threshold intent — mapping Gordon's pressure-based 5-stage summarizer
 * (70/80/90/94/99% of the context window) onto OM's absolute-token model.
 *
 * Gordon's summarizer is % of the context window; OM is absolute unobserved
 * tokens. They are not 1:1 (OM has no notion of "% pressure"), so the map is
 * by INTENT, not arithmetic:
 *
 *   Gordon stage (pressure)      -> OM mechanism
 *   ------------------------------------------------------------------
 *   masking/pruning  (70/80%)    -> observation.messageTokens 30k: raw
 *                                   messages are folded into observations
 *                                   once unobserved history crosses 30k.
 *   background buffering          -> observation.bufferTokens 0.2: pre-compute
 *                                   observations every 20% of the threshold so
 *                                   activation is instant (cache-stable).
 *   aggressive/collapse (90/94%) -> reflection.observationTokens 40k:
 *                                   observations are condensed into
 *                                   reflections once they cross 40k.
 *   full summary     (99%)       -> blockAfter 1.2: a synchronous (blocking)
 *                                   observe/reflect is forced at 120% of the
 *                                   threshold as a last resort — the hard
 *                                   "we are out of room, compact now" stage.
 *
 * These match the numbers Gordon already ran inline before OM was gated,
 * so turning the flag on preserves prior OM behavior exactly.
 */
export const OM_THRESHOLDS = {
  observation: {
    messageTokens: 30_000,
    bufferTokens: 0.2,
    bufferActivation: 0.8,
    blockAfter: 1.2,
  },
  reflection: {
    observationTokens: 40_000,
    bufferActivation: 0.5,
    blockAfter: 1.2,
  },
  /**
   * Force-activate buffered observations after this idle gap even if the
   * token threshold was not reached. Flushes cache-specific memory at a
   * natural session-boundary-ish point. Mirrors the summarizer's flush at
   * `/clear` / session close intent.
   */
  activateAfterIdle: "30m",
} as const;

/**
 * Durable trader-profile extractor.
 *
 * The Observer/Reflector see the full conversation; this Extractor pulls
 * the SAME durable fields the WORKING_MEMORY_TEMPLATE holds (risk prefs,
 * venue, account type, market focus) out of that stream and persists them
 * to OM metadata under `extracted.trader-profile`. It is the OM-native
 * analogue of the hot-tier template: durable facts, never session state.
 *
 * @experimental Mastra flags `extract` extractors as experimental (may
 * change in a future release). Keep the schema loose (all-optional) so a
 * shape change in the observer output degrades to partial extraction
 * rather than a hard failure.
 */
export function buildTraderProfileExtractor(): Extractor<Record<string, unknown>> {
  const schema = z
    .object({
      riskTolerance: z
        .string()
        .describe("conservative | moderate | aggressive")
        .optional(),
      maxRiskPerTrade: z
        .string()
        .describe("e.g. 2% — durable stated cap, not a single trade")
        .optional(),
      maxPositionAllocation: z
        .string()
        .describe("max portfolio allocation per position, e.g. 10%")
        .optional(),
      defaultVenue: z
        .string()
        .describe(WORKING_MEMORY_LABELS.defaultVenue)
        .optional(),
      accountType: z
        .string()
        .describe("spot | margin | futures | cash")
        .optional(),
      marketFocus: z
        .string()
        .describe("crypto | stocks | mixed")
        .optional(),
      baseCurrency: z.string().describe("e.g. USD or USDT").optional(),
      preferredTimeframes: z.string().optional(),
    })
    .partial();

  return new Extractor<Record<string, unknown>>({
    name: "trader-profile",
    instructions:
      "Extract ONLY durable trader-profile facts the user has stated or " +
      "confirmed: risk tolerance, max risk per trade, max position allocation, " +
      "default execution venue, account type, primary market focus, base " +
      "currency, preferred timeframes. Do NOT include session state, current " +
      "task, open positions, or transient decisions. Omit any field the user " +
      "has not clearly established. Preserve prior values unless the user " +
      "explicitly changed them.",
    schema,
    metadataKeyPath: "extracted.trader-profile",
  });
}

/**
 * The value spread into `Memory({ options: { observationalMemory } })` when
 * the flag is on. `model` is the caller's fast model (Observer + Reflector
 * both run on it). Scope is `thread` — per-thread observations, matching
 * Gordon's per-session compaction; the durable cross-session tier is the
 * working-memory template, not OM.
 */
export interface BuildObservationalMemoryArgs {
  model: MastraModelConfig;
}

export function buildObservationalMemoryOptions(args: BuildObservationalMemoryArgs) {
  return {
    model: args.model,
    scope: "thread" as const,
    activateAfterIdle: OM_THRESHOLDS.activateAfterIdle,
    observation: {
      messageTokens: OM_THRESHOLDS.observation.messageTokens,
      bufferTokens: OM_THRESHOLDS.observation.bufferTokens,
      bufferActivation: OM_THRESHOLDS.observation.bufferActivation,
      blockAfter: OM_THRESHOLDS.observation.blockAfter,
      extract: [buildTraderProfileExtractor()],
    },
    reflection: {
      observationTokens: OM_THRESHOLDS.reflection.observationTokens,
      bufferActivation: OM_THRESHOLDS.reflection.bufferActivation,
      blockAfter: OM_THRESHOLDS.reflection.blockAfter,
    },
  };
}
