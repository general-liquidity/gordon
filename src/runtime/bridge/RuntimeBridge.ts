import { randomUUID } from "node:crypto";

import type { RuntimeBridgeSession } from "../contracts/types.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";

export interface RuntimeBridgeStartInput {
  runtimeId: string;
  sessionId?: string;
  source: string;
  commandType: string;
  correlationId?: string;
  requestId?: string;
  detail?: string;
}

export class RuntimeBridge {
  private readonly runtimeStore: RuntimeStore;

  constructor(runtimeStore: RuntimeStore) {
    this.runtimeStore = runtimeStore;
  }

  begin(input: RuntimeBridgeStartInput): RuntimeBridgeSession {
    const now = new Date().toISOString();
    const session: RuntimeBridgeSession = {
      id: randomUUID(),
      runtimeId: input.runtimeId,
      sessionId: input.sessionId,
      source: input.source,
      commandType: input.commandType,
      correlationId: input.correlationId,
      requestId: input.requestId,
      detail: input.detail,
      status: "active",
      startedAt: now,
      updatedAt: now,
    };

    const state = this.runtimeStore.getState();
    this.runtimeStore.setBridgeState({
      active: [session, ...state.bridge.active].slice(0, 20),
      recent: [session, ...state.bridge.recent.filter((entry) => entry.id !== session.id)].slice(0, 50),
    });
    this.runtimeStore.setRemoteState({
      connectionStatus: "connected",
      reachable: true,
      actor: input.source,
      detail: input.detail ?? input.commandType,
    });
    return session;
  }

  complete(id: string, detail?: string): RuntimeBridgeSession | null {
    return this.transition(id, "completed", detail);
  }

  fail(id: string, detail?: string): RuntimeBridgeSession | null {
    return this.transition(id, "failed", detail);
  }

  private transition(
    id: string,
    status: RuntimeBridgeSession["status"],
    detail?: string,
  ): RuntimeBridgeSession | null {
    const state = this.runtimeStore.getState();
    const current = state.bridge.active.find((entry) => entry.id === id)
      ?? state.bridge.recent.find((entry) => entry.id === id);
    if (!current) {
      return null;
    }

    const next: RuntimeBridgeSession = {
      ...current,
      status,
      detail: detail ?? current.detail,
      updatedAt: new Date().toISOString(),
    };
    this.runtimeStore.setBridgeState({
      active: state.bridge.active.filter((entry) => entry.id !== id),
      recent: [next, ...state.bridge.recent.filter((entry) => entry.id !== id)].slice(0, 50),
    });
    this.runtimeStore.setRemoteState({
      connectionStatus: status === "failed" ? "degraded" : "connected",
      reachable: true,
      actor: current.source,
      detail: detail ?? current.commandType,
    });
    return next;
  }
}
