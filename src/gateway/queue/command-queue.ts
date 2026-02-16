import { createModuleLogger } from "../../infra/logger/index.ts";
import type { GatewayCommandEnvelope, GatewayCommandType } from "../protocol/commands.ts";
import {
  enqueueCommand,
  dequeueNextCommand,
  getQueueDepth,
  markQueueCommandCompleted,
  markQueueCommandFailed,
} from "../store/command-queue-store.ts";
import { safeAppendAudit } from "../store/audit-log-store.ts";

const logger = createModuleLogger("gateway-command-queue");

export interface QueueBackpressureInfo {
  pending: number;
  running: number;
  failed: number;
  limit: number;
}

export type QueueEnqueueResult =
  | { ok: true; queueId: number }
  | { ok: false; error: "QUEUE_BACKPRESSURE"; info: QueueBackpressureInfo };

export interface GatewayCommandHandlerContext {
  queueId: number;
  envelope: GatewayCommandEnvelope;
}

export type GatewayCommandHandler = (ctx: GatewayCommandHandlerContext) => Promise<unknown>;

export interface CommandQueueOptions {
  maxPendingPerSession?: number;
  retryBackoffMs?: number;
}

export class CommandQueueManager {
  private handlers = new Map<GatewayCommandType, GatewayCommandHandler>();
  private sessionBusy = new Set<string>();
  private options: Required<CommandQueueOptions>;

  constructor(options: CommandQueueOptions = {}) {
    this.options = {
      maxPendingPerSession: options.maxPendingPerSession ?? 128,
      retryBackoffMs: options.retryBackoffMs ?? 1_000,
    };
  }

  registerHandler(type: GatewayCommandType, handler: GatewayCommandHandler): void {
    this.handlers.set(type, handler);
  }

  enqueue(envelope: GatewayCommandEnvelope, priority: number = 100): QueueEnqueueResult {
    const depth = getQueueDepth(envelope.meta.sessionId);
    if (depth.pending >= this.options.maxPendingPerSession) {
      return {
        ok: false,
        error: "QUEUE_BACKPRESSURE",
        info: {
          ...depth,
          limit: this.options.maxPendingPerSession,
        },
      };
    }

    const queueId = enqueueCommand({ envelope, priority });
    safeAppendAudit({
      eventType: "command.enqueued",
      actor: "queue",
      correlationId: envelope.meta.correlationId,
      payload: {
        queueId,
        commandType: envelope.command.type,
        sessionId: envelope.meta.sessionId,
      },
    });
    return { ok: true, queueId };
  }

  async processNext(sessionId: string): Promise<boolean> {
    if (this.sessionBusy.has(sessionId)) return false;
    this.sessionBusy.add(sessionId);

    try {
      const entry = dequeueNextCommand(sessionId);
      if (!entry) return false;

      const handler = this.handlers.get(entry.commandType as GatewayCommandType);
      if (!handler) {
        markQueueCommandFailed(entry.id, `No handler registered for ${entry.commandType}`);
        safeAppendAudit({
          eventType: "command.failed",
          actor: "queue",
          correlationId: entry.correlationId,
          payload: {
            queueId: entry.id,
            reason: "missing_handler",
            commandType: entry.commandType,
          },
        });
        return true;
      }

      try {
        await handler({ queueId: entry.id, envelope: entry.payload });
        markQueueCommandCompleted(entry.id);
        safeAppendAudit({
          eventType: "command.completed",
          actor: "queue",
          correlationId: entry.correlationId,
          payload: {
            queueId: entry.id,
            commandType: entry.commandType,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        markQueueCommandFailed(entry.id, message, this.options.retryBackoffMs);
        safeAppendAudit({
          eventType: "command.retry",
          actor: "queue",
          correlationId: entry.correlationId,
          payload: {
            queueId: entry.id,
            commandType: entry.commandType,
            error: message,
          },
        });
        logger.warn("Queue handler failed", {
          queueId: entry.id,
          commandType: entry.commandType,
          error: message,
        });
      }

      return true;
    } finally {
      this.sessionBusy.delete(sessionId);
    }
  }

  async drainSession(sessionId: string, maxIterations: number = 100): Promise<number> {
    let processed = 0;
    for (let i = 0; i < maxIterations; i++) {
      const didWork = await this.processNext(sessionId);
      if (!didWork) break;
      processed++;
    }
    return processed;
  }

  getDepth(sessionId: string): QueueBackpressureInfo {
    const depth = getQueueDepth(sessionId);
    return {
      ...depth,
      limit: this.options.maxPendingPerSession,
    };
  }
}

