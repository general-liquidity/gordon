/**
 * Structured-output repair loop.
 *
 * Gordon already repairs tool-call STRUCTURE (toolCallReconciler) and retries
 * transient API errors (llm/client.ts). The missing piece was CONTENT-schema
 * repair: a model produces a structured output that fails schema validation, so
 * we re-ask it with the validation error attached, bounded by a retry cap, then
 * fall back. This is the production failure mode "malformed JSON / schema
 * violation" turned into a self-healing loop instead of a hard failure.
 *
 * Provider-agnostic: the caller supplies `produce` (the model call) and
 * `validate` (parse + schema check), so this is pure control flow and fully
 * testable without an LLM. Never throws — failure is returned as `{ ok: false }`.
 */

export interface RepairResult<T> {
  ok: boolean;
  value?: T;
  /** Total produce() attempts made (1 = succeeded first try). */
  attempts: number;
  /** Re-ask repairs performed (attempts − 1). */
  repairs: number;
  /** Validation/produce error from the final failed attempt. */
  error?: string;
  /** Per-failed-attempt error trail. */
  history: string[];
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface RepairOptions<T> {
  /** Produce a candidate output. `repairHint` is null on the first attempt, else the re-ask. */
  produce: (repairHint: string | null) => Promise<string>;
  /** Parse + schema-validate the raw output. */
  validate: (raw: string) => Validation<T>;
  /** Max produce attempts (incl. the first). Default 3. */
  maxAttempts?: number;
  /** Build the re-ask hint from the failure. Default phrases a "fix this" instruction. */
  buildHint?: (error: string, raw: string) => string;
}

export async function repairStructuredOutput<T>(opts: RepairOptions<T>): Promise<RepairResult<T>> {
  const maxAttempts = Math.max(1, Math.floor(opts.maxAttempts ?? 3));
  const buildHint =
    opts.buildHint ??
    ((error: string) =>
      `Your previous output was invalid: ${error}. Return ONLY a corrected output that fixes this — no prose, no code fences.`);

  const history: string[] = [];
  let hint: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw: string;
    try {
      raw = await opts.produce(hint);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      history.push(`produce error: ${msg}`);
      hint = buildHint(msg, "");
      continue; // a produce error is a failed attempt; re-ask
    }
    const v = opts.validate(raw);
    if (v.ok) {
      return { ok: true, value: v.value, attempts: attempt, repairs: attempt - 1, history };
    }
    history.push(v.error);
    hint = buildHint(v.error, raw);
  }

  return {
    ok: false,
    attempts: maxAttempts,
    repairs: maxAttempts - 1,
    error: history[history.length - 1] ?? "validation failed",
    history,
  };
}

/** Lenient JSON extraction: strips ```json fences and grabs the first {...} / [...] block. */
export function parseJsonLenient<T = unknown>(raw: string): Validation<T> {
  const stripped = raw.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.search(/[[{]/);
  if (start === -1) return { ok: false, error: "no JSON object/array found in output" };
  // Match to the last closing brace/bracket (greedy) — handles trailing prose.
  const lastObj = stripped.lastIndexOf("}");
  const lastArr = stripped.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  if (end <= start) return { ok: false, error: "unterminated JSON" };
  try {
    return { ok: true, value: JSON.parse(stripped.slice(start, end + 1)) as T };
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Build a validator that JSON-parses then runs `check` (returns an error string or null). */
export function jsonValidator<T = unknown>(
  check?: (obj: T) => string | null,
): (raw: string) => Validation<T> {
  return (raw: string) => {
    const parsed = parseJsonLenient<T>(raw);
    if (!parsed.ok) return parsed;
    if (check) {
      const err = check(parsed.value);
      if (err) return { ok: false, error: err };
    }
    return parsed;
  };
}
