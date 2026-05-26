/**
 * Golden scenarios — version-controlled, hand-curated.
 *
 * Initial set is small (3 scenarios). Grow this list as production
 * traces surface failure modes worth regression-protecting. Per the
 * eval-discipline guidance: "the first fifty examples can be hand-
 * labeled in an afternoon, there is no excuse." We're at three.
 *
 * To add a scenario:
 *   1. Create a new file alongside this one (kebab-case-id.ts)
 *   2. Export a const of type `EvalScenario` with id, tags, systemPrompt, userInput, notes
 *   3. Re-export from this barrel
 *   4. Add the id to ALL_SCENARIO_IDS for the runner
 */

import { planCardBtc } from "./plan-card-btc.ts";
import { regimeFlip } from "./regime-flip.ts";
import { riskGate } from "./risk-gate.ts";
import { aceRecall } from "./ace-recall.ts";
import { adversarialCredentialLeak } from "./adversarial-credential-leak.ts";
import { adversarialPermissionBypass } from "./adversarial-permission-bypass.ts";
import { adversarialDenylistCircumvention } from "./adversarial-denylist-circumvention.ts";
import { adversarialCrossAgentBoundary } from "./adversarial-cross-agent-boundary.ts";
import { adversarialInjectionResilience } from "./adversarial-injection-resilience.ts";
// Primitives shipped in the meta-tools-v4 session — verify tool routing,
// provenance, replay fidelity. Added together so the harness has
// coverage for the void-replay + provenance work that landed without
// scenarios.
import { synthesisManifestCapture } from "./synthesis-manifest-capture.ts";
import { trimCoach } from "./trim-coach.ts";
import { reluctanceFlag } from "./reluctance-flag.ts";
import { dcfUsage } from "./dcf-usage.ts";
import { asofReplay } from "./asof-replay.ts";
import { memoRender } from "./memo-render.ts";
import type { EvalScenario } from "../types.ts";

export {
  planCardBtc,
  regimeFlip,
  riskGate,
  aceRecall,
  adversarialCredentialLeak,
  adversarialPermissionBypass,
  adversarialDenylistCircumvention,
  adversarialCrossAgentBoundary,
  adversarialInjectionResilience,
  synthesisManifestCapture,
  trimCoach,
  reluctanceFlag,
  dcfUsage,
  asofReplay,
  memoRender,
};

export const ALL_SCENARIOS: ReadonlyArray<EvalScenario> = [
  planCardBtc,
  regimeFlip,
  riskGate,
  aceRecall,
  // Adversarial security scenarios (5 axes: credential-leak,
  // permission-bypass, denylist-circumvention, cross-agent-boundary,
  // injection-resilience). Designed in project_queued_adversarial_security_evals.md.
  adversarialCredentialLeak,
  adversarialPermissionBypass,
  adversarialDenylistCircumvention,
  adversarialCrossAgentBoundary,
  adversarialInjectionResilience,
  // Session primitives — synthesis-manifest, trim-coach, reluctance-
  // flag, dcf-usage, asof-replay, memo-render. Test that Gordon
  // chooses the right tool variant + handles missing data honestly.
  synthesisManifestCapture,
  trimCoach,
  reluctanceFlag,
  dcfUsage,
  asofReplay,
  memoRender,
];

/** Adversarial scenarios as a filtered set (security regression gating). */
export const ADVERSARIAL_SCENARIOS: ReadonlyArray<EvalScenario> = [
  adversarialCredentialLeak,
  adversarialPermissionBypass,
  adversarialDenylistCircumvention,
  adversarialCrossAgentBoundary,
  adversarialInjectionResilience,
];

export const ALL_SCENARIO_IDS: ReadonlyArray<string> = ALL_SCENARIOS.map(
  (s) => s.id,
);

/** Filter scenarios by tag. */
export function scenariosByTag(tag: string): ReadonlyArray<EvalScenario> {
  return ALL_SCENARIOS.filter((s) => s.tags.includes(tag));
}

/** Look up a scenario by id. */
export function getScenarioById(id: string): EvalScenario | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}
