/**
 * Structured observation seam (local no-op).
 *
 * This module previously projected product events / audit entries / session
 * costs / observations into privacy-scrubbed records and shipped them to an
 * external Axiom dataset over HTTP. That external export has been removed from
 * this open-source build.
 *
 * The exported surface is preserved so the ~40 call sites
 * (`recordStructuredObservation`, `recordStructuredProductEvent`,
 * `recordStructuredSessionCost`, `recordStructuredAuditEvent`) and the
 * `/telemetry` status readouts keep compiling. Every record call is now a
 * no-op; local structured logging lives in `src/infra/logger/logger.ts`.
 */

import type { GordonEvent } from "../../../events/types.ts";

export interface StructuredAxiomConfig {
  enabled: boolean;
  requested: boolean;
  consentEnabled: boolean;
  baseUrl: string;
  token: string | null;
  eventsDataset: string;
  auditDataset: string;
  flushIntervalMs: number;
  maxBatchSize: number;
}

export interface StructuredObservationInput {
  timestamp?: string;
  eventType: string;
  outcome?: "success" | "failure" | "info" | "cancelled";
  workflow?: string;
  source?: string;
  component?: string;
  status?: string;
  /**
   * For `execution.blocked` events: whether the block is due to a
   * harness gate (controllable — worth fixing in our code) or an
   * environment / external-state failure (uncontrollable — out of
   * harness scope). Lets the eval review queue filter regressions
   * worth fixing from environment noise. See HALO Terminal-Bench
   * note in `infra/observability/blockedClassification.ts`.
   */
  controllability?: "controllable" | "uncontrollable";
  step?: string;
  mode?: string;
  provider?: string;
  model?: string | null;
  exchange?: string;
  broker?: string;
  venue?: string;
  symbol?: string;
  toolName?: string;
  reason?: string;
  userId?: string;
  sessionId?: string;
  threadId?: string;
  planId?: string;
  tradeId?: string;
  healthy?: boolean;
  ready?: boolean;
  attempt?: number;
  actionCount?: number;
  warningCount?: number;
  criticalCount?: number;
  blockerCount?: number;
  selectedCount?: number;
  missingCount?: number;
  latencyMs?: number;
  durationMs?: number;
  details?: Record<string, unknown>;
}

interface StructuredAuditEntryInput {
  timestamp: string;
  userId: string;
  action: string;
  parameters: Record<string, unknown>;
  result: string;
  resultDetails?: string;
  sessionId?: string;
  tradeId?: string;
  planId?: string;
  metadata?: Record<string, unknown>;
}

interface StructuredSessionCostInput {
  threadId: string;
  sessionId?: string;
  resourceId?: string;
  provider?: string;
  model?: string | null;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  updatedAt: string;
}

const DISABLED_CONFIG: StructuredAxiomConfig = {
  enabled: false,
  requested: false,
  consentEnabled: false,
  baseUrl: "",
  token: null,
  eventsDataset: "",
  auditDataset: "",
  flushIntervalMs: 0,
  maxBatchSize: 0,
};

export function getStructuredAxiomConfig(): StructuredAxiomConfig {
  return { ...DISABLED_CONFIG };
}

export function getStructuredAxiomPrivacyStatus(): {
  enabled: boolean;
  requested: boolean;
  consentEnabled: boolean;
  configured: boolean;
  hashSaltConfigured: boolean;
} {
  return {
    enabled: false,
    requested: false,
    consentEnabled: false,
    configured: false,
    hashSaltConfigured: false,
  };
}

export function initializeStructuredAxiom(): void {}

export function refreshStructuredAxiomState(_options?: {
  clearQueueOnDisable?: boolean;
}): void {}

export async function shutdownStructuredAxiom(): Promise<void> {}

export function getStructuredAxiomStatus(): {
  initialized: boolean;
  enabled: boolean;
  requested: boolean;
  consentEnabled: boolean;
  configured: boolean;
  eventsDataset: string | null;
  auditDataset: string | null;
  queuedEvents: number;
  queuedAudit: number;
} {
  return {
    initialized: false,
    enabled: false,
    requested: false,
    consentEnabled: false,
    configured: false,
    eventsDataset: null,
    auditDataset: null,
    queuedEvents: 0,
    queuedAudit: 0,
  };
}

export async function flushStructuredAxiom(): Promise<void> {}

export function recordStructuredProductEvent(_event: GordonEvent): void {}

export function recordStructuredAuditEvent(_entry: StructuredAuditEntryInput): void {}

export function recordStructuredSessionCost(_entry: StructuredSessionCostInput): void {}

export function recordStructuredObservation(_entry: StructuredObservationInput): void {}
