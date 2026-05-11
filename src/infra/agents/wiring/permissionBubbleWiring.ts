/**
 * Permission-bubble wiring — registers a `buildBubbleStamper`-shaped
 * hook with the PermissionEngine so fork-originated approval requests
 * surface with a "[fork X: 'task']" prefix in the UI.
 *
 * Activation: `GORDON_PERMISSION_BUBBLE` env flag. When off,
 * `attachBubbleHook` is a no-op so existing PermissionEngine
 * behavior is unchanged.
 *
 * Fork lookup: the wiring takes a `ForkLookup` from the caller —
 * typically the AgentRegistry's lookup specialized to fork-typed
 * entries. The wiring itself doesn't hold the registry; it just
 * threads the lookup through.
 */

import {
  buildBubbleStamper,
  type ForkLookup,
} from "../../../runtime/permissions/permissionBubble.ts";
import type { PermissionEngine } from "../../../runtime/permissions/PermissionEngine.ts";

const FLAG_ENV = "GORDON_PERMISSION_BUBBLE";

export function isPermissionBubbleEnabled(): boolean {
  return process.env[FLAG_ENV] === "1";
}

/**
 * Attach the bubble stamper as a permission hook that runs BEFORE the
 * default classifier (via prependHook). On a fork-originated request,
 * the stamp tags the request metadata so downstream rendering knows
 * which fork is asking; it does NOT change the approval decision.
 *
 * Returns the unregister function so callers can detach on shutdown.
 * Returns a no-op unregister when the flag is off.
 */
export function attachBubbleHook(
  engine: PermissionEngine,
  lookup: ForkLookup,
): () => void {
  if (!isPermissionBubbleEnabled()) return () => {};

  const stamper = buildBubbleStamper(lookup);
  const hook = (input: { toolName: string; policy: { approvalClass?: string } }) => {
    const stamp = stamper(input);
    if (!stamp) return { decision: "abstain" as const };
    // The stamper only adds metadata; it does not decide allow/deny.
    // Returning "abstain" lets the default classifier still run, but
    // with the metadata already attached.
    return {
      decision: "abstain" as const,
      reason: stamp.promptPrefix,
    };
  };

  return engine.prependHook(hook);
}
