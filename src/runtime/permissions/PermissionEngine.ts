import { randomUUID } from "node:crypto";

import type { GordonContext } from "../../infra/agents/types.ts";
import type {
  RuntimeApprovalRequest,
  RuntimeApprovalRule,
  RuntimeToolSpec,
} from "../contracts/types.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import type { RuntimeToolPolicyDecision } from "../tools/ToolPolicy.ts";

export interface PermissionHookInput {
  policy: RuntimeToolPolicyDecision;
  context: GordonContext;
  runtimeState: ReturnType<RuntimeStore["getState"]>;
  toolName: string;
}

export interface PermissionHookDecision {
  decision: "allow" | "deny" | "queue" | "abstain";
  reason?: string;
  actor?: string;
  persist?: boolean;
  scope?: RuntimeApprovalRule["scope"];
}

export interface PermissionEvaluation {
  status: "allowed" | "blocked" | "pending";
  source: "policy" | "rule" | "classifier" | "hook" | "human";
  request?: RuntimeApprovalRequest;
  rule?: RuntimeApprovalRule;
  reason?: string;
}

export class ToolApprovalRequiredError extends Error {
  readonly request: RuntimeApprovalRequest;

  constructor(request: RuntimeApprovalRequest) {
    super(request.reason ?? `Approval required before ${request.toolName} can run.`);
    this.name = "ToolApprovalRequiredError";
    this.request = request;
  }
}

/**
 * Structured denial error. Carries the matching rule so downstream surfaces
 * (audit trail, /context output, user-facing messaging) can explain *why*
 * the tool was denied — e.g. "denied by rule 'kraken_*' created 2026-03-12".
 * Inspired by opencode's permission/index.ts:89-111 denial-with-context.
 */
export class ToolApprovalDeniedError extends Error {
  readonly toolName: string;
  readonly rule?: RuntimeApprovalRule;
  readonly reason?: string;

  constructor(toolName: string, rule?: RuntimeApprovalRule, reason?: string) {
    const ruleHint = rule
      ? ` (matched rule ${rule.id}${rule.toolNamePattern ? ` pattern="${rule.toolNamePattern}"` : ""})`
      : "";
    super(reason ?? `Tool "${toolName}" is denied by policy${ruleHint}.`);
    this.name = "ToolApprovalDeniedError";
    this.toolName = toolName;
    this.rule = rule;
    this.reason = reason;
  }
}

/**
 * Opt-in helper for callers that want "blocked" permission evaluations to
 * surface as a thrown error (with rule context) rather than as a status
 * field they must inspect. Existing `evaluate()` callers keep the
 * return-state semantics; callers on critical paths (e.g. order submission)
 * can wrap the result in `assertNotDenied` to fail loud.
 *
 * Non-blocked results pass through unchanged.
 */
export function assertNotDenied(
  evaluation: PermissionEvaluation,
  toolName: string,
): PermissionEvaluation {
  if (evaluation.status === "blocked" && evaluation.rule?.decision === "deny") {
    throw new ToolApprovalDeniedError(toolName, evaluation.rule, evaluation.reason);
  }
  return evaluation;
}

// ---------------------------------------------------------------------------
// Wildcard matching helper (item 2)
// ---------------------------------------------------------------------------

/**
 * Convert a glob-style pattern (`*` multi-char, `?` single-char) into a
 * regex anchored at both ends. Other regex metacharacters are escaped so
 * they match literally.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`);
}

function matchesRule(tool: RuntimeToolSpec, toolName: string, rule: RuntimeApprovalRule, now: number): boolean {
  if (rule.expiresAt && new Date(rule.expiresAt).getTime() <= now) return false;
  if (rule.permissionScope && rule.permissionScope !== tool.permissionScope) return false;
  if (rule.toolName && rule.toolName !== toolName) return false;
  if (rule.toolNamePattern && !globToRegex(rule.toolNamePattern).test(toolName)) return false;
  // Rule with no toolName and no pattern = wildcard-all under its permissionScope (or all if no scope).
  return true;
}

/** A rule is "specific" if it names the tool exactly; patterns rank below. */
function ruleSpecificity(rule: RuntimeApprovalRule): number {
  if (rule.toolName) return 2;
  if (rule.toolNamePattern) return 1;
  return 0; // scope-only or catch-all
}

function buildFingerprint(tool: RuntimeToolSpec, context: GordonContext, runtimeState: ReturnType<RuntimeStore["getState"]>): string {
  return [
    tool.id,
    tool.permissionScope,
    runtimeState.runtimeId,
    runtimeState.session.threadId ?? runtimeState.session.snapshot?.threadId ?? "no-thread",
    context.config.permissionMode,
  ].join(":");
}

function defaultClassifier(input: PermissionHookInput): PermissionHookDecision {
  if (input.policy.approvalClass === "none") {
    return {
      decision: "allow",
      actor: "classifier:auto-safe",
    };
  }

  if (
    input.policy.tool.sideEffectLevel === "read"
    && input.policy.tool.riskClass === "low"
    && input.policy.approvalClass !== "always_require_human"
  ) {
    return {
      decision: "allow",
      actor: "classifier:read-only",
    };
  }

  if (input.policy.approvalClass === "always_require_human" || input.policy.tool.riskClass === "critical") {
    return {
      decision: "queue",
      actor: "classifier:human-required",
      reason: input.policy.reason ?? `Human approval required for ${input.toolName}.`,
    };
  }

  return {
    decision: "abstain",
  };
}

export class PermissionEngine {
  private readonly runtimeStore: RuntimeStore;
  private readonly hooks: Array<(input: PermissionHookInput) => PermissionHookDecision | Promise<PermissionHookDecision>> = [
    defaultClassifier,
  ];

  constructor(runtimeStore: RuntimeStore) {
    this.runtimeStore = runtimeStore;
  }

  registerHook(
    hook: (input: PermissionHookInput) => PermissionHookDecision | Promise<PermissionHookDecision>,
  ): () => void {
    this.hooks.push(hook);
    return () => {
      const index = this.hooks.indexOf(hook);
      if (index >= 0) {
        this.hooks.splice(index, 1);
      }
    };
  }

  listPending(): RuntimeApprovalRequest[] {
    return [...this.runtimeStore.getState().approvals.pending];
  }

  listRecent(limit: number = 20): RuntimeApprovalRequest[] {
    return this.runtimeStore.getState().approvals.recent.slice(0, Math.max(1, limit));
  }

  listRules(): RuntimeApprovalRule[] {
    return [...this.runtimeStore.getState().approvals.rules];
  }

  async evaluate(
    toolName: string,
    context: GordonContext,
    policy: RuntimeToolPolicyDecision,
  ): Promise<PermissionEvaluation> {
    const runtimeState = this.runtimeStore.getState();
    const tool = policy.tool;

    if (!policy.allowed) {
      return {
        status: "blocked",
        source: "policy",
        reason: policy.reason,
      };
    }

    const matchingRule = this.findMatchingRule(tool, toolName, runtimeState.approvals.rules);
    if (matchingRule) {
      const now = new Date().toISOString();
      if (matchingRule.decision === "deny") {
        return {
          status: "blocked",
          source: "rule",
          rule: matchingRule,
          reason: `Blocked by ${matchingRule.scope} rule for ${toolName}.`,
        };
      }

      const approvedRequest: RuntimeApprovalRequest = {
        id: randomUUID(),
        toolName,
        permissionScope: tool.permissionScope,
        approvalClass: policy.approvalClass,
        riskClass: tool.riskClass,
        sideEffectLevel: tool.sideEffectLevel,
        runtimeId: runtimeState.runtimeId,
        sessionId: runtimeState.session.sessionId,
        resourceId: runtimeState.session.resourceId,
        threadId: runtimeState.session.threadId ?? runtimeState.session.snapshot?.threadId ?? undefined,
        fingerprint: buildFingerprint(tool, context, runtimeState),
        status: "approved",
        reason: `Approved by ${matchingRule.scope} rule.`,
        actor: matchingRule.createdBy,
        decisionSource: "rule",
        requestedAt: now,
        decidedAt: now,
      };
      this.recordResolvedRequest(approvedRequest);
      return {
        status: "allowed",
        source: "rule",
        request: approvedRequest,
        rule: matchingRule,
      };
    }

    const hookInput: PermissionHookInput = {
      policy,
      context,
      runtimeState,
      toolName,
    };
    for (const hook of this.hooks) {
      const decision = await hook(hookInput);
      if (decision.decision === "abstain") {
        continue;
      }

      if (decision.decision === "allow") {
        const approvedRequest: RuntimeApprovalRequest = {
          id: randomUUID(),
          toolName,
          permissionScope: tool.permissionScope,
          approvalClass: policy.approvalClass,
          riskClass: tool.riskClass,
          sideEffectLevel: tool.sideEffectLevel,
          runtimeId: runtimeState.runtimeId,
          sessionId: runtimeState.session.sessionId,
          resourceId: runtimeState.session.resourceId,
          threadId: runtimeState.session.threadId ?? runtimeState.session.snapshot?.threadId ?? undefined,
          fingerprint: buildFingerprint(tool, context, runtimeState),
          status: "approved",
          reason: decision.reason,
          actor: decision.actor,
          decisionSource: decision.actor?.startsWith("classifier") ? "classifier" : "hook",
          requestedAt: new Date().toISOString(),
          decidedAt: new Date().toISOString(),
        };
        this.recordResolvedRequest(approvedRequest);
        if (decision.persist) {
          this.upsertRule({
            id: randomUUID(),
            decision: "allow",
            scope: decision.scope ?? "session",
            toolName,
            permissionScope: tool.permissionScope,
            createdAt: new Date().toISOString(),
            createdBy: decision.actor ?? "runtime",
          });
        }
        return {
          status: "allowed",
          source: approvedRequest.decisionSource ?? "hook",
          request: approvedRequest,
        };
      }

      if (decision.decision === "deny") {
        const deniedRequest: RuntimeApprovalRequest = {
          id: randomUUID(),
          toolName,
          permissionScope: tool.permissionScope,
          approvalClass: policy.approvalClass,
          riskClass: tool.riskClass,
          sideEffectLevel: tool.sideEffectLevel,
          runtimeId: runtimeState.runtimeId,
          sessionId: runtimeState.session.sessionId,
          resourceId: runtimeState.session.resourceId,
          threadId: runtimeState.session.threadId ?? runtimeState.session.snapshot?.threadId ?? undefined,
          fingerprint: buildFingerprint(tool, context, runtimeState),
          status: "denied",
          reason: decision.reason,
          actor: decision.actor,
          decisionSource: decision.actor?.startsWith("classifier") ? "classifier" : "hook",
          requestedAt: new Date().toISOString(),
          decidedAt: new Date().toISOString(),
        };
        this.recordResolvedRequest(deniedRequest);
        if (decision.persist) {
          this.upsertRule({
            id: randomUUID(),
            decision: "deny",
            scope: decision.scope ?? "session",
            toolName,
            permissionScope: tool.permissionScope,
            createdAt: new Date().toISOString(),
            createdBy: decision.actor ?? "runtime",
          });
        }
        return {
          status: "blocked",
          source: deniedRequest.decisionSource ?? "hook",
          request: deniedRequest,
          reason: decision.reason,
        };
      }

      const queued = this.queueRequest(toolName, tool, policy.approvalClass, context, runtimeState, decision.reason);
      return {
        status: "pending",
        source: decision.actor?.startsWith("classifier") ? "classifier" : "hook",
        request: queued,
        reason: queued.reason,
      };
    }

    const queued = this.queueRequest(toolName, tool, policy.approvalClass, context, runtimeState, policy.reason);
    return {
      status: "pending",
      source: "policy",
      request: queued,
      reason: queued.reason,
    };
  }

  approve(
    requestId: string,
    options: { actor?: string; persist?: boolean; scope?: RuntimeApprovalRule["scope"] } = {},
  ): RuntimeApprovalRequest | null {
    const state = this.runtimeStore.getState();
    const pending = state.approvals.pending.find((entry) => entry.id === requestId);
    if (!pending) {
      return null;
    }

    const approved: RuntimeApprovalRequest = {
      ...pending,
      status: "approved",
      actor: options.actor ?? "human",
      decisionSource: "human",
      decidedAt: new Date().toISOString(),
    };

    if (options.persist) {
      this.upsertRule({
        id: randomUUID(),
        toolName: approved.toolName,
        permissionScope: approved.permissionScope,
        decision: "allow",
        scope: options.scope ?? "persistent",
        createdAt: new Date().toISOString(),
        createdBy: approved.actor ?? "human",
      });
    }

    this.resolvePendingRequest(approved);
    return approved;
  }

  deny(
    requestId: string,
    options: {
      actor?: string;
      persist?: boolean;
      scope?: RuntimeApprovalRule["scope"];
      reason?: string;
      /**
       * Cascade the denial to every other pending request that shares the
       * same `permissionScope`. Avoids re-prompting the user for each
       * dependent tool call after a parent decision is rejected.
       * Inspired by opencode's session-scoped cascade (permission/index.ts:229-245).
       */
      cascade?: boolean;
    } = {},
  ): RuntimeApprovalRequest | null {
    const state = this.runtimeStore.getState();
    const pending = state.approvals.pending.find((entry) => entry.id === requestId);
    if (!pending) {
      return null;
    }

    const denied: RuntimeApprovalRequest = {
      ...pending,
      status: "denied",
      actor: options.actor ?? "human",
      decisionSource: "human",
      reason: options.reason ?? pending.reason,
      decidedAt: new Date().toISOString(),
    };

    if (options.persist) {
      this.upsertRule({
        id: randomUUID(),
        toolName: denied.toolName,
        permissionScope: denied.permissionScope,
        decision: "deny",
        scope: options.scope ?? "persistent",
        createdAt: new Date().toISOString(),
        createdBy: denied.actor ?? "human",
      });
    }

    this.resolvePendingRequest(denied);

    if (options.cascade) {
      // Re-read state (resolvePendingRequest mutated it) and cascade-deny
      // every remaining pending request that shares the same scope.
      const after = this.runtimeStore.getState();
      const targets = after.approvals.pending.filter(
        (entry) => entry.id !== requestId && entry.permissionScope === pending.permissionScope,
      );
      for (const target of targets) {
        const cascaded: RuntimeApprovalRequest = {
          ...target,
          status: "denied",
          actor: options.actor ?? "human",
          decisionSource: "human",
          reason: `Cascaded from ${requestId}: ${options.reason ?? pending.reason ?? "denied"}`,
          decidedAt: new Date().toISOString(),
        };
        this.resolvePendingRequest(cascaded);
      }
    }

    return denied;
  }

  /**
   * Bulk-deny every pending request. Optionally filter by permissionScope —
   * e.g. `denyAll({ scope: "trading" })` clears only trading-risk approvals.
   * Returns the count of requests denied.
   */
  denyAll(options: {
    scope?: RuntimeApprovalRequest["permissionScope"];
    actor?: string;
    reason?: string;
  } = {}): number {
    const state = this.runtimeStore.getState();
    const targets = state.approvals.pending.filter(
      (entry) => !options.scope || entry.permissionScope === options.scope,
    );
    for (const target of targets) {
      this.deny(target.id, {
        actor: options.actor ?? "user",
        reason: options.reason ?? "Bulk denied via /deny-all",
      });
    }
    return targets.length;
  }

  private queueRequest(
    toolName: string,
    tool: RuntimeToolSpec,
    approvalClass: RuntimeApprovalRequest["approvalClass"],
    context: GordonContext,
    runtimeState: ReturnType<RuntimeStore["getState"]>,
    reason?: string,
  ): RuntimeApprovalRequest {
    const fingerprint = buildFingerprint(tool, context, runtimeState);
    const existing = runtimeState.approvals.pending.find((entry) => entry.fingerprint === fingerprint);
    if (existing) {
      return existing;
    }

    const request: RuntimeApprovalRequest = {
      id: randomUUID(),
      toolName,
      permissionScope: tool.permissionScope,
      approvalClass,
      riskClass: tool.riskClass,
      sideEffectLevel: tool.sideEffectLevel,
      runtimeId: runtimeState.runtimeId,
      sessionId: runtimeState.session.sessionId,
      resourceId: runtimeState.session.resourceId,
      threadId: runtimeState.session.threadId ?? runtimeState.session.snapshot?.threadId ?? undefined,
      fingerprint,
      status: "pending",
      reason: reason ?? `Approval required for ${toolName}.`,
      requestedAt: new Date().toISOString(),
    };

    const pending = [request, ...runtimeState.approvals.pending].slice(0, 50);
    this.runtimeStore.setApprovalState({
      pending,
      recent: [request, ...runtimeState.approvals.recent].slice(0, 50),
    });
    return request;
  }

  private resolvePendingRequest(request: RuntimeApprovalRequest): void {
    const state = this.runtimeStore.getState();
    this.runtimeStore.setApprovalState({
      pending: state.approvals.pending.filter((entry) => entry.id !== request.id),
      recent: [request, ...state.approvals.recent.filter((entry) => entry.id !== request.id)].slice(0, 50),
    });
  }

  private recordResolvedRequest(request: RuntimeApprovalRequest): void {
    const state = this.runtimeStore.getState();
    this.runtimeStore.setApprovalState({
      recent: [request, ...state.approvals.recent.filter((entry) => entry.id !== request.id)].slice(0, 50),
    });
  }

  private upsertRule(rule: RuntimeApprovalRule): void {
    const state = this.runtimeStore.getState();
    const rules = [
      rule,
      ...state.approvals.rules.filter((existing) =>
        !(existing.toolName === rule.toolName && existing.permissionScope === rule.permissionScope && existing.decision === rule.decision)
      ),
    ].slice(0, 100);
    this.runtimeStore.setApprovalState({ rules });
  }

  private findMatchingRule(
    tool: RuntimeToolSpec,
    toolName: string,
    rules: RuntimeApprovalRule[],
  ): RuntimeApprovalRule | null {
    const now = Date.now();
    const candidates = rules.filter((rule) => matchesRule(tool, toolName, rule, now));
    if (candidates.length === 0) return null;
    // Specificity wins; newest rule breaks ties (createdAt descending).
    candidates.sort((a, b) => {
      const specDiff = ruleSpecificity(b) - ruleSpecificity(a);
      if (specDiff !== 0) return specDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return candidates[0] ?? null;
  }
}
