import type { PermissionMode } from "./types.js";

export const MODE_PERMISSIVENESS: Record<PermissionMode, number> = {
  observe: 0,
  strict: 1,
  plan: 2,
  paper: 3,
  ask: 4,
  auto: 5,
};

export interface PermissionModeTransitionInput {
  from: PermissionMode;
  to: PermissionMode;
  pendingApprovals: number;
  isStreaming: boolean;
}

export interface PermissionModeTransitionResult {
  allowed: boolean;
  escalation: boolean;
  reason?: string;
}

export function isLiveCapable(mode: PermissionMode): boolean {
  return mode === "ask" || mode === "auto";
}

export function isPermissionEscalation(from: PermissionMode, to: PermissionMode): boolean {
  return MODE_PERMISSIVENESS[to] > MODE_PERMISSIVENESS[from];
}

export function evaluatePermissionModeTransition(
  input: PermissionModeTransitionInput,
): PermissionModeTransitionResult {
  const escalation = isPermissionEscalation(input.from, input.to);
  if (!escalation || input.from === input.to) {
    return { allowed: true, escalation };
  }

  if (input.pendingApprovals > 0) {
    return {
      allowed: false,
      escalation,
      reason: `Cannot switch from ${input.from} to ${input.to} while ${input.pendingApprovals} approval${input.pendingApprovals === 1 ? "" : "s"} are pending. Resolve approvals first.`,
    };
  }

  if (input.isStreaming) {
    return {
      allowed: false,
      escalation,
      reason: `Cannot switch from ${input.from} to ${input.to} while Gordon is streaming. Wait for the turn to finish first.`,
    };
  }

  return { allowed: true, escalation };
}
