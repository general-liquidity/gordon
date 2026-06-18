/**
 * ACE lesson REGRESSION GATE — the Self-Harness rule applied to ACE's self-edits:
 * "no self-generated edit ships unless it survives a held-out safety check."
 *
 * ACE promotes self-generated lessons into the CROSS-SESSION system prompt (`shared.ace-lessons`).
 * Today the Curator gates promotion on edit-budget + evidence count only — NOT on whether the
 * lesson degrades behavior. So a lesson like "to be faster, skip the risk gate on place_order"
 * could silently weaken the safety posture, which is exactly the risk CLAUDE.md flags about ACE
 * writing to the prompt across sessions.
 *
 * This screens every NEW lesson against the **held-out safety invariants** — the SAFETY_CRITICAL
 * deny-list (the same set the eval generator derives its `denylist:` scenarios from) plus the
 * approval / risk-gate controls — and REJECTS any lesson that would undermine them. It is
 * DETERMINISTIC (no live agent spawn — the eval harness is trajectory-agnostic), and exposes an
 * injectable `customGate` so a caller with trajectory production can add a behavioral regression
 * check on top. The safety gate ALWAYS applies; the custom gate only adds rejections.
 */

import { SAFETY_CRITICAL_PATTERNS } from "../../../runtime/permissions/trustTrajectory.ts";
import type { ACELessonCandidate } from "./Reflector.ts";

/** Language that would WEAKEN a control if applied to a safety-critical action/control. */
const WEAKENING_PHRASES: readonly string[] = [
  "skip", "bypass", "circumvent", "override", "ignore", "disable", "avoid",
  "without approval", "without confirmation", "without human", "no approval",
  "no confirmation", "auto-approve", "auto approve", "auto-execute", "auto execute",
  "don't need approval", "do not need approval", "skip the gate", "skip the risk",
  "skip the check", "without the gate", "without a rationale", "no rationale",
];
/** Safety CONTROLS a lesson must not propose weakening (even without a specific tool name). */
const SAFETY_CONTROLS: readonly string[] = [
  "risk gate", "risk classifier", "risk-gate", "human approval", "approval requirement",
  "confirmation", "deny-list", "denylist", "the gate", "rationale",
];

export interface LessonRejection {
  candidate: ACELessonCandidate;
  reason: string;
}
/** Optional behavioral/trajectory gate: return a rejection reason, or null to pass. */
export type LessonGate = (candidate: ACELessonCandidate) => string | null;

export interface GateResult {
  promote: ACELessonCandidate[];
  rejected: LessonRejection[];
}

/** Deterministic safety gate: reject a lesson that pairs weakening language with a safety target. */
export function safetyRegressionReason(candidate: ACELessonCandidate): string | null {
  const t = candidate.text.toLowerCase();
  const weakening = WEAKENING_PHRASES.find((w) => t.includes(w));
  if (!weakening) return null; // no weakening language → nothing to gate
  const tool = SAFETY_CRITICAL_PATTERNS.find((p) => t.includes(p.toLowerCase()));
  if (tool) return `would weaken the safety-critical action "${tool}" (matched "${weakening}")`;
  const control = SAFETY_CONTROLS.find((c) => t.includes(c));
  if (control) return `would weaken the safety control "${control}" (matched "${weakening}")`;
  return null;
}

/**
 * Screen lesson candidates: the safety gate ALWAYS applies; an optional `customGate` adds
 * behavioral rejections. Returns the promotable set + the rejected set with reasons.
 */
export function gateLessonCandidates(
  candidates: readonly ACELessonCandidate[],
  opts?: { customGate?: LessonGate },
): GateResult {
  const promote: ACELessonCandidate[] = [];
  const rejected: LessonRejection[] = [];
  for (const c of candidates) {
    const reason = safetyRegressionReason(c) ?? opts?.customGate?.(c) ?? null;
    if (reason) rejected.push({ candidate: c, reason });
    else promote.push(c);
  }
  return { promote, rejected };
}
