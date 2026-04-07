/**
 * Compaction Auto-Trigger
 *
 * Wires TokenProjector into the agent loop to proactively trigger
 * compaction at configurable thresholds. Called after each API response
 * with the real token count.
 *
 * Thresholds (from tokenProjection.ts):
 *   70% → warn (emit context_warning event)
 *   80% → microcompact (trim old tool results)
 *   90% → full compact (LLM summarization)
 *   97% → hard limit (halt new tool calls)
 *
 * Integration: Call `checkAndTriggerCompaction()` from the orchestrator
 * after each API response. It returns an action the caller should take.
 */

import {
  TokenProjector,
  type ProjectionConfig,
  type ProjectionResult,
  type ThresholdStage,
  DEFAULT_PROJECTION_CONFIG,
} from "./tokenProjection.ts";
import { emitAgentEvent } from "../agents/streaming/coordinator.ts";
import { createEvent } from "../agents/streaming/events.ts";

// ============================================================================
// Types
// ============================================================================

export type CompactionAction =
  | "none"
  | "warn"
  | "microcompact"
  | "compact"
  | "halt";

export interface CompactionDecision {
  action: CompactionAction;
  stage: ThresholdStage;
  projection: ProjectionResult;
  /** True if this stage is new (just crossed threshold). */
  isTransition: boolean;
}

// ============================================================================
// Stateful Trigger
// ============================================================================

/**
 * Tracks compaction state across the session. One instance per session.
 */
export class CompactionTrigger {
  private projector: TokenProjector;
  private lastStage: ThresholdStage = "ok";
  private turn: number = 0;
  private microcompactCount: number = 0;
  private fullCompactCount: number = 0;
  private iteration: number = 0;

  constructor(config?: Partial<ProjectionConfig>) {
    this.projector = new TokenProjector(config);
  }

  /**
   * Record a new token measurement and determine what action to take.
   * Call after each API response with the real input token count.
   */
  check(inputTokens: number): CompactionDecision {
    this.turn++;
    const projection = this.projector.record(inputTokens, this.turn);
    const { stage } = projection;
    const isTransition = stage !== this.lastStage;
    this.lastStage = stage;

    const action = stageToAction(stage);

    // Emit events on transitions
    if (isTransition && stage !== "ok") {
      this.emitWarning(projection);
    }

    return { action, stage, projection, isTransition };
  }

  /**
   * Record that microcompaction was performed.
   */
  recordMicrocompact(tokensSaved: number): void {
    this.microcompactCount++;
    emitAgentEvent(createEvent("microcompact", this.iteration, {
      cleared: this.microcompactCount,
      tokensSaved,
      trigger: "token" as const,
    }));
  }

  /**
   * Record that full compaction was performed.
   */
  recordFullCompact(beforeTokens: number, afterTokens: number, summary: string): void {
    this.fullCompactCount++;
    emitAgentEvent(createEvent("compact", this.iteration, {
      beforeTokens,
      afterTokens,
      summary,
    }));
  }

  /** Update the iteration counter (for event metadata). */
  setIteration(n: number): void {
    this.iteration = n;
  }

  /** Get current projection without recording a new sample. */
  current(): ProjectionResult {
    return this.projector.current();
  }

  /** Reset state (new session). */
  reset(): void {
    this.projector.reset();
    this.lastStage = "ok";
    this.turn = 0;
    this.microcompactCount = 0;
    this.fullCompactCount = 0;
    this.iteration = 0;
  }

  /** Stats for debugging. */
  stats(): { turn: number; microcompacts: number; fullCompacts: number; lastStage: ThresholdStage } {
    return {
      turn: this.turn,
      microcompacts: this.microcompactCount,
      fullCompacts: this.fullCompactCount,
      lastStage: this.lastStage,
    };
  }

  private emitWarning(projection: ProjectionResult): void {
    emitAgentEvent(createEvent("context_warning", this.iteration, {
      currentTokens: projection.currentTokens,
      threshold: projection.contextWindow,
      message: projection.recommendation,
    }));
  }
}

function stageToAction(stage: ThresholdStage): CompactionAction {
  switch (stage) {
    case "ok": return "none";
    case "warn": return "warn";
    case "microcompact": return "microcompact";
    case "compact": return "compact";
    case "hard_limit": return "halt";
  }
}

// ============================================================================
// Singleton for session-scoped usage
// ============================================================================

let sessionTrigger: CompactionTrigger | null = null;

export function getCompactionTrigger(config?: Partial<ProjectionConfig>): CompactionTrigger {
  if (!sessionTrigger) {
    sessionTrigger = new CompactionTrigger(config);
  }
  return sessionTrigger;
}

export function resetCompactionTrigger(): void {
  sessionTrigger = null;
}
