import * as crypto from "node:crypto";

import type { GordonEvent } from "../../../events/types.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { isEnabled as isTelemetryConsentEnabled } from "../telemetry/telemetry.ts";

const logger = createModuleLogger("axiom-structured");

const DEFAULT_AXIOM_BASE_URL = "https://api.axiom.co";
const DEFAULT_EVENTS_DATASET = "gordon-events";
const DEFAULT_AUDIT_DATASET = "gordon-audit";
const DEFAULT_FLUSH_INTERVAL_MS = 15_000;
const DEFAULT_MAX_BATCH_SIZE = 100;
const MAX_QUEUE_SIZE = 1_000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 12;
const MAX_OBJECT_KEYS = 20;
const MAX_STRING_LENGTH = 240;

const SECRET_KEY_PATTERN =
  /(api[_-]?key|secret|token|authorization|bearer|password|private[_-]?key|credential|signature|passphrase)/i;
const IDENTITY_KEY_PATTERN =
  /(wallet(address)?|email|phone|ip(address)?|useragent|account(id)?|customer(id)?|recipient|facilitator|externalCustomerId)/i;
const RAW_FINANCIAL_KEY_PATTERN =
  /(balance|usdvalue|availablecash|free|locked|total|notional|amount|quantity|size|price|avgprice|cost)/i;
const STRUCTURED_ENABLED_ENV_KEY = "GORDON_AXIOM_STRUCTURED_ENABLED";
const HASH_SALT_ENV_KEY = "GORDON_AXIOM_HASH_SALT";

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

type StructuredRecord = Record<string, unknown>;

let config: StructuredAxiomConfig | null = null;
let initialized = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
const queueByDataset = new Map<string, StructuredRecord[]>();
const flushingDatasets = new Set<string>();
let missingTokenWarningShown = false;
let missingHashSaltWarningShown = false;

function areStructuredConfigsEquivalent(
  left: StructuredAxiomConfig | null,
  right: StructuredAxiomConfig,
): boolean {
  if (!left) return false;

  return (
    left.enabled === right.enabled
    && left.requested === right.requested
    && left.consentEnabled === right.consentEnabled
    && left.baseUrl === right.baseUrl
    && left.token === right.token
    && left.eventsDataset === right.eventsDataset
    && left.auditDataset === right.auditDataset
    && left.flushIntervalMs === right.flushIntervalMs
    && left.maxBatchSize === right.maxBatchSize
  );
}

function stopFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

function clearQueuedStructuredData(): void {
  queueByDataset.clear();
}

function startFlushTimer(intervalMs: number): void {
  stopFlushTimer();

  flushTimer = setInterval(() => {
    flushStructuredAxiom().catch(() => {});
  }, intervalMs);

  if (flushTimer.unref) {
    flushTimer.unref();
  }
}

function parseOtlpHeaders(raw?: string): Record<string, string> {
  if (!raw) return {};

  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return headers;
}

function extractBearerToken(raw?: string): string | null {
  const headers = parseOtlpHeaders(raw);
  const authHeader = Object.entries(headers).find(([key]) => key.toLowerCase() === "authorization")?.[1];
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function deriveBaseUrl(): string {
  if (process.env.GORDON_AXIOM_BASE_URL) {
    return process.env.GORDON_AXIOM_BASE_URL.replace(/\/+$/, "");
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Fall through to default
    }
  }

  return DEFAULT_AXIOM_BASE_URL;
}

export function getStructuredAxiomConfig(): StructuredAxiomConfig {
  const requested = process.env[STRUCTURED_ENABLED_ENV_KEY] === "true";
  const consentEnabled = isTelemetryConsentEnabled();
  return {
    enabled: requested && consentEnabled,
    requested,
    consentEnabled,
    baseUrl: deriveBaseUrl(),
    token: process.env.GORDON_AXIOM_TOKEN || extractBearerToken(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    eventsDataset: process.env.GORDON_AXIOM_EVENTS_DATASET || DEFAULT_EVENTS_DATASET,
    auditDataset: process.env.GORDON_AXIOM_AUDIT_DATASET || DEFAULT_AUDIT_DATASET,
    flushIntervalMs: Number(process.env.GORDON_AXIOM_FLUSH_INTERVAL_MS || DEFAULT_FLUSH_INTERVAL_MS),
    maxBatchSize: Number(process.env.GORDON_AXIOM_MAX_BATCH_SIZE || DEFAULT_MAX_BATCH_SIZE),
  };
}

export function getStructuredAxiomPrivacyStatus(): {
  enabled: boolean;
  requested: boolean;
  consentEnabled: boolean;
  configured: boolean;
  hashSaltConfigured: boolean;
} {
  const currentConfig = reconcileStructuredAxiomState();
  return {
    enabled: currentConfig.enabled,
    requested: currentConfig.requested,
    consentEnabled: currentConfig.consentEnabled,
    configured: Boolean(currentConfig.token),
    hashSaltConfigured: Boolean(process.env[HASH_SALT_ENV_KEY]),
  };
}

function reconcileStructuredAxiomState(options?: {
  logTransitions?: boolean;
  clearQueueOnDisable?: boolean;
}): StructuredAxiomConfig {
  const nextConfig = getStructuredAxiomConfig();
  const previousConfig = config;

  config = nextConfig;
  initialized = true;

  if (!nextConfig.enabled) {
    stopFlushTimer();
    if (options?.clearQueueOnDisable) {
      clearQueuedStructuredData();
    }
    if (options?.logTransitions && !areStructuredConfigsEquivalent(previousConfig, nextConfig)) {
      if (!nextConfig.requested) {
        logger.debug("Structured Axiom export disabled");
      } else if (!nextConfig.consentEnabled) {
        logger.debug("Structured Axiom export blocked until telemetry consent is enabled");
      }
    }
    return nextConfig;
  }

  if (!nextConfig.token) {
    stopFlushTimer();
    if (!missingTokenWarningShown) {
      logger.warn("Structured Axiom export enabled but no Axiom token is configured");
      missingTokenWarningShown = true;
    }
    return nextConfig;
  }

  if (!process.env[HASH_SALT_ENV_KEY] && !missingHashSaltWarningShown) {
    logger.warn(
      "Structured Axiom export enabled without GORDON_AXIOM_HASH_SALT; hashed refs will be omitted until you configure it.",
    );
    missingHashSaltWarningShown = true;
  }

  if (
    !flushTimer
    || previousConfig?.flushIntervalMs !== nextConfig.flushIntervalMs
  ) {
    startFlushTimer(nextConfig.flushIntervalMs);
  }

  if (options?.logTransitions && !areStructuredConfigsEquivalent(previousConfig, nextConfig)) {
    logger.info("Structured Axiom export initialized", {
      eventsDataset: nextConfig.eventsDataset,
      auditDataset: nextConfig.auditDataset,
      baseUrl: nextConfig.baseUrl,
    });
  }

  return nextConfig;
}

export function initializeStructuredAxiom(): void {
  reconcileStructuredAxiomState({ logTransitions: true });
}

export function refreshStructuredAxiomState(options?: {
  clearQueueOnDisable?: boolean;
}): void {
  reconcileStructuredAxiomState({
    logTransitions: true,
    clearQueueOnDisable: options?.clearQueueOnDisable,
  });
}

function ensureInitialized(): void {
  reconcileStructuredAxiomState();
}

export async function shutdownStructuredAxiom(): Promise<void> {
  if (!initialized) return;

  stopFlushTimer();

  await flushStructuredAxiom();
  initialized = false;
}

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
  const currentConfig = reconcileStructuredAxiomState();

  return {
    initialized,
    enabled: currentConfig.enabled,
    requested: currentConfig.requested,
    consentEnabled: currentConfig.consentEnabled,
    configured: Boolean(currentConfig.token),
    eventsDataset: currentConfig.requested ? currentConfig.eventsDataset : null,
    auditDataset: currentConfig.requested ? currentConfig.auditDataset : null,
    queuedEvents: queueByDataset.get(currentConfig.eventsDataset)?.length ?? 0,
    queuedAudit: queueByDataset.get(currentConfig.auditDataset)?.length ?? 0,
  };
}

function hashIdentifier(value?: string | null): string | undefined {
  if (!value) return undefined;

  const salt = process.env[HASH_SALT_ENV_KEY];
  if (!salt) return undefined;

  return crypto
    .createHash("sha256")
    .update(salt)
    .update(value)
    .digest("hex")
    .slice(0, 16);
}

function truncateString(value: string): string {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
}

function bucketSignedPercent(value?: number | null): string | undefined {
  if (value == null || Number.isNaN(value)) return undefined;
  if (value <= -20) return "<=-20%";
  if (value <= -10) return "-20%..-10%";
  if (value <= -5) return "-10%..-5%";
  if (value < 0) return "-5%..0%";
  if (value === 0) return "0%";
  if (value < 5) return "0%..5%";
  if (value < 10) return "5%..10%";
  if (value < 20) return "10%..20%";
  return ">=20%";
}

function bucketRatio(value?: number | null): string | undefined {
  if (value == null || Number.isNaN(value)) return undefined;
  if (value < 0.01) return "<1%";
  if (value < 0.05) return "1%..5%";
  if (value < 0.1) return "5%..10%";
  if (value < 0.25) return "10%..25%";
  if (value < 0.5) return "25%..50%";
  return ">=50%";
}

function bucketCount(value?: number | null): string | undefined {
  if (value == null || Number.isNaN(value)) return undefined;
  if (value <= 0) return "0";
  if (value === 1) return "1";
  if (value <= 3) return "2-3";
  if (value <= 5) return "4-5";
  if (value <= 10) return "6-10";
  return "10+";
}

function omitKeys<T extends Record<string, unknown>>(value: T, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!keys.includes(key)) {
      result[key] = entry;
    }
  }
  return result;
}

function getByPath(input: unknown, path: string): unknown {
  if (!input || typeof input !== "object") return undefined;

  let current: unknown = input;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function firstString(input: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getByPath(input, path);
    if (typeof value === "string" && value.trim()) {
      return truncateString(value.trim());
    }
  }
  return undefined;
}

function firstNumber(input: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = getByPath(input, path);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function sanitizeValue(value: unknown, keyHint?: string, depth: number = 0): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return "[truncated]";

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, keyHint, depth + 1));
  }

  if (typeof value !== "object") {
    return String(value);
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
  for (const [key, entry] of entries) {
    if (SECRET_KEY_PATTERN.test(key) || IDENTITY_KEY_PATTERN.test(key)) {
      result[key] = "[redacted]";
      continue;
    }

    if (RAW_FINANCIAL_KEY_PATTERN.test(key)) {
      result[key] = "[omitted]";
      continue;
    }

    result[key] = sanitizeValue(entry, key, depth + 1);
  }

  return result;
}

function deriveOutcomeFromLabel(label: string): string {
  if (/(failed|error|denied|blocked|rejected)/i.test(label)) return "failure";
  if (/(cancelled|stopped|paused)/i.test(label)) return "cancelled";
  if (/(approved|completed|opened|closed|created|started|resumed|hit)/i.test(label)) return "success";
  return "info";
}

function normalizeSymbolicToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeReasonCode(value?: string): string | undefined {
  if (!value) return undefined;

  const raw = value.trim();
  if (!raw) return undefined;

  if (/^[a-z0-9]+(?:[_:-][a-z0-9]+)*$/i.test(raw)) {
    return normalizeSymbolicToken(raw);
  }

  const normalized = raw.toLowerCase();

  if (normalized.includes("plan not found")) return "plan_not_found";
  if (normalized.includes("context not available")) return "context_unavailable";
  if (normalized.includes("safe mode")) return "safe_mode_blocked";
  if (normalized.includes("not armed") || normalized.includes("arm the system first")) return "arming_required";
  if (normalized.includes("circuit breaker")) return "circuit_breaker_tripped";
  if (normalized.includes("high latency")) return "high_latency";
  if (normalized.includes("pong timeout")) return "pong_timeout";
  if (normalized.includes("reconnect")) return "reconnect_exhausted";
  if (normalized.includes("rate limit") || normalized.includes("cooldown period")) return "rate_limited";
  if (normalized.includes("permission")) return "permission_denied";
  if (normalized.includes("invalid") && normalized.includes("status")) return "invalid_state";
  if (normalized.includes("not configured")) {
    if (normalized.includes("exchange") || normalized.includes("venue")) return "exchange_not_configured";
    if (normalized.includes("broker")) return "broker_not_configured";
    if (normalized.includes("llm") || normalized.includes("provider")) return "llm_not_configured";
    return "not_configured";
  }
  if (
    normalized.includes("unauthorized")
    || normalized.includes("forbidden")
    || normalized.includes("signature")
    || normalized.includes("credential")
    || normalized.includes("api key")
    || normalized.includes("key/secret")
    || normalized.includes("auth")
  ) {
    return "auth_failed";
  }
  if (
    normalized.includes("internet connection")
    || normalized.includes("could not connect")
    || normalized.includes("network")
    || normalized.includes("connection")
    || normalized.includes("fetch failed")
    || normalized.includes("econn")
    || normalized.includes("enotfound")
  ) {
    return "network_error";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "timeout";
  if (normalized.includes("validation")) return "validation_failed";
  if (normalized.includes("blocked")) return "blocked";
  if (normalized.includes("revoked")) return "revoked";

  return "other";
}

function projectEventRecord(event: GordonEvent): StructuredRecord {
  const details = omitKeys(event as unknown as Record<string, unknown>, ["type", "timestamp"]);
  const reasonCode = normalizeReasonCode(firstString(details, ["reason", "error", "message"]));
  return {
    _time: event.timestamp,
    record_type: "product_event",
    service: process.env.OTEL_SERVICE_NAME || "gordon-trading",
    event_type: event.type,
    event_family: event.type.split(":")[0] ?? event.type,
    outcome: deriveOutcomeFromLabel(event.type),
    symbol: firstString(details, ["symbol", "trade.symbol", "plan.symbol", "position.symbol"]),
    strategy: firstString(details, ["strategy", "trade.strategy", "plan.strategy"]),
    timeframe: firstString(details, ["timeframe", "plan.timeframe"]),
    mode: firstString(details, ["mode"]),
    reason: reasonCode,
    agent: firstString(details, ["agent"]),
    from_agent: firstString(details, ["fromAgent"]),
    to_agent: firstString(details, ["toAgent"]),
    tool_name: firstString(details, ["toolName", "tool", "metadata.tool"]),
    provider: firstString(details, ["provider", "metadata.provider"]),
    model: firstString(details, ["model", "metadata.model"]),
    workflow: firstString(details, ["workflow", "phase"]),
    universe: firstString(details, ["universe"]),
    exchange: firstString(details, ["exchange", "exchangeId"]),
    broker: firstString(details, ["broker", "brokerId"]),
    venue: firstString(details, ["venue", "exchange", "broker"]),
    wallet_provider: firstString(details, ["walletProvider", "walletProviderId"]),
    payment_provider: firstString(details, ["paymentProvider", "paymentProviderId"]),
    opportunity_count: firstNumber(details, ["opportunitiesFound", "opportunityCount", "count"]),
    position_count: firstNumber(details, ["openPositions", "positionsCount"]),
    pnl_band: bucketSignedPercent(firstNumber(details, ["pnlPercent", "trade.pnlPercent"])),
    allocation_band: bucketRatio(
      firstNumber(details, [
        "allocation.percentOfPortfolio",
        "plan.allocation.percentOfPortfolio",
      ]),
    ),
    detail_count_bucket: bucketCount(Object.keys(details).length),
    has_trade: Boolean((details as Record<string, unknown>).trade),
    has_plan: Boolean((details as Record<string, unknown>).plan),
    details: sanitizeValue(details),
  };
}

function projectAuditRecord(entry: StructuredAuditEntryInput): StructuredRecord {
  const auditSource = {
    parameters: entry.parameters,
    metadata: entry.metadata ?? {},
  };
  const reasonCode = normalizeReasonCode(entry.resultDetails);

  return {
    _time: entry.timestamp,
    record_type: "audit_event",
    service: process.env.OTEL_SERVICE_NAME || "gordon-trading",
    action: entry.action,
    result: entry.result,
    outcome: deriveOutcomeFromLabel(entry.result),
    actor_hash: hashIdentifier(entry.userId),
    session_hash: hashIdentifier(entry.sessionId),
    plan_ref: hashIdentifier(entry.planId),
    trade_ref: hashIdentifier(entry.tradeId),
    symbol: firstString(auditSource, [
      "parameters.symbol",
      "parameters.trade.symbol",
      "parameters.plan.symbol",
      "metadata.symbol",
    ]),
    tool_name: firstString(auditSource, ["parameters.toolName", "parameters.tool", "metadata.tool"]),
    mode: firstString(auditSource, ["parameters.mode", "metadata.mode"]),
    reason: reasonCode,
    parameters: sanitizeValue(entry.parameters),
    metadata: sanitizeValue(entry.metadata ?? {}),
  };
}

function projectSessionCostRecord(entry: StructuredSessionCostInput): StructuredRecord {
  return {
    _time: entry.updatedAt,
    record_type: "session_cost",
    service: process.env.OTEL_SERVICE_NAME || "gordon-trading",
    event_type: "session_cost_updated",
    thread_ref: hashIdentifier(entry.threadId),
    session_hash: hashIdentifier(entry.sessionId),
    resource_ref: hashIdentifier(entry.resourceId),
    provider: entry.provider,
    model: entry.model ?? undefined,
    request_count: entry.requestCount,
    prompt_tokens: entry.promptTokens,
    completion_tokens: entry.completionTokens,
    total_tokens: entry.totalTokens,
  };
}

function projectObservationRecord(entry: StructuredObservationInput): StructuredRecord {
  const details = entry.details ?? {};
  const reasonCode = normalizeReasonCode(entry.reason);

  return {
    _time: entry.timestamp ?? new Date().toISOString(),
    record_type: "structured_observation",
    service: process.env.OTEL_SERVICE_NAME || "gordon-trading",
    event_type: entry.eventType,
    event_family: entry.workflow ?? entry.eventType.split(".")[0] ?? entry.eventType,
    outcome: entry.outcome ?? deriveOutcomeFromLabel(entry.eventType),
    workflow: entry.workflow,
    source: entry.source,
    component: entry.component,
    status: entry.status,
    step: entry.step,
    mode: entry.mode,
    provider: entry.provider,
    model: entry.model ?? undefined,
    exchange: entry.exchange,
    broker: entry.broker,
    venue: entry.venue ?? entry.exchange ?? entry.broker,
    symbol: entry.symbol,
    tool_name: entry.toolName,
    reason: reasonCode,
    actor_hash: hashIdentifier(entry.userId),
    session_hash: hashIdentifier(entry.sessionId),
    thread_ref: hashIdentifier(entry.threadId),
    plan_ref: hashIdentifier(entry.planId),
    trade_ref: hashIdentifier(entry.tradeId),
    healthy: entry.healthy,
    ready: entry.ready,
    attempt: entry.attempt,
    action_count: entry.actionCount,
    warning_count: entry.warningCount,
    critical_count: entry.criticalCount,
    blocker_count: entry.blockerCount,
    selected_count: entry.selectedCount,
    missing_count: entry.missingCount,
    latency_ms: entry.latencyMs,
    duration_ms: entry.durationMs,
    detail_count_bucket: bucketCount(Object.keys(details).length),
    details: sanitizeValue(details),
  };
}

function enqueue(dataset: string, record: StructuredRecord): void {
  ensureInitialized();

  if (!config?.enabled || !config.token) return;

  const queue = queueByDataset.get(dataset) ?? [];
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift();
  }

  queue.push(record);
  queueByDataset.set(dataset, queue);

  if (queue.length >= config.maxBatchSize) {
    void flushDataset(dataset);
  }
}

function requeueFront(dataset: string, records: StructuredRecord[]): void {
  const current = queueByDataset.get(dataset) ?? [];
  const merged = [...records, ...current].slice(0, MAX_QUEUE_SIZE);
  queueByDataset.set(dataset, merged);
}

async function flushDataset(dataset: string): Promise<void> {
  if (!config?.enabled || !config.token) return;
  if (flushingDatasets.has(dataset)) return;

  const queue = queueByDataset.get(dataset);
  if (!queue || queue.length === 0) return;

  const batch = queue.splice(0, config.maxBatchSize);
  if (batch.length === 0) return;

  queueByDataset.set(dataset, queue);
  flushingDatasets.add(dataset);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${config.baseUrl}/v1/datasets/${dataset}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.token}`,
        "X-Axiom-Dataset": dataset,
      },
      body: JSON.stringify(batch),
      signal: controller.signal,
    });

    if (!res.ok) {
      requeueFront(dataset, batch);
      logger.warn("Structured Axiom batch flush failed", { dataset, status: res.status });
    }
  } catch (error) {
    requeueFront(dataset, batch);
    logger.debug("Structured Axiom flush error", {
      dataset,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
    flushingDatasets.delete(dataset);
  }
}

export async function flushStructuredAxiom(): Promise<void> {
  ensureInitialized();
  if (!config?.enabled || !config.token) return;

  const datasets = [...queueByDataset.keys()];
  for (const dataset of datasets) {
    await flushDataset(dataset);
  }
}

export function recordStructuredProductEvent(event: GordonEvent): void {
  const currentConfig = reconcileStructuredAxiomState();
  if (!currentConfig.enabled) return;

  enqueue(currentConfig.eventsDataset, projectEventRecord(event));
}

export function recordStructuredAuditEvent(entry: StructuredAuditEntryInput): void {
  const currentConfig = reconcileStructuredAxiomState();
  if (!currentConfig.enabled) return;

  enqueue(currentConfig.auditDataset, projectAuditRecord(entry));
}

export function recordStructuredSessionCost(entry: StructuredSessionCostInput): void {
  const currentConfig = reconcileStructuredAxiomState();
  if (!currentConfig.enabled) return;

  enqueue(currentConfig.eventsDataset, projectSessionCostRecord(entry));
}

export function recordStructuredObservation(entry: StructuredObservationInput): void {
  const currentConfig = reconcileStructuredAxiomState();
  if (!currentConfig.enabled) return;

  enqueue(currentConfig.eventsDataset, projectObservationRecord(entry));
}
