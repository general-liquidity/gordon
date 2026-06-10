/**
 * Permission bridge — surfaces Gordon's permission gates as ACP
 * `session/request_permission` calls to the editor.
 *
 * Gordon's safety stack (`riskClassifier` + `trustTrajectory` +
 * `PermissionEngine`) decides whether a tool call is auto-approved,
 * needs operator confirmation, or is blocked outright. In TUI mode,
 * confirmations go to the approval queue. In ACP mode (Gordon spawned
 * by Zed/Athas), the editor IS the operator surface — confirmations
 * should appear there.
 *
 * This bridge exposes a single helper, `requestPermissionViaAcp`, that:
 *   - Builds an ACP RequestPermissionRequest with the appropriate
 *     options (allow_once / allow_always / reject_once / reject_always)
 *   - Awaits the editor's response
 *   - Maps back to a Gordon-friendly verdict (`approve` | `reject` |
 *     `cancelled`)
 *
 * Mapping (ACP `PermissionOptionKind` ↔ Gordon decision):
 *
 *   ACP outcome                    Gordon verdict      Persist as trust?
 *   ──────────────────────────     ────────────────    ─────────────────
 *   selected: allow_once           approve             no
 *   selected: allow_always         approve             yes
 *   selected: reject_once          reject              no
 *   selected: reject_always        reject              yes
 *   cancelled                      cancelled           no
 *
 * The ACP hook records persisted decisions into Gordon's trustTrajectory
 * under the tool's runtime permission scope, so a paper-mode editor
 * approval never grants live-trading trust.
 */

import type {
  AgentSideConnection,
  PermissionOption,
  ToolCallUpdate,
  RequestPermissionRequest,
} from "@agentclientprotocol/sdk";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("acp-permission-bridge");

export type GordonAcpPermissionVerdict =
  | { kind: "approve"; persist: boolean }
  | { kind: "reject"; persist: boolean }
  | { kind: "cancelled" };

export interface RequestAcpPermissionParams {
  sessionId: string;
  toolName: string;
  toolCallId: string;
  /** Human-readable reason for the prompt — surfaced in the editor's UI. */
  reason: string;
  /** Severity tag for prioritization in the editor's permission panel. */
  severity?: "info" | "warning" | "danger";
}

const DEFAULT_PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
  { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
  { optionId: "reject_once", name: "Reject", kind: "reject_once" },
  { optionId: "reject_always", name: "Always reject", kind: "reject_always" },
];

/**
 * Request permission from the editor for a tool-call execution.
 *
 * Returns the operator's verdict mapped to Gordon's vocabulary. The
 * caller should map `approve` to proceed-with-tool, `reject` to abort,
 * and `cancelled` to the same as reject (operator dismissed the prompt).
 *
 * Failure modes:
 *   - The editor doesn't respond (connection drop, timeout) — caller
 *     decides whether to default-deny or default-allow. This helper
 *     surfaces the error rather than choosing.
 *   - The editor returns an unknown option id — treated as cancelled.
 */
export async function requestAcpPermission(
  connection: AgentSideConnection,
  params: RequestAcpPermissionParams,
): Promise<GordonAcpPermissionVerdict> {
  const toolCallUpdate: ToolCallUpdate = {
    toolCallId: params.toolCallId,
    title: params.reason,
    kind: "execute",
  };
  const request: RequestPermissionRequest = {
    sessionId: params.sessionId,
    toolCall: toolCallUpdate,
    options: DEFAULT_PERMISSION_OPTIONS,
  };

  try {
    const response = await connection.requestPermission(request);
    const outcome = response.outcome;
    if (outcome.outcome === "cancelled") {
      return { kind: "cancelled" };
    }
    if (outcome.outcome === "selected") {
      const optionId = outcome.optionId;
      switch (optionId) {
        case "allow_once":
          return { kind: "approve", persist: false };
        case "allow_always":
          return { kind: "approve", persist: true };
        case "reject_once":
          return { kind: "reject", persist: false };
        case "reject_always":
          return { kind: "reject", persist: true };
        default:
          logger.warn("Unknown permission optionId — treating as cancelled", {
            optionId,
            toolName: params.toolName,
          });
          return { kind: "cancelled" };
      }
    }
    return { kind: "cancelled" };
  } catch (err) {
    logger.warn("ACP requestPermission failed", {
      toolName: params.toolName,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
