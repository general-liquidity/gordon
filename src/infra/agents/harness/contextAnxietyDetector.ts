/**
 * Context Anxiety Detector (GORDON_CONTEXT_ANXIETY_DETECTOR).
 *
 * Port of the "context anxiety" failure mode named in Anthropic's
 * "Harness Design for Long-Running Application Development" (2026):
 *
 *   "Some models also exhibit 'context anxiety,' in which they begin
 *    wrapping up work prematurely as they approach what they believe is
 *    their context limit."
 *
 * The agent isn't actually out of context — it just thinks it is, and
 * starts cutting corners: summarizing instead of progressing, skipping
 * verification steps, marking tasks done that aren't. Hard to spot from
 * the outside without explicit signals.
 *
 * This primitive watches the agent's recent turns for behavioural signals:
 *
 *   1. wrap-up phrases   — "to summarize", "in conclusion", "let me wrap up"
 *                           appearing mid-task (not at a natural end point)
 *   2. self-references   — "I'm running low on context", "to save tokens",
 *                           "to be efficient"
 *   3. output-length drop — recent turn length sharply below the rolling
 *                           average
 *   4. tool-call density  — fewer tool calls per response over time
 *                           (agent producing more text and doing less)
 *
 * The signals are heuristic; the primitive returns a verdict with the
 * signals that fired plus an aggregate score. The CALLER decides what
 * to do — typically: stop the agent, force a clean context, or prompt
 * the user with a "false alarm" check.
 */

export const CONTEXT_ANXIETY_FLAG_ENV = "GORDON_CONTEXT_ANXIETY_DETECTOR";

export type AnxietySignalType =
  | "wrap_up_phrase"
  | "context_self_ref"
  | "output_length_drop"
  | "tool_density_drop";

export interface AnxietySignal {
  type: AnxietySignalType;
  evidence: string;
  /** 0..1 — how confident we are this is a real signal vs. noise. */
  confidence: number;
}

export interface AgentTurn {
  /** Turn index in the session (0-based). */
  index: number;
  /** Agent's text output for this turn. */
  text: string;
  /** Number of tool calls the agent made on this turn. */
  toolCalls: number;
}

export interface AnxietyVerdict {
  /** Aggregate anxiety score 0..1. */
  anxiety: number;
  signals: AnxietySignal[];
  isAnxious: boolean;
  /** Concrete next-step recommendation. */
  recommendation: string;
}

export interface DetectOptions {
  /** Threshold above which `isAnxious` is true. Default 0.5. */
  threshold?: number;
  /** Output-length drop ratio that triggers a signal. Default 0.4 (40%). */
  outputDropRatio?: number;
  /** Tool-density drop ratio that triggers a signal. Default 0.4. */
  toolDensityDropRatio?: number;
  /** How many recent turns count as "current window." Default 3. */
  recentWindow?: number;
}

const WRAP_UP_PATTERNS: ReadonlyArray<RegExp> = [
  /\bto\s+summari[sz]e\b/i,
  /\bin\s+conclusion\b/i,
  /\bin\s+summary\b/i,
  /\blet\s+me\s+wrap\s+(?:this|it)?\s*up\b/i,
  /\bwrap(?:ping)?\s+(?:this|it)?\s*up\b/i,
  /\bI(?:'|')?ll\s+(?:finish|conclude|wrap)\b/i,
  /\bfinal(?:ly|izing)\b/i,
];

const CONTEXT_SELF_REF_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:running|getting)\s+(?:low|short)\s+on\s+(?:context|tokens|space)\b/i,
  /\bto\s+(?:save|preserve|conserve)\s+(?:tokens|context|space)\b/i,
  /\bbe\s+(?:more\s+)?efficient\s+with\s+(?:tokens|context)\b/i,
  /\bcontext\s+(?:window|limit)\b/i,
  /\bnot\s+(?:enough\s+)?(?:tokens|context)\s+(?:left|remaining)\b/i,
];

export function isContextAnxietyDetectorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CONTEXT_ANXIETY_FLAG_ENV] === "1" || env[CONTEXT_ANXIETY_FLAG_ENV] === "true";
}

function average(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Detect anxiety signals across the supplied history. `history` should
 * be ordered oldest-first.
 *
 * Heuristic: a wrap-up phrase mid-stream (i.e. with substantial history
 * still pending — definable by the caller via the recentWindow) is the
 * strongest signal. Self-references to context are next. Length and
 * density drops are weaker but reinforce.
 */
export function detectAnxiety(
  history: readonly AgentTurn[],
  opts: DetectOptions = {},
): AnxietyVerdict {
  const threshold = opts.threshold ?? 0.5;
  const outputDropRatio = opts.outputDropRatio ?? 0.4;
  const toolDensityDropRatio = opts.toolDensityDropRatio ?? 0.4;
  const recentWindow = opts.recentWindow ?? 3;

  const signals: AnxietySignal[] = [];

  if (history.length === 0) {
    return {
      anxiety: 0,
      signals: [],
      isAnxious: false,
      recommendation: "no history supplied — nothing to detect",
    };
  }

  const recent = history.slice(-recentWindow);
  const baselineSlice = history.slice(0, -recentWindow);

  // 1. wrap-up phrases in recent turns
  for (const turn of recent) {
    for (const pattern of WRAP_UP_PATTERNS) {
      const m = turn.text.match(pattern);
      if (m) {
        signals.push({
          type: "wrap_up_phrase",
          evidence: `turn ${turn.index}: "${m[0]}"`,
          confidence: 0.7,
        });
        break;
      }
    }
  }

  // 2. context self-references
  for (const turn of recent) {
    for (const pattern of CONTEXT_SELF_REF_PATTERNS) {
      const m = turn.text.match(pattern);
      if (m) {
        signals.push({
          type: "context_self_ref",
          evidence: `turn ${turn.index}: "${m[0]}"`,
          confidence: 0.85,
        });
        break;
      }
    }
  }

  // 3. output length drop
  if (baselineSlice.length >= 2) {
    const baselineAvgLen = average(baselineSlice.map((t) => t.text.length));
    const recentAvgLen = average(recent.map((t) => t.text.length));
    if (baselineAvgLen > 0 && recentAvgLen < baselineAvgLen * outputDropRatio) {
      signals.push({
        type: "output_length_drop",
        evidence: `recent avg ${recentAvgLen.toFixed(0)} chars vs baseline ${baselineAvgLen.toFixed(0)}`,
        confidence: 0.55,
      });
    }
  }

  // 4. tool-call density drop
  if (baselineSlice.length >= 2) {
    const baselineAvgTools = average(baselineSlice.map((t) => t.toolCalls));
    const recentAvgTools = average(recent.map((t) => t.toolCalls));
    if (baselineAvgTools > 0 && recentAvgTools < baselineAvgTools * toolDensityDropRatio) {
      signals.push({
        type: "tool_density_drop",
        evidence: `recent avg ${recentAvgTools.toFixed(2)} tools/turn vs baseline ${baselineAvgTools.toFixed(2)}`,
        confidence: 0.5,
      });
    }
  }

  // Aggregate: anxiety = max signal confidence, with a +0.1 boost per
  // additional unique signal type. Clamped to [0,1].
  const distinctTypes = new Set(signals.map((s) => s.type)).size;
  const maxConf = signals.reduce((m, s) => Math.max(m, s.confidence), 0);
  const breadthBonus = Math.max(0, distinctTypes - 1) * 0.1;
  const anxiety = Math.min(1, maxConf + breadthBonus);

  const isAnxious = anxiety >= threshold;

  let recommendation: string;
  if (!isAnxious) {
    recommendation = "no action — agent appears engaged";
  } else if (signals.some((s) => s.type === "context_self_ref")) {
    recommendation =
      "force a clean context window and confirm to the agent that there IS sufficient context — the self-reference is the strongest false-alarm signal";
  } else if (signals.some((s) => s.type === "wrap_up_phrase")) {
    recommendation =
      "interrupt before the wrap-up settles. Ask the agent what it has NOT done yet; do not let it write a summary";
  } else {
    recommendation = "investigate — output/tool drop without explicit wrap-up may also be normal slowing";
  }

  return { anxiety, signals, isAnxious, recommendation };
}

export function formatAnxietyVerdict(verdict: AnxietyVerdict): string {
  const lines: string[] = [];
  lines.push(
    `Context anxiety: ${verdict.isAnxious ? "DETECTED" : "clear"} (score=${verdict.anxiety.toFixed(2)})`,
  );
  for (const s of verdict.signals) {
    lines.push(`  [${s.type}] confidence=${s.confidence.toFixed(2)} — ${s.evidence}`);
  }
  lines.push(`  recommendation: ${verdict.recommendation}`);
  return lines.join("\n");
}

export function verdictToPayload(verdict: AnxietyVerdict): Record<string, unknown> {
  return {
    kind: "context_anxiety.verdict_recorded",
    isAnxious: verdict.isAnxious,
    anxiety: verdict.anxiety,
    signalCount: verdict.signals.length,
    signalTypes: Array.from(new Set(verdict.signals.map((s) => s.type))),
    recommendation: verdict.recommendation,
  };
}
