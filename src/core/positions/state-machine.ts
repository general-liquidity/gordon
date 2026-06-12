/**
 * Position State Machine
 * Enforces valid state transitions and emits events on every change.
 *
 * Every transition is atomic:
 *   1. Validate the transition is legal
 *   2. Update the position record with new state + data
 *   3. Append to stateHistory
 *   4. Persist to store
 *   5. Emit events on the EventBus
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import { InvalidStateError, NotFoundError } from "../../errors/index.ts";
import type { EventBus } from "../../events/bus.ts";
import { PositionStore } from "./store.ts";
import {
  PositionRecordSchema,
  VALID_TRANSITIONS,
  TERMINAL_STATES,
  type PositionState,
  type PositionRecord,
  type CreatePositionParams,
  type StateTransition,
} from "./types.ts";

const logger = createModuleLogger("position-state-machine");

function validateMergedPosition(record: PositionRecord, currentState: PositionState): PositionRecord {
  const parsed = PositionRecordSchema.safeParse(record);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new InvalidStateError(
      `Invalid position data merge: ${issues}`,
      currentState,
      undefined,
      { issues },
    );
  }
  return parsed.data;
}

/**
 * Generate a unique position ID with the pos_ prefix.
 */
function generatePositionId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  const timestamp = Date.now().toString(36);
  return `pos_${timestamp}_${random}`;
}

// ============================================================================
// Position State Machine
// ============================================================================

export class PositionStateMachine {
  constructor(
    private bus: EventBus,
    private store: PositionStore
  ) {}

  /**
   * Create a new position. Starts in the 'idea' state.
   */
  async create(params: CreatePositionParams): Promise<PositionRecord> {
    const now = new Date().toISOString();
    const id = generatePositionId();

    const position: PositionRecord = {
      id,
      symbol: params.symbol,
      exchangeId: params.exchangeId,
      side: params.side,
      state: "idea",
      stateHistory: [],

      // Setup phase
      setupSignal: params.setupSignal,

      // Metadata
      strategyId: params.strategyId,
      playbookId: params.playbookId,
      tags: params.tags,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.save(position);

    logger.info("Position created", { id, symbol: params.symbol, side: params.side });

    // Emit creation event
    await this.bus.emit({
      type: "position:created" as const,
      timestamp: now,
      positionId: id,
      symbol: params.symbol,
      side: params.side,
      position,
    });

    return position;
  }

  /**
   * Transition a position to a new state.
   *
   * Validates that the transition is legal according to VALID_TRANSITIONS.
   * Appends the transition to stateHistory and persists the position.
   * Emits `position:state_changed` on every transition, plus state-specific events.
   *
   * @param positionId - The position to transition
   * @param toState - Target state
   * @param data - Optional partial data to merge into the position
   * @param reason - Optional reason for the transition (useful for cancel/reject)
   * @param agent - Optional agent name that triggered the transition
   * @throws InvalidStateError if the transition is not allowed
   * @throws NotFoundError if the position doesn't exist
   */
  async transition(
    positionId: string,
    toState: PositionState,
    data?: Partial<PositionRecord>,
    reason?: string,
    agent?: string
  ): Promise<PositionRecord> {
    const existing = await this.store.get(positionId);
    if (!existing) {
      throw new NotFoundError("Position", positionId);
    }

    const fromState = existing.state;

    // Check if position is in a terminal state
    if (TERMINAL_STATES.has(fromState)) {
      throw new InvalidStateError(
        `Position ${positionId} is in terminal state '${fromState}' and cannot transition`,
        fromState,
        toState
      );
    }

    // Validate the transition is legal
    const allowed = VALID_TRANSITIONS[fromState];
    if (!allowed || !allowed.includes(toState)) {
      throw new InvalidStateError(
        `Invalid transition: '${fromState}' -> '${toState}' for position ${positionId}. ` +
          `Allowed transitions from '${fromState}': [${(allowed || []).join(", ")}]`,
        fromState,
        toState
      );
    }

    const now = new Date().toISOString();

    // Build the state transition record
    const transition: StateTransition = {
      fromState,
      toState,
      timestamp: now,
      reason,
      agent,
    };

    // Merge data, update state, append history
    let updated: PositionRecord = {
      ...existing,
      ...(data || {}),
      state: toState,
      stateHistory: [...existing.stateHistory, transition],
      updatedAt: now,
    };

    // Set closedAt for terminal close states
    if (toState === "closed" && !updated.closedAt) {
      updated.closedAt = now;
    }

    // Phantom guard: a fill without positive entry data is not a position.
    // The schema enforces positivity when present; this enforces presence.
    if (toState === "filled") {
      if (!(typeof updated.entryPrice === "number" && updated.entryPrice > 0) ||
          !(typeof updated.quantity === "number" && updated.quantity > 0)) {
        throw new InvalidStateError(
          `Cannot transition position ${positionId} to 'filled' without positive ` +
            `entryPrice/quantity (got entryPrice=${updated.entryPrice}, quantity=${updated.quantity})`,
          fromState,
          toState
        );
      }
    }

    updated = validateMergedPosition(updated, fromState);

    // Persist
    await this.store.save(updated);

    logger.info("Position transitioned", {
      id: positionId,
      from: fromState,
      to: toState,
      reason,
      agent,
    });

    // Emit the generic state_changed event
    await this.bus.emit({
      type: "position:state_changed" as const,
      timestamp: now,
      positionId,
      symbol: updated.symbol,
      fromState,
      toState,
      position: updated,
    });

    // Emit state-specific events
    await this.emitStateSpecificEvent(updated, fromState, toState, reason);

    return updated;
  }

  /**
   * Get a position by ID.
   */
  async getPosition(positionId: string): Promise<PositionRecord | null> {
    return this.store.get(positionId);
  }

  /**
   * Get all positions currently in the given state.
   */
  async getByState(state: PositionState): Promise<PositionRecord[]> {
    return this.store.getByState(state);
  }

  /**
   * Get all active (non-terminal) positions.
   */
  async getActive(): Promise<PositionRecord[]> {
    return this.store.getActive();
  }

  /**
   * Get all positions for a given symbol.
   */
  async getBySymbol(symbol: string): Promise<PositionRecord[]> {
    return this.store.getBySymbol(symbol);
  }

  /**
   * Update position data without changing state.
   * Useful for live price updates, trailing stop adjustments, etc.
   */
  async update(
    positionId: string,
    data: Partial<PositionRecord>
  ): Promise<PositionRecord> {
    const existing = await this.store.get(positionId);
    if (!existing) {
      throw new NotFoundError("Position", positionId);
    }

    // Prevent changing state via update() — use transition() instead
    if (data.state && data.state !== existing.state) {
      throw new InvalidStateError(
        "Cannot change state via update(). Use transition() instead.",
        existing.state,
        data.state
      );
    }

    const now = new Date().toISOString();
    const updated = validateMergedPosition({
      ...existing,
      ...data,
      state: existing.state, // preserve state
      id: existing.id,       // preserve id
      updatedAt: now,
    }, existing.state);

    await this.store.save(updated);

    // Emit an update event (non-state-change data update)
    await this.bus.emit({
      type: "position:updated" as const,
      timestamp: now,
      positionId,
      symbol: updated.symbol,
      updates: data,
    });

    return updated;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Emit state-specific events after a transition.
   */
  private async emitStateSpecificEvent(
    position: PositionRecord,
    fromState: PositionState,
    toState: PositionState,
    reason?: string
  ): Promise<void> {
    const now = new Date().toISOString();

    switch (toState) {
      case "filled":
        await this.bus.emit({
          type: "position:opened" as const,
          timestamp: now,
          positionId: position.id,
          symbol: position.symbol,
          entryPrice: position.entryPrice ?? 0,
          quantity: position.quantity ?? 0,
          position,
        });
        break;

      case "closed":
        await this.bus.emit({
          type: "position:closed" as const,
          timestamp: now,
          positionId: position.id,
          symbol: position.symbol,
          realizedPnL: position.realizedPnL ?? 0,
          position,
        });
        break;

      case "cancelled":
        await this.bus.emit({
          type: "position:cancelled" as const,
          timestamp: now,
          positionId: position.id,
          symbol: position.symbol,
          reason: reason ?? position.cancelReason ?? "No reason provided",
          fromState,
          position,
        });
        break;

      case "rejected":
        await this.bus.emit({
          type: "position:rejected" as const,
          timestamp: now,
          positionId: position.id,
          symbol: position.symbol,
          reason: reason ?? position.rejectReason ?? "No reason provided",
          position,
        });
        break;

      case "reviewed":
        if (position.review) {
          await this.bus.emit({
            type: "position:reviewed" as const,
            timestamp: now,
            positionId: position.id,
            symbol: position.symbol,
            review: position.review,
            position,
          });
        }
        break;

      // No additional events for other states (analyzed, planned, approved,
      // ordering, monitoring, closing) — the generic state_changed event covers them.
      default:
        break;
    }
  }
}
