/**
 * Panel Judge — tri-judge LLM-as-judge from different model families.
 *
 * Borrowed from CREAO's anti-bias setup: run N judges concurrently
 * (typically Anthropic + OpenAI + Google), drop the ones that fail or
 * return malformed JSON, average the surviving scores per trajectory.
 *
 * Why it matters: a single judge can self-prefer its own family's
 * outputs (~0.3 bias drift). Cross-family averaging washes that out.
 * Quorum can be ≥1 — if only one judge survives, its result is the
 * consensus (with `quorum: 1` recorded so callers can flag low-confidence
 * rows).
 *
 * Defensive: a failing judge never aborts the panel. The whole thing
 * only falls back to passthrough when *zero* judges survive.
 */

import { judgeTrajectories } from "./trajectoryJudge.ts";
import type { JudgeOptions } from "./trajectoryJudge.ts";
import { createModuleLogger } from "../../../logger/index.ts";
import type {
  EvalTrajectory,
  FailureMode,
  JudgeRequest,
  PanelJudgeEntry,
  PanelJudgeResult,
  ScoredTrajectory,
} from "./types.ts";

const logger = createModuleLogger("panel-judge");

/**
 * Default 3-judge panel — one Anthropic, one OpenAI, one Google. All
 * routed through Dedalus per the existing provider convention. Override
 * via `options.panel` when calling.
 */
export const DEFAULT_PANEL: ReadonlyArray<string> = [
  "anthropic/claude-sonnet-4-6",
  "openai/gpt-5.2",
  "google/gemini-2.5-flash",
];

export interface PanelJudgeOptions extends JudgeOptions {
  /** Override the default panel composition. */
  panel?: ReadonlyArray<string>;
}

/**
 * Run a tri-judge panel concurrently and return per-judge entries
 * plus an averaged consensus. Never throws.
 */
export async function judgeTrajectoriesPanel(
  request: JudgeRequest,
  options: PanelJudgeOptions = {},
): Promise<PanelJudgeResult> {
  const startTime = Date.now();
  const panel = options.panel ?? DEFAULT_PANEL;

  if (request.trajectories.length === 0) {
    return {
      scenarioId: request.scenario.id,
      panel: [],
      consensus: [],
      quorum: 0,
      durationMs: 0,
    };
  }

  if (panel.length === 0) {
    logger.warn("Panel is empty — falling back to single-judge mode", {
      scenarioId: request.scenario.id,
    });
    const single = await judgeTrajectories(request, options);
    return {
      scenarioId: request.scenario.id,
      panel: [
        {
          judgeModel: single.judgeModel,
          scored: single.scored,
          durationMs: single.durationMs,
          failed: single.fallback ? { reason: single.fallback.reason } : undefined,
        },
      ],
      consensus: single.scored,
      quorum: single.fallback ? 0 : 1,
      durationMs: single.durationMs,
    };
  }

  const judgeCalls = panel.map((model) =>
    judgeTrajectories(request, { ...options, judgeModel: model }).catch((err) => ({
      scenarioId: request.scenario.id,
      judgeModel: model,
      scored: [] as ReadonlyArray<ScoredTrajectory>,
      durationMs: 0,
      fallback: { reason: err instanceof Error ? err.message : String(err) },
    })),
  );

  const results = await Promise.all(judgeCalls);

  const entries: PanelJudgeEntry[] = results.map((r) => ({
    judgeModel: r.judgeModel,
    scored: r.scored,
    durationMs: r.durationMs,
    failed: r.fallback ? { reason: r.fallback.reason } : undefined,
  }));

  const surviving = entries.filter((e) => !e.failed && e.scored.length > 0);
  const consensus = averageScores(surviving, request.trajectories);

  return {
    scenarioId: request.scenario.id,
    panel: entries,
    consensus,
    quorum: surviving.length,
    durationMs: Date.now() - startTime,
  };
}

function averageScores(
  surviving: ReadonlyArray<PanelJudgeEntry>,
  trajectories: ReadonlyArray<EvalTrajectory>,
): ScoredTrajectory[] {
  if (surviving.length === 0) {
    return trajectories.map((t, i) => ({
      id: t.id,
      score: 0.5,
      explanation: "Panel returned no usable verdicts — fallback consensus.",
      rank: i + 1,
    }));
  }

  interface ScoreAccumulator {
    total: number;
    count: number;
    explanations: string[];
    flagVotes: number;
    failureVotes: Map<FailureMode, number>;
  }
  const sums = new Map<string, ScoreAccumulator>();
  for (const entry of surviving) {
    for (const scored of entry.scored) {
      const acc: ScoreAccumulator =
        sums.get(scored.id) ??
        { total: 0, count: 0, explanations: [], flagVotes: 0, failureVotes: new Map() };
      acc.total += scored.score;
      acc.count += 1;
      if (scored.genericNonActionable) acc.flagVotes += 1;
      if (scored.failureMode) {
        acc.failureVotes.set(scored.failureMode, (acc.failureVotes.get(scored.failureMode) ?? 0) + 1);
      }
      if (scored.explanation) acc.explanations.push(`[${entry.judgeModel}] ${scored.explanation}`);
      sums.set(scored.id, acc);
    }
  }

  const consensus: ScoredTrajectory[] = trajectories.map((t) => {
    const acc = sums.get(t.id);
    if (!acc || acc.count === 0) {
      return {
        id: t.id,
        score: 0.5,
        explanation: "No judge in the surviving quorum scored this trajectory.",
        rank: 0,
      };
    }
    return {
      id: t.id,
      score: Number((acc.total / acc.count).toFixed(4)),
      explanation: acc.explanations.join(" | "),
      rank: 0,
      // Majority vote across surviving judges — flagged when more than
      // half of the judges that scored this trajectory flagged it.
      genericNonActionable: acc.flagVotes * 2 > acc.count,
      // Plurality vote — the most common failure mode among judges that
      // assigned one; undefined when no judge classified a failure.
      failureMode: pluralityFailureMode(acc.failureVotes),
    };
  });

  consensus.sort((a, b) => b.score - a.score);
  consensus.forEach((s, i) => {
    s.rank = i + 1;
  });
  return consensus;
}

/** Most-voted failure mode; undefined when no judge assigned one. Ties break
 *  by first-seen insertion order (deterministic given a stable iteration). */
function pluralityFailureMode(votes: Map<FailureMode, number>): FailureMode | undefined {
  let best: FailureMode | undefined;
  let bestCount = 0;
  for (const [mode, count] of votes) {
    if (count > bestCount) {
      best = mode;
      bestCount = count;
    }
  }
  return best;
}
