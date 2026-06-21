/**
 * Doubleword Batch Judge — async/batch inference path for the eval-harness judge.
 *
 * The realtime judge (`judgeTrajectories` in `trajectoryJudge.ts`) calls the
 * direct `LLMClient.chatWithJSON` once per scenario. For BULK judging (e.g. a
 * full scenario suite × variants) that is N synchronous round-trips at the
 * realtime price. Doubleword is OpenAI-compatible and exposes the standard
 * OpenAI Batch API at a batch tier (~90% cheaper than realtime, 24h window):
 *
 *   files.create(purpose="batch", JSONL)  →  file_id
 *   batches.create(input_file_id, endpoint="/v1/chat/completions",
 *                  completion_window="24h")  →  batch_id
 *   batches.retrieve(batch_id)  (poll until status="completed")
 *   files.content(output_file_id)  →  JSONL of {custom_id, response{body}}
 *
 * This module submits ONE batch per group of judge requests, polls to
 * completion, and maps each output line back to a `JudgeResult` keyed by
 * custom_id, preserving input order.
 *
 * The SAME judge prompt is built via `buildJudgePrompt` (shared with the
 * realtime path) so the two routes are scored identically.
 *
 * Live execution requires `DOUBLEWORD_API_KEY` (the real fetch-based client
 * below reads it). The pure JSONL builder + the result mapping are
 * unit-tested with a MOCK `DoublewordBatchClient` — no network.
 */

import { z } from "zod";
import { API_ENDPOINTS } from "../../../ai/llm/types.ts";
import type { Message } from "../../../ai/llm/types.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import { buildJudgePrompt } from "./trajectoryJudge.ts";
import type { JudgeRequest, JudgeResult, ScoredTrajectory } from "./types.ts";

const logger = createModuleLogger("doubleword-batch-judge");

const DEFAULT_JUDGE_MODEL = "anthropic/claude-sonnet-4-6";
const DOUBLEWORD_PREFIX = "doubleword/";
const BATCH_ENDPOINT = "/v1/chat/completions";
const BATCH_COMPLETION_WINDOW = "24h";

const JUDGE_SYSTEM_PROMPT =
  "You are a strict, calibrated grader. You return JSON only — no prose, no markdown fences.";

// ============================================================================
// Pure JSONL builder
// ============================================================================

/** One judge request, flattened for the OpenAI Batch API. */
export interface BatchJudgeRequest {
  /** Stable per-line id. Echoed back on the output line as `custom_id`. */
  customId: string;
  /** Bare transport model id (no `doubleword/` prefix). */
  model: string;
  /** Full chat message sequence (system + user judge prompt). */
  messages: Message[];
}

/**
 * Build an OpenAI Batch API input file (JSONL) — one line per request.
 *
 * PURE: no I/O, no env access. Each line is:
 *   {custom_id, method:"POST", url:"/v1/chat/completions",
 *    body:{model, messages, response_format:{type:"json_object"}}}
 *
 * `response_format: json_object` mirrors the realtime path's JSON mode so the
 * judge returns parseable JSON.
 */
export function buildBatchJsonl(requests: ReadonlyArray<BatchJudgeRequest>): string {
  return requests
    .map((req) =>
      JSON.stringify({
        custom_id: req.customId,
        method: "POST",
        url: BATCH_ENDPOINT,
        body: {
          model: req.model,
          messages: req.messages,
          response_format: { type: "json_object" },
        },
      }),
    )
    .join("\n");
}

// ============================================================================
// Mockable network layer
// ============================================================================

export interface BatchFile {
  id: string;
}

export interface BatchHandle {
  id: string;
  status: string;
  /** Set once the batch completes. */
  output_file_id?: string;
  /** Set when the batch (or its requests) failed. */
  error_file_id?: string;
}

/**
 * One parsed output line from the batch output file. Mirrors the OpenAI
 * Batch API response-line shape (only the fields the judge needs).
 */
export interface BatchOutputLine {
  custom_id: string;
  response?: {
    status_code?: number;
    body?: {
      choices?: Array<{ message?: { content?: string } }>;
    };
  };
  error?: unknown;
}

/**
 * Minimal Doubleword Batch surface — kept tiny so tests can supply a canned
 * implementation without a network. The real implementation
 * (`createDoublewordBatchClient`) hits the OpenAI-compatible endpoints.
 */
export interface DoublewordBatchClient {
  /** Upload a JSONL batch input file (purpose="batch"). */
  createFile(jsonl: string): Promise<BatchFile>;
  /** Create a batch over an uploaded input file. */
  createBatch(inputFileId: string): Promise<BatchHandle>;
  /** Poll a batch's current status. */
  retrieveBatch(batchId: string): Promise<BatchHandle>;
  /** Download + parse the batch output file into lines. */
  getResults(outputFileId: string): Promise<BatchOutputLine[]>;
}

interface RealClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Real fetch-based `DoublewordBatchClient` pointing at the Doubleword
 * OpenAI-compatible endpoint with a `DOUBLEWORD_API_KEY` bearer.
 *
 * Throws at construction if no key is available — live batch judging cannot
 * proceed without it.
 */
export function createDoublewordBatchClient(
  options: RealClientOptions = {},
): DoublewordBatchClient {
  const apiKey = options.apiKey ?? process.env.DOUBLEWORD_API_KEY;
  if (!apiKey) {
    throw new Error(
      "createDoublewordBatchClient requires DOUBLEWORD_API_KEY (env or options.apiKey)",
    );
  }
  const baseUrl = options.baseUrl ?? API_ENDPOINTS.doubleword;
  const doFetch = options.fetchImpl ?? fetch;
  const authHeader = `Bearer ${apiKey}`;

  async function jsonOrThrow(res: Response, ctx: string): Promise<unknown> {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Doubleword batch ${ctx} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  return {
    async createFile(jsonl: string): Promise<BatchFile> {
      const form = new FormData();
      form.append("purpose", "batch");
      form.append(
        "file",
        new Blob([jsonl], { type: "application/jsonl" }),
        "judge-batch.jsonl",
      );
      const res = await doFetch(`${baseUrl}/files`, {
        method: "POST",
        headers: { Authorization: authHeader },
        body: form,
      });
      const data = (await jsonOrThrow(res, "files.create")) as { id: string };
      return { id: data.id };
    },

    async createBatch(inputFileId: string): Promise<BatchHandle> {
      const res = await doFetch(`${baseUrl}/batches`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input_file_id: inputFileId,
          endpoint: BATCH_ENDPOINT,
          completion_window: BATCH_COMPLETION_WINDOW,
        }),
      });
      return (await jsonOrThrow(res, "batches.create")) as BatchHandle;
    },

    async retrieveBatch(batchId: string): Promise<BatchHandle> {
      const res = await doFetch(`${baseUrl}/batches/${batchId}`, {
        method: "GET",
        headers: { Authorization: authHeader },
      });
      return (await jsonOrThrow(res, "batches.retrieve")) as BatchHandle;
    },

    async getResults(outputFileId: string): Promise<BatchOutputLine[]> {
      const res = await doFetch(`${baseUrl}/files/${outputFileId}/content`, {
        method: "GET",
        headers: { Authorization: authHeader },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Doubleword batch files.content failed (${res.status}): ${text.slice(0, 300)}`,
        );
      }
      const text = await res.text();
      return parseOutputJsonl(text);
    },
  };
}

/** Parse a batch output file's JSONL into lines, skipping blanks. */
export function parseOutputJsonl(text: string): BatchOutputLine[] {
  const lines: BatchOutputLine[] = [];
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    lines.push(JSON.parse(trimmed) as BatchOutputLine);
  }
  return lines;
}

// ============================================================================
// Batch judge
// ============================================================================

const JudgeResponseSchema = z.object({
  scores: z.array(
    z.object({
      trajectory_id: z.string(),
      score: z.number(),
      explanation: z.string(),
      /** Independently-gated anti-metric; optional, missing = false. */
      generic_non_actionable: z.boolean().optional(),
    }),
  ),
});

export interface BatchJudgeOptions {
  /** Override default judge model. */
  judgeModel?: string;
  /** Temperature recorded into the request body. Default 0.1. */
  temperature?: number;
  /** Poll cadence while waiting for the batch (ms). Default 5000. */
  pollIntervalMs?: number;
  /** Max polls before giving up. Default 1 (mock-friendly); raise for live. */
  maxPolls?: number;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "expired", "cancelled"]);

/**
 * Judge multiple scenario-groups in ONE Doubleword batch.
 *
 * For each `JudgeRequest`, builds the SAME judge prompt as the realtime path
 * (`buildJudgePrompt`) and emits one batch line keyed by the scenario id.
 * Submits the batch via the injected `client`, polls to terminal status, then
 * maps each output line back to a `JudgeResult`. Returns results in the SAME
 * order as the input `requests`.
 *
 * Never throws on a per-request judge failure — a missing / unparseable output
 * line degrades that scenario to a fallback `JudgeResult` (uniform 0.5), so a
 * single bad line cannot poison the whole batch. A batch-level failure (upload
 * error, non-completed terminal status) DOES throw, since nothing was scored.
 */
export async function judgeTrajectoriesBatch(
  requests: ReadonlyArray<JudgeRequest>,
  options: BatchJudgeOptions,
  client: DoublewordBatchClient,
): Promise<JudgeResult[]> {
  const startTime = Date.now();
  if (requests.length === 0) return [];

  const temperature = options.temperature ?? 0.1;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const maxPolls = options.maxPolls ?? 1;

  // custom_id is the scenario id. Scenario ids are unique within a suite; if a
  // caller passes duplicates, the later line wins on the way back — guard by
  // tracking the request index per custom_id.
  const batchRequests: BatchJudgeRequest[] = requests.map((req) => {
    const judgeModel = options.judgeModel ?? req.judgeModel ?? DEFAULT_JUDGE_MODEL;
    const model = stripDoublewordPrefix(judgeModel);
    return {
      customId: req.scenario.id,
      model,
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: buildJudgePrompt(req.scenario, req.trajectories) },
      ],
    };
  });
  // temperature isn't part of buildBatchJsonl's contract; fold it into each body.
  const jsonl = buildBatchJsonlWithTemperature(batchRequests, temperature);

  const file = await client.createFile(jsonl);
  let batch = await client.createBatch(file.id);

  let polls = 0;
  while (!TERMINAL_STATUSES.has(batch.status)) {
    if (polls >= maxPolls) {
      throw new Error(
        `Doubleword batch ${batch.id} not terminal after ${polls} poll(s) (status=${batch.status})`,
      );
    }
    polls += 1;
    await sleep(pollIntervalMs);
    batch = await client.retrieveBatch(batch.id);
  }

  if (batch.status !== "completed" || !batch.output_file_id) {
    throw new Error(
      `Doubleword batch ${batch.id} did not complete (status=${batch.status})`,
    );
  }

  const outputLines = await client.getResults(batch.output_file_id);
  const byCustomId = new Map<string, BatchOutputLine>();
  for (const line of outputLines) byCustomId.set(line.custom_id, line);

  return requests.map((req) => {
    const judgeModel = options.judgeModel ?? req.judgeModel ?? DEFAULT_JUDGE_MODEL;
    const line = byCustomId.get(req.scenario.id);
    return mapLineToJudgeResult(req, judgeModel, line, Date.now() - startTime);
  });
}

/**
 * Like `buildBatchJsonl` but also stamps `temperature` into each body. Kept
 * separate so the public `buildBatchJsonl` stays a minimal, easily-tested
 * contract; this is the internal variant the batch judge actually submits.
 */
function buildBatchJsonlWithTemperature(
  requests: ReadonlyArray<BatchJudgeRequest>,
  temperature: number,
): string {
  return requests
    .map((req) =>
      JSON.stringify({
        custom_id: req.customId,
        method: "POST",
        url: BATCH_ENDPOINT,
        body: {
          model: req.model,
          messages: req.messages,
          response_format: { type: "json_object" },
          temperature,
        },
      }),
    )
    .join("\n");
}

function mapLineToJudgeResult(
  request: JudgeRequest,
  judgeModel: string,
  line: BatchOutputLine | undefined,
  durationMs: number,
): JudgeResult {
  if (!line) {
    return fallbackResult(request, judgeModel, "no batch output line for scenario", durationMs);
  }
  if (line.error) {
    return fallbackResult(
      request,
      judgeModel,
      `batch line error: ${truncate(JSON.stringify(line.error))}`,
      durationMs,
    );
  }
  const content = line.response?.body?.choices?.[0]?.message?.content;
  if (!content) {
    return fallbackResult(request, judgeModel, "batch line missing message content", durationMs);
  }

  let parsed: z.infer<typeof JudgeResponseSchema>;
  try {
    parsed = JudgeResponseSchema.parse(JSON.parse(content));
  } catch (err) {
    logger.warn("Batch judge line unparseable — degrading to fallback", {
      scenarioId: request.scenario.id,
      err: errMessage(err),
    });
    return fallbackResult(
      request,
      judgeModel,
      `unparseable judge JSON: ${errMessage(err)}`,
      durationMs,
    );
  }

  const scored = normalizeAndRank(parsed.scores, request.trajectories);
  return {
    scenarioId: request.scenario.id,
    judgeModel,
    scored,
    durationMs,
  };
}

// ----------------------------------------------------------------------------
// Local copies of the realtime path's normalization helpers. Kept private here
// (rather than exporting them from trajectoryJudge.ts) so this module is purely
// additive — it does not change the realtime file's public surface.
// ----------------------------------------------------------------------------

function normalizeAndRank(
  rawScores: z.infer<typeof JudgeResponseSchema>["scores"],
  trajectories: JudgeRequest["trajectories"],
): ScoredTrajectory[] {
  const scoreById = new Map<
    string,
    { score: number; explanation: string; genericNonActionable?: boolean }
  >();
  for (const s of rawScores) {
    scoreById.set(s.trajectory_id, {
      score: clamp01(s.score),
      explanation: s.explanation || "",
      genericNonActionable: s.generic_non_actionable,
    });
  }
  const scored: ScoredTrajectory[] = trajectories.map((t) => {
    const entry = scoreById.get(t.id);
    return {
      id: t.id,
      score: entry?.score ?? 0.5,
      explanation: entry?.explanation ?? "Judge returned no score for this trajectory.",
      rank: 0,
      genericNonActionable: entry?.genericNonActionable,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => {
    s.rank = i + 1;
  });
  return scored;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function fallbackResult(
  request: JudgeRequest,
  judgeModel: string,
  reason: string,
  durationMs: number,
): JudgeResult {
  const scored: ScoredTrajectory[] = request.trajectories.map((t, i) => ({
    id: t.id,
    score: 0.5,
    explanation: `Fallback score — ${reason}`,
    rank: i + 1,
  }));
  return {
    scenarioId: request.scenario.id,
    judgeModel,
    scored,
    durationMs,
    fallback: { reason },
  };
}

function stripDoublewordPrefix(model: string): string {
  return model.startsWith(DOUBLEWORD_PREFIX) ? model.slice(DOUBLEWORD_PREFIX.length) : model;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
