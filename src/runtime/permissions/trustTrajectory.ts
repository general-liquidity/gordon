/**
 * Trust Trajectory — adaptive auto-approval based on observed user
 * decisions over time.
 *
 * Anthropic's data on Claude Code shows users approve 93% of permission
 * prompts. The implication is that approval-prompt fatigue is the real
 * UX cost, not safety. The fix is *not* more warnings; it's restructured
 * boundaries that auto-approve actions the user has already vouched for
 * many times.
 *
 * This module tracks every approval decision (approved / rejected) per
 * (toolName, permissionScope) in an append-only ledger, then exposes a
 * trust score the PermissionEngine can use to short-circuit the
 * human-required queue for tools the user has consistently approved.
 * Keying by scope as well as name means a paper-mode approval
 * (`papertrade.execute`) never credits trust toward the same tool in
 * live mode (`livetrade.execute`).
 *
 * Design constraints (Gordon-specific):
 *   - Safety-critical tools NEVER auto-approve, regardless of trust
 *     score. They stay on the riskClassifier path. The deny-list below
 *     is the single source of truth.
 *   - Trust is per-runtime-session in memory; persistence is opt-in
 *     via the file-backed store (caller passes a path). Sessions
 *     start with empty trust by default — matches Claude Code's
 *     "permissions never restored on resume" invariant.
 *   - Rejection has stronger weight than approval — one recent reject
 *     wipes accumulated trust. We err toward "ask again" over "auto-fire".
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("trust-trajectory");

export type TrustDecision = "approved" | "rejected";

export interface TrustEvent {
  toolName: string;
  decision: TrustDecision;
  timestamp: number;
  /**
   * Runtime permission scope the decision was made under (e.g.
   * `papertrade.execute`). Legacy ledger rows predate this field;
   * they are treated as global-scope and never credit a scoped lookup.
   */
  permissionScope?: string;
  /** Optional context — usually the actor that made the call. */
  actor?: string;
}

export interface TrustScore {
  /** 0..1 — fraction of approvals over total decisions. */
  score: number;
  approvals: number;
  rejections: number;
  totalDecisions: number;
  /** Most recent decision timestamp (ms). undefined if no history. */
  lastDecisionAt?: number;
  /** Whether the trust hook would auto-approve right now. */
  eligible: boolean;
  /** Why the eligibility verdict is what it is. */
  reason: string;
}

export interface TrustTrajectoryOptions {
  /** Minimum approvals before auto-approval is even considered. Default 5. */
  minApprovals?: number;
  /** Score threshold (approvals/total) above which auto-approve. Default 0.95. */
  scoreThreshold?: number;
  /** Window (ms) over which to compute the score. Default 30 days. */
  windowMs?: number;
  /** A single rejection within this many ms blocks auto-approval. Default 7 days. */
  rejectionCooldownMs?: number;
  /** Optional file path for an append-only JSONL ledger. */
  persistPath?: string;
}

/**
 * Tools that must never auto-approve from the trust trajectory, no
 * matter how many approvals accumulate. The riskClassifier handles
 * these instead. Patterns are matched as case-insensitive
 * `String.prototype.includes` on the tool name.
 */
export const SAFETY_CRITICAL_PATTERNS: readonly string[] = [
  "execute_plan",
  "place_order",
  "place_market_order",
  "place_bracket_order",
  "place_limit_order",
  "place_oco_order",
  "execute_trade",
  "cancel_order",
  "cancel_all",
  "submit_order",
  "wallet_send",
  "wallet_transfer",
  "transfer_funds",
  "withdraw",
  "approve_token",
  "create_mandate",
  "delete_mandate",
  "skill_install",
  "exec_shell",
  "run_shell",
];

export function isSafetyCritical(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return SAFETY_CRITICAL_PATTERNS.some((p) => lower.includes(p));
}

const DEFAULT_OPTIONS: Required<Omit<TrustTrajectoryOptions, "persistPath">> = {
  minApprovals: 5,
  scoreThreshold: 0.95,
  windowMs: 30 * 24 * 60 * 60 * 1000,
  rejectionCooldownMs: 7 * 24 * 60 * 60 * 1000,
};

/**
 * In-memory trust ledger. Caller can construct one per process. Pass
 * `persistPath` to mirror writes to a JSONL file; on construction,
 * existing rows from that file are loaded into memory.
 */
export class TrustTrajectory {
  private readonly events: TrustEvent[] = [];
  private readonly options: Required<Omit<TrustTrajectoryOptions, "persistPath">>;
  private readonly persistPath?: string;

  constructor(options: TrustTrajectoryOptions = {}) {
    this.options = {
      minApprovals: options.minApprovals ?? DEFAULT_OPTIONS.minApprovals,
      scoreThreshold: options.scoreThreshold ?? DEFAULT_OPTIONS.scoreThreshold,
      windowMs: options.windowMs ?? DEFAULT_OPTIONS.windowMs,
      rejectionCooldownMs: options.rejectionCooldownMs ?? DEFAULT_OPTIONS.rejectionCooldownMs,
    };
    this.persistPath = options.persistPath;
    if (this.persistPath && existsSync(this.persistPath)) {
      this.loadFromDisk(this.persistPath);
    }
  }

  /** Record a tool decision. Appends to memory + (if configured) disk. */
  record(event: TrustEvent): void {
    this.events.push(event);
    if (this.persistPath) {
      try {
        mkdirSync(dirname(this.persistPath), { recursive: true });
        appendFileSync(this.persistPath, JSON.stringify(event) + "\n");
      } catch {
        // Best-effort persist; never block the runtime on disk failures.
      }
    }
  }

  /**
   * Compute the trust score for a tool under a specific permission
   * scope. Returns `eligible: false` for safety-critical tools
   * regardless of history. Only events recorded under the exact same
   * scope count — legacy scope-less events count only toward
   * scope-less lookups, never toward a scoped one.
   */
  scoreFor(toolName: string, permissionScope?: string, now: number = Date.now()): TrustScore {
    if (isSafetyCritical(toolName)) {
      return {
        score: 0,
        approvals: 0,
        rejections: 0,
        totalDecisions: 0,
        eligible: false,
        reason: `${toolName} matches a safety-critical pattern — never auto-approve`,
      };
    }

    const cutoff = now - this.options.windowMs;
    const rejectionCutoff = now - this.options.rejectionCooldownMs;
    let approvals = 0;
    let rejections = 0;
    let recentRejection = false;
    let lastDecisionAt: number | undefined;

    for (const e of this.events) {
      if (e.toolName !== toolName) continue;
      if (e.permissionScope !== permissionScope) continue;
      if (e.timestamp < cutoff) continue;
      if (e.decision === "approved") approvals++;
      else {
        rejections++;
        if (e.timestamp >= rejectionCutoff) recentRejection = true;
      }
      if (lastDecisionAt === undefined || e.timestamp > lastDecisionAt) {
        lastDecisionAt = e.timestamp;
      }
    }

    const total = approvals + rejections;
    const score = total === 0 ? 0 : approvals / total;

    let eligible = false;
    let reason: string;
    if (recentRejection) {
      reason = `Recent rejection within cooldown — auto-approval blocked`;
    } else if (approvals < this.options.minApprovals) {
      reason = `Only ${approvals} approvals in window (need ${this.options.minApprovals})`;
    } else if (score < this.options.scoreThreshold) {
      reason = `Score ${score.toFixed(2)} below threshold ${this.options.scoreThreshold}`;
    } else {
      eligible = true;
      reason = `${approvals} approvals, score ${score.toFixed(2)} — eligible for auto-approve`;
    }

    return {
      score,
      approvals,
      rejections,
      totalDecisions: total,
      lastDecisionAt,
      eligible,
      reason,
    };
  }

  /** Snapshot all events — used by tests and by /context output. */
  listEvents(): TrustEvent[] {
    return [...this.events];
  }

  /** For tests. */
  reset(): void {
    this.events.length = 0;
  }

  private loadFromDisk(path: string): void {
    try {
      const raw = readFileSync(path, "utf8");
      let lineNumber = 0;
      for (const line of raw.split("\n")) {
        lineNumber++;
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const ev = JSON.parse(trimmed) as TrustEvent;
          if (ev.toolName && (ev.decision === "approved" || ev.decision === "rejected") && typeof ev.timestamp === "number") {
            this.events.push(ev);
          } else {
            this.warnMalformedRow(path, lineNumber, "invalid trust event shape");
          }
        } catch (err) {
          this.warnMalformedRow(path, lineNumber, err instanceof Error ? err.message : String(err));
        }
      }
    } catch {
      // No file / unreadable — start empty.
    }
  }

  private warnMalformedRow(path: string, lineNumber: number, reason: string): void {
    logger.warn("Skipped malformed trust trajectory ledger row", {
      component: "trustTrajectory",
      path,
      lineNumber,
      reason,
    });
  }
}

// Singleton for the default runtime instance — modules that don't want
// to thread an instance through can import this. Tests always construct
// their own.
let defaultInstance: TrustTrajectory | undefined;
export function getDefaultTrustTrajectory(): TrustTrajectory {
  if (!defaultInstance) defaultInstance = new TrustTrajectory();
  return defaultInstance;
}

export function _resetDefaultTrustTrajectoryForTests(): void {
  defaultInstance = undefined;
}

// ============================================================================
// PermissionEngine integration
// ============================================================================

/**
 * Build a permission hook that auto-approves tools the user has
 * consistently approved over time. Designed to be `prependHook`'d
 * before the default classifier so trusted tools short-circuit the
 * human-required queue.
 *
 * The hook abstains for everything else, leaving downstream hooks
 * (default classifier, custom hooks) to decide.
 */
export function buildTrustTrajectoryHook(
  trajectory: TrustTrajectory,
  options: { now?: () => number } = {},
): (input: {
  toolName: string;
  permissionScope?: string;
  policy: { approvalClass?: string; tool?: { permissionScope?: string } };
}) => { decision: "allow" | "abstain"; actor?: string; reason?: string } {
  const now = options.now ?? Date.now;
  return (input) => {
    const permissionScope = input.permissionScope ?? input.policy.tool?.permissionScope;
    const score = trajectory.scoreFor(input.toolName, permissionScope, now());
    if (!score.eligible) return { decision: "abstain" };

    // Belt-and-braces: even if scoreFor missed the safety-critical
    // pattern, refuse to auto-approve when the policy itself flags
    // human-required.
    if (input.policy.approvalClass === "always_require_human") {
      return { decision: "abstain" };
    }

    return {
      decision: "allow",
      actor: "classifier:trust-trajectory",
      reason: `${score.approvals} prior approvals (score ${score.score.toFixed(2)})`,
    };
  };
}

/** Convenience: auto-record an evaluation result into the trajectory. */
export function recordPermissionEvaluation(
  trajectory: TrustTrajectory,
  toolName: string,
  status: "allowed" | "blocked" | "pending",
  decidedAt: number = Date.now(),
  permissionScope?: string,
): void {
  if (status === "allowed") {
    trajectory.record({ toolName, permissionScope, decision: "approved", timestamp: decidedAt });
  } else if (status === "blocked") {
    trajectory.record({ toolName, permissionScope, decision: "rejected", timestamp: decidedAt });
  }
  // "pending" doesn't yield a decision yet.
}
