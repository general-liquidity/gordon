/**
 * Structured Output Enforcement (GORDON_STRUCTURED_OUTPUT_ENFORCEMENT).
 *
 * Schema-validates tool results or final agent payloads against a Zod
 * schema before they propagate. On mismatch the hook blocks with a
 * structured reprompt so the caller can either reject the action or
 * inject the reprompt into the next model turn.
 *
 * Trading-domain motivation: plan cards, risk verdicts, kill-list
 * results, and pre-trade gate payloads all have strict shapes today.
 * Centralizing schema validation as a hook means the same enforcement
 * applies whether the payload originates from a tool, a sub-agent, or
 * an external producer.
 *
 * Pattern port from Claude Code's `registerStructuredOutputEnforcement`
 * (utils/hooks/hookHelpers.ts) — same intent (verify a typed response
 * exists at the gate point) but Gordon dispatches via the existing
 * hook engine rather than threading session state through React.
 */

import type { z, ZodType } from "zod";
import type {
  HookDefinition,
  HookResult,
  PostToolUsePayload,
} from "./types.ts";

export const STRUCTURED_OUTPUT_ENFORCEMENT_FLAG_ENV =
  "GORDON_STRUCTURED_OUTPUT_ENFORCEMENT";

export function isStructuredOutputEnforcementEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[STRUCTURED_OUTPUT_ENFORCEMENT_FLAG_ENV] === "1" ||
    env[STRUCTURED_OUTPUT_ENFORCEMENT_FLAG_ENV] === "true"
  );
}

export interface StructuredValidationOk<T> {
  ok: true;
  value: T;
}

export interface StructuredValidationFail {
  ok: false;
  reason: string;
  issues: string[];
  reprompt: string;
}

export type StructuredValidationResult<T> =
  | StructuredValidationOk<T>
  | StructuredValidationFail;

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join(".") : "(root)";
    return `${path}: ${i.message}`;
  });
}

function buildReprompt(toolName: string | undefined, issues: string[]): string {
  const where = toolName ? ` from ${toolName}` : "";
  const list = issues.map((i) => `  - ${i}`).join("\n");
  return `The structured output${where} did not match the required schema. Fix and re-emit a response satisfying:\n${list}`;
}

export function validateStructuredOutput<T>(
  value: unknown,
  schema: ZodType<T>,
  opts: { toolName?: string } = {},
): StructuredValidationResult<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  const issues = formatIssues(parsed.error);
  return {
    ok: false,
    reason: `schema validation failed (${issues.length} issue${issues.length === 1 ? "" : "s"})`,
    issues,
    reprompt: buildReprompt(opts.toolName, issues),
  };
}

export interface CreatePostToolOutputHookOptions<T> {
  /** Stable id for the hook (used in logs / removal). */
  id: string;
  /** Schema the tool result must satisfy. */
  schema: ZodType<T>;
  /**
   * Tool name (or RegExp) to scope the hook to. Required so a single
   * hook doesn't accidentally schema-check unrelated tools.
   */
  toolFilter: string | RegExp;
  /** Extract the value-to-validate from the tool result. Default: identity. */
  extract?: (result: unknown) => unknown;
  /** Priority (default 50 — runs before generic post-tool hooks). */
  priority?: number;
  /** Hook source for audit. Default "builtin". */
  source?: HookDefinition["source"];
  /**
   * When true, mismatches return `modify` with the reprompt attached
   * instead of `block`. Useful when the orchestrator wants to retry
   * the model with the reprompt rather than fail hard. Default false.
   */
  repromptInsteadOfBlock?: boolean;
  /** Optional observer for structured failures (for telemetry). */
  onFailure?: (
    payload: PostToolUsePayload,
    result: StructuredValidationFail,
  ) => void;
}

export function createPostToolOutputSchemaHook<T>(
  opts: CreatePostToolOutputHookOptions<T>,
): HookDefinition<"PostToolUse"> {
  const extract = opts.extract ?? ((r: unknown) => r);
  return {
    id: opts.id,
    point: "PostToolUse",
    toolFilter: opts.toolFilter,
    priority: opts.priority ?? 50,
    source: opts.source ?? "builtin",
    handler: (payload: PostToolUsePayload): HookResult => {
      if (!payload.success) {
        return { action: "allow" };
      }
      const candidate = extract(payload.result);
      const validation = validateStructuredOutput(candidate, opts.schema, {
        toolName: payload.toolName,
      });
      if (validation.ok) {
        return { action: "allow" };
      }
      opts.onFailure?.(payload, validation);
      if (opts.repromptInsteadOfBlock) {
        return {
          action: "modify",
          reason: validation.reason,
          replacement: {
            __structuredOutputReprompt: validation.reprompt,
            issues: validation.issues,
            originalResult: payload.result,
          },
          metadata: { structuredOutputEnforcement: "reprompt" },
        };
      }
      return {
        action: "block",
        reason: `${payload.toolName}: ${validation.reason}`,
        metadata: {
          structuredOutputEnforcement: "block",
          issues: validation.issues,
          reprompt: validation.reprompt,
        },
      };
    },
  };
}

export interface CreatePreToolInputHookOptions<T> {
  id: string;
  schema: ZodType<T>;
  toolFilter: string | RegExp;
  extract?: (args: unknown) => unknown;
  priority?: number;
  source?: HookDefinition["source"];
  onFailure?: (
    args: unknown,
    result: StructuredValidationFail,
  ) => void;
}

/**
 * Complementary helper: validate tool *inputs* against a schema before
 * the tool runs. Catches malformed args the model emits before they
 * reach the order layer. Always blocks on mismatch — there's no
 * "modify" path for inputs at the hook level.
 */
export function createPreToolInputSchemaHook<T>(
  opts: CreatePreToolInputHookOptions<T>,
): HookDefinition<"PreToolUse"> {
  const extract = opts.extract ?? ((a: unknown) => a);
  return {
    id: opts.id,
    point: "PreToolUse",
    toolFilter: opts.toolFilter,
    priority: opts.priority ?? 50,
    source: opts.source ?? "builtin",
    handler: (payload): HookResult => {
      const candidate = extract(payload.args);
      const validation = validateStructuredOutput(candidate, opts.schema, {
        toolName: payload.toolName,
      });
      if (validation.ok) {
        return { action: "allow" };
      }
      opts.onFailure?.(payload.args, validation);
      return {
        action: "block",
        reason: `${payload.toolName} input: ${validation.reason}`,
        metadata: {
          structuredOutputEnforcement: "input_block",
          issues: validation.issues,
          reprompt: validation.reprompt,
        },
      };
    },
  };
}
