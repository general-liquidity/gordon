/**
 * FW3 — Harness Profile Registry (Deep Agents parity).
 *
 * Per-provider SUFFIX content for the slot-aware prompt composer. The
 * SUFFIX slot is appended last to every agent's instructions and carries
 * model-specific tuning (e.g. extended-thinking encouragement for
 * Claude, tool-schema reminders for OpenAI, citation hints for Gemini).
 *
 * Operator-authored, not vendored. Each built-in profile ships with an
 * EMPTY suffix string by default — Gordon does not opinionate on
 * provider-specific tuning out of the box. Operators populate the SUFFIX
 * via env vars:
 *
 *   GORDON_HARNESS_ANTHROPIC_SUFFIX
 *   GORDON_HARNESS_OPENAI_SUFFIX
 *   GORDON_HARNESS_GOOGLE_SUFFIX
 *   GORDON_HARNESS_XAI_SUFFIX
 *
 * Why operator-authored: every team's per-model tuning differs (latency
 * profile, response-shape preferences, regulatory hints). Shipping
 * defaults would inject opinionated text into a global cache key and
 * invalidate eval-harness baselines for downstream forks. Operators who
 * want tuning author it explicitly; operators who don't get behavior-
 * identical output (empty SUFFIX is a no-op in the composer).
 *
 * Resolver:
 *   resolveHarnessProfile(modelConfig) → HarnessProfile | undefined
 *
 *   - Inspects the provider portion of the resolved MastraModelConfig.
 *   - Returns a profile by exact provider match or first-matching
 *     prefix from `matchers`.
 *   - Returns undefined when no matcher fires; callers should treat this
 *     as "no suffix" (composer emits empty SUFFIX, which it already
 *     handles as a no-op).
 */

import type { MastraModelConfig } from "../../runtime/providers/registry.ts";

export type HarnessProvider = "anthropic" | "openai" | "google" | "xai";

export interface HarnessProfile {
  /** Canonical provider id. */
  provider: HarnessProvider;
  /**
   * Lowercase prefix tokens compared against the resolved provider
   * string. First match wins; ordering matters when prefixes overlap.
   */
  matchers: readonly string[];
  /**
   * Suffix content appended to the agent's instructions. Empty string
   * is a no-op (composer drops empty/whitespace SUFFIX slots).
   */
  suffix: string;
  /** Env var read at resolve time to override `suffix`. */
  envOverride: string;
}

const EMPTY_SUFFIX = "";

const ANTHROPIC_PROFILE: HarnessProfile = {
  provider: "anthropic",
  matchers: ["anthropic", "claude"],
  suffix: EMPTY_SUFFIX,
  envOverride: "GORDON_HARNESS_ANTHROPIC_SUFFIX",
};

const OPENAI_PROFILE: HarnessProfile = {
  provider: "openai",
  matchers: ["openai", "gpt"],
  suffix: EMPTY_SUFFIX,
  envOverride: "GORDON_HARNESS_OPENAI_SUFFIX",
};

const GOOGLE_PROFILE: HarnessProfile = {
  provider: "google",
  matchers: ["google", "gemini", "vertex"],
  suffix: EMPTY_SUFFIX,
  envOverride: "GORDON_HARNESS_GOOGLE_SUFFIX",
};

const XAI_PROFILE: HarnessProfile = {
  provider: "xai",
  matchers: ["xai", "grok"],
  suffix: EMPTY_SUFFIX,
  envOverride: "GORDON_HARNESS_XAI_SUFFIX",
};

export const DEFAULT_HARNESS_PROFILES: ReadonlyArray<HarnessProfile> = [
  ANTHROPIC_PROFILE,
  GOOGLE_PROFILE,
  OPENAI_PROFILE,
  XAI_PROFILE,
];

function readEnvOverride(profile: HarnessProfile, env: NodeJS.ProcessEnv): string {
  const raw = env[profile.envOverride];
  if (typeof raw !== "string") return profile.suffix;
  return raw;
}

function extractProviderString(modelConfig: MastraModelConfig | undefined): string {
  if (!modelConfig) return "";
  if (typeof modelConfig === "string") return modelConfig.toLowerCase();
  const candidates: Array<unknown> = [
    (modelConfig as Record<string, unknown>).provider,
    (modelConfig as Record<string, unknown>).providerId,
    (modelConfig as Record<string, unknown>).id,
    (modelConfig as Record<string, unknown>).modelId,
    (modelConfig as Record<string, unknown>).model,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c.toLowerCase();
  }
  return "";
}

/**
 * Resolve the harness profile that matches a model config. Returns
 * undefined when no matcher fires.
 *
 * @param modelConfig Resolved MastraModelConfig (output of resolveRuntimeModel).
 * @param profiles    Optional registry override (defaults to DEFAULT_HARNESS_PROFILES).
 */
export function resolveHarnessProfile(
  modelConfig: MastraModelConfig | undefined,
  profiles: ReadonlyArray<HarnessProfile> = DEFAULT_HARNESS_PROFILES,
): HarnessProfile | undefined {
  const providerStr = extractProviderString(modelConfig);
  if (providerStr.length === 0) return undefined;
  for (const profile of profiles) {
    for (const matcher of profile.matchers) {
      if (providerStr.includes(matcher)) return profile;
    }
  }
  return undefined;
}

/**
 * Convenience: resolve the SUFFIX string for a model config. Returns
 * empty string when no profile matches OR the matched profile has no
 * suffix configured (vanilla default + no env override).
 *
 * Reads env at call time so operators can set GORDON_HARNESS_*_SUFFIX
 * after process start without re-importing.
 */
export function getHarnessSuffixForModel(
  modelConfig: MastraModelConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  profiles: ReadonlyArray<HarnessProfile> = DEFAULT_HARNESS_PROFILES,
): string {
  const profile = resolveHarnessProfile(modelConfig, profiles);
  if (!profile) return "";
  return readEnvOverride(profile, env);
}

/**
 * Gate flag — `GORDON_HARNESS_PROFILES=1` activates resolver use in
 * agent definitions. When off, callers should pass `suffix: ""` (or
 * omit the slot) so behavior remains identical to pre-FW3.
 *
 * The resolver itself is pure and side-effect-free; the flag exists to
 * keep the wiring gated until operators populate suffix content. With
 * the flag on but no env overrides set, behavior is also identical
 * (resolver returns empty string).
 */
export function isHarnessProfilesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.GORDON_HARNESS_PROFILES;
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * One-line summary for operator-facing logs.
 */
export function summarizeHarnessProfile(profile: HarnessProfile | undefined): string {
  if (!profile) return "no harness profile matched";
  const hasOverride = readEnvOverride(profile, process.env).length > 0;
  return `harness profile=${profile.provider}, suffix=${hasOverride ? "configured" : "empty"}`;
}
