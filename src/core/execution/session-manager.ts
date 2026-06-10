/**
 * Execution Session Manager
 *
 * Manages the lifecycle of algorithmic execution sessions (TWAP, VWAP, Iceberg).
 * Singleton — coordinates all active sessions, provides session persistence,
 * and handles daemon recovery.
 */

import type { Exchange } from "../../infra/exchange/types.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { TWAPExecutor } from "./algorithms/twap.ts";
import { VWAPExecutor } from "./algorithms/vwap.ts";
import { IcebergExecutor } from "./algorithms/iceberg.ts";
import { POVExecutor } from "./algorithms/pov.ts";
import type {
  ExecutionIntent,
  ExecutionSession,
  TWAPConfig,
  VWAPConfig,
  IcebergConfig,
  POVConfig,
} from "./algorithms/types.ts";
import {
  DEFAULT_TWAP_CONFIG,
  DEFAULT_VWAP_CONFIG,
  DEFAULT_ICEBERG_CONFIG,
  DEFAULT_POV_CONFIG,
} from "./algorithms/types.ts";

const logger = createModuleLogger("execution-session-manager");
const MAX_COMPLETED_SESSIONS = 100;

export class ExecutionSessionManager {
  private static instance: ExecutionSessionManager;

  private activeSessions = new Map<string, {
    session: ExecutionSession;
    executor: TWAPExecutor | VWAPExecutor | IcebergExecutor | POVExecutor;
  }>();
  private completedSessions: ExecutionSession[] = [];

  private constructor() {}

  static getInstance(): ExecutionSessionManager {
    if (!ExecutionSessionManager.instance) {
      ExecutionSessionManager.instance = new ExecutionSessionManager();
    }
    return ExecutionSessionManager.instance;
  }

  private recordCompletedSession(session: ExecutionSession): void {
    this.completedSessions.push(session);
    if (this.completedSessions.length > MAX_COMPLETED_SESSIONS) {
      this.completedSessions = this.completedSessions.slice(-MAX_COMPLETED_SESSIONS);
    }
  }

  /**
   * Start a new execution session.
   */
  async startSession(
    intent: ExecutionIntent,
    exchange: Exchange,
  ): Promise<ExecutionSession> {
    const sessionId = crypto.randomUUID();

    const session: ExecutionSession = {
      sessionId,
      intent,
      status: "running",
      slicesFilled: 0,
      slicesTotal: 0,
      quantityFilled: 0,
      totalQuantity: intent.totalQuantity,
      avgFillPrice: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      childOrderIds: [],
    };

    const onComplete = (completed: ExecutionSession) => {
      this.activeSessions.delete(sessionId);
      this.recordCompletedSession(completed);
    };

    let executor: TWAPExecutor | VWAPExecutor | IcebergExecutor | POVExecutor;

    switch (intent.algorithm) {
      case "TWAP": {
        const config: TWAPConfig = { ...DEFAULT_TWAP_CONFIG, ...intent.config as Partial<TWAPConfig> };
        executor = new TWAPExecutor(session, exchange, config, onComplete);
        break;
      }
      case "VWAP": {
        const config: VWAPConfig = { ...DEFAULT_VWAP_CONFIG, ...intent.config as Partial<VWAPConfig> };
        executor = new VWAPExecutor(session, exchange, config, onComplete);
        break;
      }
      case "ICEBERG": {
        const config: IcebergConfig = { ...DEFAULT_ICEBERG_CONFIG, ...intent.config as Partial<IcebergConfig> };
        executor = new IcebergExecutor(session, exchange, config, onComplete);
        break;
      }
      case "POV": {
        const config: POVConfig = { ...DEFAULT_POV_CONFIG, ...intent.config as Partial<POVConfig> };
        executor = new POVExecutor(session, exchange, config, onComplete);
        break;
      }
    }

    this.activeSessions.set(sessionId, { session, executor });

    // Start execution (async, returns immediately)
    executor.start().catch((error) => {
      session.status = "failed";
      session.error = (error as Error).message;
      session.updatedAt = new Date().toISOString();
      this.activeSessions.delete(sessionId);
      this.recordCompletedSession(session);
      logger.error("Execution session failed to start", error as Error, { sessionId });
    });

    logger.info("Execution session started", {
      sessionId,
      algorithm: intent.algorithm,
      symbol: intent.symbol,
      side: intent.side,
      totalQuantity: intent.totalQuantity,
    });

    return session;
  }

  /**
   * Get a session by ID (active or completed).
   */
  getSession(sessionId: string): ExecutionSession | null {
    const active = this.activeSessions.get(sessionId);
    if (active) return active.executor.getSession();

    return this.completedSessions.find((s) => s.sessionId === sessionId) ?? null;
  }

  /**
   * List all sessions.
   */
  listSessions(filter?: { status?: string }): ExecutionSession[] {
    const all: ExecutionSession[] = [];

    for (const { executor } of this.activeSessions.values()) {
      all.push(executor.getSession());
    }
    all.push(...this.completedSessions);

    if (filter?.status) {
      return all.filter((s) => s.status === filter.status);
    }

    return all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  /**
   * Pause an active session.
   */
  async pauseSession(sessionId: string): Promise<boolean> {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) return false;
    await entry.executor.pause();
    return true;
  }

  /**
   * Resume a paused session.
   */
  async resumeSession(sessionId: string): Promise<boolean> {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) return false;
    await entry.executor.resume();
    return true;
  }

  /**
   * Cancel an active session.
   */
  async cancelSession(sessionId: string): Promise<boolean> {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) return false;
    await entry.executor.cancel();
    return true;
  }

  /**
   * Get count of active sessions.
   */
  getActiveCount(): number {
    return this.activeSessions.size;
  }
}
