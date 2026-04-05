import { emitEvent } from "../../../events/index.ts";
import { validateHandoffBudget } from "../../../gateway/handoffs/index.ts";
import { recordNetworkRouting } from "../../platform/observability/index.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { WorkerRegistry } from "../../../runtime/workers/WorkerRegistry.ts";

const logger = createModuleLogger("handoff-coordinator");

export interface HandoffRecord {
  handoffId: string;
  fromAgent: string;
  toAgent: string;
  timestamp: number;
  validated: boolean;
  validationReason?: string;
  metadata?: Record<string, unknown>;
}

export interface HandoffValidation {
  valid: boolean;
  reason?: string;
  warnings?: string[];
}

export class HandoffCoordinator {
  private readonly workerRegistry: WorkerRegistry;
  private readonly history: HandoffRecord[] = [];
  private counter = 0;

  constructor(workerRegistry: WorkerRegistry = new WorkerRegistry()) {
    this.workerRegistry = workerRegistry;
  }

  getValidHandoffRules(): Record<string, string[]> {
    return this.workerRegistry.list().reduce<Record<string, string[]>>((acc, definition) => {
      acc[definition.name] = [...definition.handoffTargets];
      return acc;
    }, {});
  }

  validate(fromAgent: string, toAgent: string, context?: Record<string, unknown>): HandoffValidation {
    const warnings: string[] = [];
    if (!this.workerRegistry.has(fromAgent)) {
      return {
        valid: false,
        reason: `Unknown source agent: ${fromAgent}`,
      };
    }
    if (!this.workerRegistry.has(toAgent)) {
      return {
        valid: false,
        reason: `Unknown target agent: ${toAgent}`,
      };
    }
    if (!this.workerRegistry.canHandoff(fromAgent, toAgent)) {
      const allowedTargets = this.workerRegistry.get(fromAgent)?.handoffTargets ?? [];
      return {
        valid: false,
        reason: `Handoff from ${fromAgent} to ${toAgent} is not allowed. Allowed targets: ${allowedTargets.join(", ")}`,
      };
    }

    const recentHandoffs = this.history.slice(-10);
    const circularCount = recentHandoffs.filter(
      (handoff) => handoff.fromAgent === toAgent && handoff.toAgent === fromAgent,
    ).length;
    if (circularCount >= 3) {
      return {
        valid: false,
        reason: `Blocked circular handoff loop between ${fromAgent} and ${toAgent} (${circularCount} consecutive round-trips detected)`,
      };
    }

    const lastSecondHandoffs = this.history.filter((handoff) => Date.now() - handoff.timestamp < 1000);
    if (lastSecondHandoffs.length >= 5) {
      return {
        valid: false,
        reason: "Blocked: high handoff frequency detected (5+ handoffs in 1 second). Possible infinite loop.",
      };
    }

    if (toAgent === "Executor" && context?.permissionMode === "strict") {
      warnings.push("Handoff to Executor while permissionMode is 'strict' (read-only)");
    }

    const budgetValidation = validateHandoffBudget({
      fromAgent,
      toAgent,
      metadata: context,
    });
    if (!budgetValidation.valid) {
      return {
        valid: false,
        reason: budgetValidation.reason || "Handoff budget validation failed.",
      };
    }
    if (budgetValidation.warnings && budgetValidation.warnings.length > 0) {
      warnings.push(...budgetValidation.warnings);
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  async track(fromAgent: string, toAgent: string, metadata?: Record<string, unknown>): Promise<HandoffRecord> {
    const handoffId = `handoff_${Date.now()}_${++this.counter}`;
    const validation = this.validate(fromAgent, toAgent, metadata);
    const record: HandoffRecord = {
      handoffId,
      fromAgent,
      toAgent,
      timestamp: Date.now(),
      validated: validation.valid,
      validationReason: validation.reason,
      metadata,
    };
    this.history.push(record);
    recordNetworkRouting(fromAgent, toAgent);
    if (this.history.length > 100) {
      this.history.shift();
    }

    await emitEvent("agent:handoff_ack", {
      fromAgent,
      toAgent,
      validated: validation.valid,
      reason: validation.reason || validation.warnings?.join("; "),
      handoffId,
    });

    if (validation.valid) {
      logger.info("Agent handoff tracked", {
        handoffId,
        fromAgent,
        toAgent,
        warnings: validation.warnings,
      });
    } else {
      logger.warn("Invalid agent handoff attempted", {
        handoffId,
        fromAgent,
        toAgent,
        reason: validation.reason,
      });
    }

    return record;
  }

  getHistory(limit: number = 20): HandoffRecord[] {
    return this.history.slice(-limit);
  }

  clear(): void {
    this.history.length = 0;
    this.counter = 0;
  }
}

export const defaultHandoffCoordinator = new HandoffCoordinator();
