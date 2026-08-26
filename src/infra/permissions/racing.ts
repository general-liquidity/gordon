/**
 * Permission rule fast-path.
 *
 * `quickPermissionCheck` answers "does a permission rule already decide this
 * tool call?" before the approval flow reaches the risk kernel and the
 * dialog. Its production caller is the pending-approval loop in
 * `tui/bridge/runtime.ts`.
 *
 * This module previously also exported `racePermissionDecision`, a Claude
 * Code style race of hook evaluation against the approval dialog. It was
 * removed: no production caller invoked it, and Gordon's approval flow is not
 * shaped like a race — the dialog is rendered from `stillPending` AFTER the
 * kernel loop finishes, so there is no concurrent dialog to cancel. Its
 * removal also drops the `PreToolUse` hook emit, which was unreachable for
 * the same reason. `PreToolUse` is now one of the declared-but-unemitted hook
 * points that `checkHookCoverage` in `infra/diagnostics/gateEnforcement.ts`
 * reports as a doctor finding.
 */

import { evaluateRules, type PermissionRule } from "./rules.ts";

export type PermissionDecision = "allow" | "deny" | "ask";

/**
 * Fast synchronous check: does any rule auto-decide?
 * Returns null if no automatic decision — caller should show UI dialog.
 */
export function quickPermissionCheck(
  rules: PermissionRule[],
  toolName: string,
  toolArgs: unknown,
): { decision: PermissionDecision; reason: string } | null {
  const ruleResult = evaluateRules(rules, { toolName, args: toolArgs });
  if (ruleResult.matchedRule) {
    return {
      decision: ruleResult.behavior,
      reason: ruleResult.reason ?? `Rule ${ruleResult.matchedRule.id}`,
    };
  }
  return null;
}
