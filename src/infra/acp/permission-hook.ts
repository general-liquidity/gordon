/**
 * ACP permission hook — bridges Gordon's PermissionEngine to the editor.
 *
 * Wires the `requestAcpPermission` helper into Gordon's permission flow
 * via `PermissionEngine.prependHook` so tool calls that Gordon would
 * normally route to the runtime approval queue instead surface as
 * interactive ACP prompts in the editor.
 *
 * Lifecycle:
 *
 *   1. ACP server's prompt handler calls `installAcpPermissionHook` at
 *      turn entry with the current sessionId + connection.
 *   2. The hook checks each tool-evaluation request: if it would
 *      otherwise need human approval (the default classifier returned
 *      "pending"), the hook emits an ACP request_permission instead.
 *   3. Editor returns the operator's verdict (approve / reject / cancel).
 *   4. Hook maps to PermissionHookDecision { decision: "allow" | "deny" }.
 *   5. When persist=true (allow_always / reject_always), the trust
 *      trajectory records the decision so subsequent calls short-circuit.
 *   6. Handler's `finally` block calls the returned uninstall fn.
 *
 * Safety-critical tools (place_order, execute_plan, withdraw, etc.)
 * are NOT bridged — they always go through Gordon's hard deny-list and
 * never short-circuit via ACP. Per `[[goal-blast-radius-framing]]`,
 * editor-side approval is too thin a gate for catastrophic operations.
 */

import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { PermissionEngine } from "../../runtime/permissions/PermissionEngine.ts";
import { isSafetyCritical, getDefaultTrustTrajectory } from "../../runtime/permissions/trustTrajectory.ts";
import { requestAcpPermission } from "./permission-bridge.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("acp-permission-hook");

interface InstallOptions {
  sessionId: string;
  connection: AgentSideConnection;
}

/**
 * Install the ACP permission resolver onto Gordon's PermissionEngine.
 *
 * Returns an uninstaller function. Always call the uninstaller in the
 * prompt handler's `finally` block so the hook doesn't leak across
 * sessions.
 *
 * The hook runs BEFORE all other hooks (prependHook). When it matches
 * (non-safety-critical tool, evaluation is currently "pending"), it
 * emits an ACP request_permission and returns the operator's verdict.
 * When it doesn't match (safety-critical, or no pending state), it
 * returns `{ decision: "abstain" }` and the default classifier runs.
 */
export function installAcpPermissionHook(
  engine: PermissionEngine,
  options: InstallOptions,
): () => void {
  const trajectory = getDefaultTrustTrajectory();

  const uninstall = engine.prependHook(async ({ toolName, policy }) => {
    const permissionScope = policy.tool.permissionScope;

    // Safety-critical bypass — editor approval is too thin for these.
    if (isSafetyCritical(toolName)) {
      return { decision: "abstain" };
    }

    const score = trajectory.scoreFor(toolName, permissionScope);
    if (score.eligible && policy.approvalClass !== "always_require_human") {
      return {
        decision: "allow",
        actor: "classifier:trust-trajectory",
        reason: `${score.approvals} prior scoped ACP approvals (score ${score.score.toFixed(2)})`,
      };
    }

    if (
      policy.approvalClass === "none" ||
      (
        policy.tool.sideEffectLevel === "read" &&
        policy.tool.riskClass === "low" &&
        policy.approvalClass !== "always_require_human"
      )
    ) {
      return { decision: "abstain" };
    }

    // Generate a per-prompt toolCallId so the editor can pair the
    // permission UI with the right tool-call card.
    const toolCallId = `acp_perm_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

    try {
      const verdict = await requestAcpPermission(options.connection, {
        sessionId: options.sessionId,
        toolName,
        toolCallId,
        reason: `Tool '${toolName}' requires approval`,
      });

      if (verdict.kind === "cancelled") {
        // Operator dismissed — treat as deny for this call, no persistence.
        return { decision: "deny", actor: "acp-cancelled" };
      }

      if (verdict.persist) {
        try {
          trajectory.record({
            toolName,
            permissionScope,
            decision: verdict.kind === "approve" ? "approved" : "rejected",
            timestamp: Date.now(),
          });
        } catch (err) {
          logger.debug("trustTrajectory.record failed (non-fatal)", {
            toolName,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return verdict.kind === "approve"
        ? {
          decision: "allow",
          actor: "acp-editor",
          persist: verdict.persist,
          scope: verdict.persist ? "persistent" : undefined,
        }
        : {
          decision: "deny",
          actor: "acp-editor",
          persist: verdict.persist,
          scope: verdict.persist ? "persistent" : undefined,
        };
    } catch (err) {
      logger.warn("ACP permission hook failed — falling through to default policy", {
        toolName,
        err: err instanceof Error ? err.message : String(err),
      });
      // Editor disconnected mid-prompt or other I/O failure — fall through
      // to the default classifier rather than blocking arbitrarily.
      return { decision: "abstain" };
    }
  });

  return uninstall;
}
