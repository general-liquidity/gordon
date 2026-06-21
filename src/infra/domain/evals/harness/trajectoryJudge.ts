/**
 * Trajectory Judge — RULER-pattern LLM-as-judge with relative scoring.
 *
 * Borrows the three core ideas from the RULER article:
 *   1. Relative ranking > absolute scoring (LLMs are inconsistent at
 *      "rate this 0-100" but consistent at "rank these N in order").
 *   2. The scenario's system prompt becomes the implicit rubric.
 *   3. The judge model is independent from the variant model — Sonnet
 *      / Opus / Haiku / a local Qwen all work; default is Sonnet 4.6.
 *
 * Does NOT borrow:
 *   - GRPO / RL training loop (Gordon doesn't train models)
 *   - ART framework / Python infra
 *
 * Defensive defaults:
 *   - Judge LLM call wrapped in try/catch; on failure, returns
 *     equal scores (0.5 across the board) tagged as `fallback`.
 *     A broken judge must never block CI — eval failures should be
 *     loud but recoverable.
 *   - Malformed JSON from the judge → also falls back, never throws.
 *   - Score clamped to [0, 1] regardless of what the judge returns.
 */

import { z } from "zod";
import { createLLMClientFromEnv } from "../../../ai/llm/client.ts";
import type { LLMClient } from "../../../ai/llm/client.ts";
import type { Message } from "../../../ai/llm/types.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import { getCategoryRubric } from "./categoryRubrics.ts";
import type {
  EvalScenario,
  EvalTrajectory,
  JudgeRequest,
  JudgeResult,
  ScoredTrajectory,
} from "./types.ts";

const logger = createModuleLogger("trajectory-judge");

const DEFAULT_JUDGE_MODEL = "anthropic/claude-sonnet-4-6";

/**
 * Resolve which direct-client provider + transport model id a judgeModel maps to.
 *
 * Default routing is unchanged: judge calls go through `dedalus` with the
 * model string as-is (e.g. "anthropic/claude-sonnet-4-6", "openai/test").
 *
 * Opt-in: a judgeModel of the form `doubleword/<model>` routes the judge
 * through the existing Doubleword provider on the direct LLMClient
 * (OpenAI-compatible, DOUBLEWORD_API_KEY). The `doubleword/` prefix is
 * stripped so the bare model id is sent to the endpoint.
 *
 * Realtime only — async Batch API (JSONL) routing is a future cost
 * optimization, out of scope here.
 */
const DOUBLEWORD_PREFIX = "doubleword/";

function resolveJudgeRoute(judgeModel: string): {
  provider: "dedalus" | "doubleword";
  model: string;
} {
  if (judgeModel.startsWith(DOUBLEWORD_PREFIX)) {
    return { provider: "doubleword", model: judgeModel.slice(DOUBLEWORD_PREFIX.length) };
  }
  return { provider: "dedalus", model: judgeModel };
}

const JudgeResponseSchema = z.object({
  scores: z.array(
    z.object({
      trajectory_id: z.string(),
      score: z.number(),
      explanation: z.string(),
      /**
       * Independently-gated anti-metric. Optional so judges (or judge
       * models) that don't emit it don't break parsing; missing is
       * treated as `false` (not flagged) downstream.
       */
      generic_non_actionable: z.boolean().optional(),
    }),
  ),
});

type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

export interface JudgeOptions {
  /** Override default judge model. */
  judgeModel?: string;
  /** Override the default LLM client (for tests). */
  client?: LLMClient;
  /** Temperature for the judge call. Lower = more deterministic. Default 0.1. */
  temperature?: number;
}

/**
 * Score a group of trajectories relatively. Returns a `JudgeResult`
 * with sorted scores. Never throws — failures degrade to passthrough.
 */
export async function judgeTrajectories(
  request: JudgeRequest,
  options: JudgeOptions = {},
): Promise<JudgeResult> {
  const startTime = Date.now();
  const judgeModel = options.judgeModel ?? request.judgeModel ?? DEFAULT_JUDGE_MODEL;

  if (request.trajectories.length === 0) {
    return {
      scenarioId: request.scenario.id,
      judgeModel,
      scored: [],
      durationMs: 0,
    };
  }

  // Single trajectory: nothing to compare, return uniform high score.
  if (request.trajectories.length === 1) {
    const traj = request.trajectories[0]!;
    return {
      scenarioId: request.scenario.id,
      judgeModel,
      scored: [
        {
          id: traj.id,
          score: 1.0,
          rank: 1,
          explanation: "Single trajectory — no comparison possible.",
        },
      ],
      durationMs: Date.now() - startTime,
    };
  }

  let client: LLMClient;
  try {
    client = options.client ?? createLLMClientFromEnv();
  } catch (err) {
    return fallbackResult(
      request,
      judgeModel,
      `LLM client init failed: ${errMessage(err)}`,
      Date.now() - startTime,
    );
  }

  const judgePrompt = buildJudgePrompt(request.scenario, request.trajectories);

  const route = resolveJudgeRoute(judgeModel);

  let parsed: JudgeResponse;
  try {
    parsed = await client.chatWithJSON(
      [
        {
          role: "system",
          content:
            "You are a strict, calibrated grader. You return JSON only — no prose, no markdown fences.",
        },
        { role: "user", content: judgePrompt },
      ],
      JudgeResponseSchema,
      {
        provider: route.provider,
        model: route.model,
        temperature: options.temperature ?? 0.1,
      },
    );
  } catch (err) {
    logger.warn("Judge call failed — degrading to passthrough", {
      scenarioId: request.scenario.id,
      err: errMessage(err),
    });
    return fallbackResult(
      request,
      judgeModel,
      `judge call failed: ${errMessage(err)}`,
      Date.now() - startTime,
    );
  }

  const scored = normalizeAndRank(parsed.scores, request.trajectories);
  return {
    scenarioId: request.scenario.id,
    judgeModel,
    scored,
    durationMs: Date.now() - startTime,
  };
}

export function buildJudgePrompt(
  scenario: EvalScenario,
  trajectories: ReadonlyArray<EvalTrajectory>,
): string {
  const lines: string[] = [];
  lines.push("# Task");
  lines.push(
    "Rank the trajectories below from best to worst based on how well each follows the agent's system prompt and answers the user input. Return JSON only.",
  );
  lines.push("");
  lines.push("# Grading principle");
  lines.push(
    "Focus on OUTPUT QUALITY, not path efficiency. Different trajectories may take different paths to the same goal — that is fine. Score based on whether the final answer satisfies the user's request and the rubric, not on whether the path was the most direct. Penalize unusual paths ONLY when they degrade the final answer.",
  );
  lines.push("");
  lines.push("# Anti-metric — generic non-actionable advice");
  lines.push(
    "SEPARATELY from the score, flag each trajectory with `generic_non_actionable: true` when its answer is generic non-actionable advice FOR TRADING. For trading, an answer is generic non-actionable when it recommends or implies an action but gives NO concrete trigger, stop, target, or size — i.e. \"buy when it looks good\" without a price/event trigger, stop level, target, or position size — OR when it retreats into platitudes (\"manage your risk\", \"wait for confirmation\", \"stay diversified\", \"do your own research\", \"keep an eye on it\") instead of a specific, executable call. A genuinely good answer that names a concrete trigger/stop/target/size, OR that honestly says \"nothing meets your criteria right now\" with reasoning, is NOT generic non-actionable. An answer that correctly declines to act (e.g. refuses a risk-breaching trade) and explains the specific reason is NOT generic non-actionable. Set the flag `false` (or omit it) when none of the above apply. This flag is tracked independently of the score — a fluent, well-structured answer can still be generic non-actionable.",
  );
  lines.push("");
  lines.push("# Agent system prompt (the rubric)");
  lines.push("```");
  lines.push(scenario.systemPrompt);
  lines.push("```");
  const categoryRubric = getCategoryRubric(scenario.category);
  if (categoryRubric) {
    lines.push("");
    lines.push(`# Category rubric — ${scenario.category}`);
    lines.push(categoryRubric);
  }
  if (scenario.extraRubric) {
    lines.push("");
    lines.push("# Extra evaluation criteria");
    lines.push(scenario.extraRubric);
  }
  lines.push("");
  lines.push("# User input");
  lines.push("```");
  lines.push(scenario.userInput);
  lines.push("```");
  lines.push("");
  lines.push("# Trajectories to rank");
  trajectories.forEach((traj, idx) => {
    lines.push(`## Trajectory ${idx + 1} (id: ${traj.id})`);
    const assistantMessages = traj.messages.filter((m) => m.role === "assistant");
    const responseBody =
      assistantMessages.length > 0
        ? assistantMessages.map((m) => m.content).join("\n\n---\n\n")
        : "[empty trajectory — no assistant response]";
    lines.push("```");
    lines.push(responseBody);
    lines.push("```");
    lines.push("");
  });
  lines.push("# Output format");
  lines.push("Return exactly this JSON shape (no prose, no fences):");
  lines.push(
    JSON.stringify(
      {
        scores: trajectories.map((t) => ({
          trajectory_id: t.id,
          score: "<float 0..1>",
          explanation: "<one-sentence rationale>",
          generic_non_actionable: "<true|false — see anti-metric section>",
        })),
      },
      null,
      2,
    ),
  );
  lines.push("");
  lines.push(
    "Scores must be relative — the best trajectory should score close to 1.0, the worst close to 0.0. Use intermediate values for trajectories in between.",
  );
  return lines.join("\n");
}

function normalizeAndRank(
  rawScores: JudgeResponse["scores"],
  trajectories: ReadonlyArray<EvalTrajectory>,
): ScoredTrajectory[] {
  const scoreById = new Map<
    string,
    { score: number; explanation: string; genericNonActionable?: boolean }
  >();
  for (const s of rawScores) {
    const score = clamp01(s.score);
    scoreById.set(s.trajectory_id, {
      score,
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
      rank: 0, // filled after sort
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

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ============================================================================
// Test helpers — used by harness.test.ts
// ============================================================================

/** Build a mock LLM client that returns canned judge responses. */
export interface MockJudgeOptions {
  /** Map from scenarioId → array of (trajId, score). */
  responses: Record<
    string,
    Array<{ id: string; score: number; explanation?: string; genericNonActionable?: boolean }>
  >;
  /**
   * Optional per-model overrides. When the judge call's `config.model`
   * appears in this map, those responses win over the default ones.
   * Used by panel tests to differentiate per-judge scores.
   */
  byModel?: Record<
    string,
    Record<
      string,
      Array<{ id: string; score: number; explanation?: string; genericNonActionable?: boolean }>
    >
  >;
  /** Set true to make the mock throw on call. */
  throwOnCall?: boolean;
  /** Set to throw only when the call's model matches this string. */
  throwForModel?: string;
}

/**
 * Construct a fake `LLMClient` for tests. Only `chatWithJSON` is
 * implemented — the rest throw.
 */
export function buildMockJudgeClient(options: MockJudgeOptions): LLMClient {
  const stub: Partial<LLMClient> = {
    chatWithJSON: async <T>(
      messages: Message[],
      _schema: z.ZodSchema<T>,
      config?: unknown,
    ): Promise<T> => {
      const model = (config as { model?: string } | undefined)?.model;
      if (options.throwOnCall) {
        throw new Error("mock judge: configured to throw");
      }
      if (options.throwForModel && model === options.throwForModel) {
        throw new Error(`mock judge: configured to throw for model ${model}`);
      }
      const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
      const modelMap = model && options.byModel ? options.byModel[model] : undefined;
      const sourceMap = modelMap ?? options.responses;
      const scenarioKey = Object.keys(sourceMap).find((k) => userMsg.includes(k));
      const set = scenarioKey ? sourceMap[scenarioKey] : Object.values(sourceMap)[0];
      if (!set) throw new Error("mock judge: no responses configured");
      const payload = {
        scores: set.map((s) => ({
          trajectory_id: s.id,
          score: s.score,
          explanation: s.explanation ?? `mock score ${s.score}`,
          generic_non_actionable: s.genericNonActionable,
        })),
      };
      return payload as T;
    },
  };
  return stub as LLMClient;
}
