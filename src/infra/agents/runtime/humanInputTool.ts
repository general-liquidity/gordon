/**
 * Human Input Tool (GORDON_HUMAN_INPUT_TOOL).
 *
 * Port of factor 7 from HumanLayer's "12 Factor Agents" (2026):
 *
 *   "Contact Humans with Tool Calls — treat human contact as a structured
 *    tool call, enabling interruption and resumption of workflows."
 *
 * Distinct from Gordon's `PermissionEngine` (which gates risky tool
 * calls for *safety*): this primitive lets the agent ask the operator
 * a *content* question — symbol choice, exit timing, mandate-scope
 * confirmation, strategy preference — pause the loop, and resume with
 * the answer in context.
 *
 * Two halves:
 *
 *   - Agent side: `createRequest(...)` opens a pending question and
 *     returns a Promise that resolves when the operator answers (or
 *     rejects on timeout/cancel).
 *   - Operator side: `listPending(...)` enumerates open questions;
 *     `answerRequest(...)` resolves one.
 *
 * Persistence: `~/.gordon/human-input-requests.jsonl`. Survives session
 * boundary — a question opened in one session can be answered in the
 * next. In-flight Promises (from `waitForAnswer`) only survive the
 * current process.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const HUMAN_INPUT_FLAG_ENV = "GORDON_HUMAN_INPUT_TOOL";
export const HUMAN_INPUT_PATH_ENV = "GORDON_HUMAN_INPUT_PATH";

export type RequestStatus = "pending" | "answered" | "expired" | "cancelled";
export type RequestFormat = "free_text" | "yes_no" | "choose";
export type RequestUrgency = "low" | "normal" | "high";

export interface RequestOption {
  id: string;
  label: string;
}

export interface HumanInputRequest {
  id: string;
  agentId: string;
  threadId?: string;
  question: string;
  /** Optional background — surfaced alongside the question. */
  context?: string;
  format: RequestFormat;
  options?: RequestOption[];
  urgency: RequestUrgency;
  requestedAt: string;
}

export interface HumanInputResponse {
  requestId: string;
  answer: string;
  /** When format === "choose", which option id the operator picked. */
  optionId?: string;
  answeredAt: string;
}

export interface PendingRequest {
  request: HumanInputRequest;
  status: RequestStatus;
  response?: HumanInputResponse;
  cancelReason?: string;
}

// On-disk record kinds — written append-only, latest-per-id wins on read.
type DiskRecord =
  | { kind: "request"; payload: HumanInputRequest }
  | { kind: "answer"; payload: HumanInputResponse }
  | { kind: "cancel"; requestId: string; reason: string; at: string };

export interface CreateRequestInput {
  agentId: string;
  threadId?: string;
  question: string;
  context?: string;
  format?: RequestFormat;
  options?: RequestOption[];
  urgency?: RequestUrgency;
  now?: string;
}

export function isHumanInputToolEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[HUMAN_INPUT_FLAG_ENV] === "1" || env[HUMAN_INPUT_FLAG_ENV] === "true";
}

export function defaultHumanInputPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[HUMAN_INPUT_PATH_ENV] ?? join(homedir(), ".gordon", "human-input-requests.jsonl");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

let _idCounter = 0;
function nextRequestId(): string {
  _idCounter += 1;
  return `req-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

export function resetIdCounterForTesting(): void {
  _idCounter = 0;
}

// In-memory promise registry — keyed by requestId. Cleared on process exit;
// callers that need cross-process replay use `loadPending` instead.
const _waiters = new Map<string, {
  resolve: (r: HumanInputResponse) => void;
  reject: (e: Error) => void;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}>();

export function resetWaitersForTesting(): void {
  for (const w of _waiters.values()) {
    if (w.timeoutHandle) clearTimeout(w.timeoutHandle);
  }
  _waiters.clear();
}

function persistRecord(record: DiskRecord, path?: string): void {
  const target = path ?? defaultHumanInputPath();
  ensureParentDir(target);
  appendFileSync(target, JSON.stringify(record) + "\n", "utf8");
}

/**
 * Open a new pending question. Returns the request descriptor; the
 * caller (or a wrapper) typically also calls `waitForAnswer` to await
 * the operator's response.
 */
export function createRequest(input: CreateRequestInput, path?: string): HumanInputRequest {
  const request: HumanInputRequest = {
    id: nextRequestId(),
    agentId: input.agentId,
    threadId: input.threadId,
    question: input.question,
    context: input.context,
    format: input.format ?? "free_text",
    options: input.options,
    urgency: input.urgency ?? "normal",
    requestedAt: input.now ?? new Date().toISOString(),
  };
  persistRecord({ kind: "request", payload: request }, path);
  return request;
}

/**
 * Load and reduce all on-disk records into the current set of pending
 * requests. Latest matching record per id wins.
 */
export function loadAllRequests(path?: string): PendingRequest[] {
  const target = path ?? defaultHumanInputPath();
  if (!existsSync(target)) return [];

  const lines = readFileSync(target, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const byId = new Map<string, PendingRequest>();

  for (const line of lines) {
    let parsed: DiskRecord;
    try {
      parsed = JSON.parse(line) as DiskRecord;
    } catch {
      continue;
    }

    if (parsed.kind === "request") {
      const r = parsed.payload;
      // Don't clobber an existing answered/cancelled record on duplicate replays.
      if (!byId.has(r.id)) {
        byId.set(r.id, { request: r, status: "pending" });
      }
    } else if (parsed.kind === "answer") {
      const existing = byId.get(parsed.payload.requestId);
      if (existing && existing.status === "pending") {
        existing.status = "answered";
        existing.response = parsed.payload;
      }
    } else if (parsed.kind === "cancel") {
      const existing = byId.get(parsed.requestId);
      if (existing && existing.status === "pending") {
        existing.status = "cancelled";
        existing.cancelReason = parsed.reason;
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    b.request.requestedAt.localeCompare(a.request.requestedAt),
  );
}

export interface ListPendingOptions {
  threadId?: string;
  urgency?: RequestUrgency;
  limit?: number;
}

export function listPending(
  opts: ListPendingOptions = {},
  path?: string,
): PendingRequest[] {
  let all = loadAllRequests(path).filter((p) => p.status === "pending");
  if (opts.threadId) all = all.filter((p) => p.request.threadId === opts.threadId);
  if (opts.urgency) all = all.filter((p) => p.request.urgency === opts.urgency);
  if (opts.limit !== undefined) all = all.slice(0, opts.limit);
  return all;
}

export class RequestNotFoundError extends Error {
  constructor(requestId: string) {
    super(`Human-input request not found: ${requestId}`);
    this.name = "RequestNotFoundError";
  }
}

export class RequestNotPendingError extends Error {
  constructor(requestId: string, status: RequestStatus) {
    super(`Human-input request ${requestId} is ${status}, not pending`);
    this.name = "RequestNotPendingError";
  }
}

export class RequestTimeoutError extends Error {
  constructor(requestId: string, timeoutMs: number) {
    super(`Human-input request ${requestId} timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
  }
}

/**
 * Resolve a pending request with the operator's answer. Persists, then
 * notifies any in-process waiter.
 */
export function answerRequest(
  requestId: string,
  answer: string,
  opts: { optionId?: string; now?: string; path?: string } = {},
): HumanInputResponse {
  const all = loadAllRequests(opts.path);
  const existing = all.find((p) => p.request.id === requestId);
  if (!existing) throw new RequestNotFoundError(requestId);
  if (existing.status !== "pending") {
    throw new RequestNotPendingError(requestId, existing.status);
  }
  const response: HumanInputResponse = {
    requestId,
    answer,
    optionId: opts.optionId,
    answeredAt: opts.now ?? new Date().toISOString(),
  };
  persistRecord({ kind: "answer", payload: response }, opts.path);

  const waiter = _waiters.get(requestId);
  if (waiter) {
    if (waiter.timeoutHandle) clearTimeout(waiter.timeoutHandle);
    _waiters.delete(requestId);
    waiter.resolve(response);
  }

  return response;
}

export function cancelRequest(
  requestId: string,
  reason: string,
  opts: { now?: string; path?: string } = {},
): void {
  const all = loadAllRequests(opts.path);
  const existing = all.find((p) => p.request.id === requestId);
  if (!existing) throw new RequestNotFoundError(requestId);
  if (existing.status !== "pending") {
    throw new RequestNotPendingError(requestId, existing.status);
  }
  persistRecord(
    { kind: "cancel", requestId, reason, at: opts.now ?? new Date().toISOString() },
    opts.path,
  );

  const waiter = _waiters.get(requestId);
  if (waiter) {
    if (waiter.timeoutHandle) clearTimeout(waiter.timeoutHandle);
    _waiters.delete(requestId);
    waiter.reject(new Error(`request cancelled: ${reason}`));
  }
}

/**
 * Promise-based wait for an answer. Times out (rejects with
 * RequestTimeoutError) after `timeoutMs` if no answer arrives. The
 * timeout is in-process only — the on-disk record stays pending so a
 * subsequent process can still answer it.
 */
export function waitForAnswer(
  requestId: string,
  opts: { timeoutMs?: number; path?: string } = {},
): Promise<HumanInputResponse> {
  return new Promise<HumanInputResponse>((resolve, reject) => {
    // If already answered on disk (e.g. previous session), return immediately.
    const all = loadAllRequests(opts.path);
    const existing = all.find((p) => p.request.id === requestId);
    if (!existing) {
      reject(new RequestNotFoundError(requestId));
      return;
    }
    if (existing.status === "answered" && existing.response) {
      resolve(existing.response);
      return;
    }
    if (existing.status !== "pending") {
      reject(new RequestNotPendingError(requestId, existing.status));
      return;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        _waiters.delete(requestId);
        reject(new RequestTimeoutError(requestId, opts.timeoutMs!));
      }, opts.timeoutMs);
    }
    _waiters.set(requestId, { resolve, reject, timeoutHandle });
  });
}

export function formatPending(pending: readonly PendingRequest[]): string {
  if (pending.length === 0) return "No pending human-input requests.";
  const lines: string[] = [`Pending human-input requests (${pending.length}):`];
  for (const p of pending) {
    const tag = `[${p.request.urgency}]`;
    lines.push(`  ${tag} ${p.request.id} (${p.request.format}) — ${p.request.question}`);
    if (p.request.context) lines.push(`    context: ${p.request.context}`);
    if (p.request.options && p.request.options.length > 0) {
      lines.push(`    options: ${p.request.options.map((o) => `${o.id}=${o.label}`).join(", ")}`);
    }
  }
  return lines.join("\n");
}

export function requestToPayload(request: HumanInputRequest): Record<string, unknown> {
  return {
    kind: "human_input.request_recorded",
    id: request.id,
    agentId: request.agentId,
    threadId: request.threadId,
    format: request.format,
    urgency: request.urgency,
    requestedAt: request.requestedAt,
  };
}

export function responseToPayload(response: HumanInputResponse): Record<string, unknown> {
  return {
    kind: "human_input.response_recorded",
    requestId: response.requestId,
    optionId: response.optionId,
    answeredAt: response.answeredAt,
  };
}
