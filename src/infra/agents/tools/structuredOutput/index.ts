/**
 * structured_output — forced schema-validated final output for HEADLESS / SDK runs.
 *
 * Gordon's interactive TUI emits free-form text. Non-interactive consumers
 * (gateway `chat.send_message`, core-sdk, ACP) sometimes need a typed verdict
 * the run is guaranteed to produce — a trade signal, a risk decision, a scan
 * summary — shaped to a schema the *caller* supplies for that one run.
 *
 * This mirrors Claude Code's `SyntheticOutputTool`: a tool the model must call
 * exactly once at the end of the run with a payload matching a caller-supplied
 * JSON schema. On mismatch the tool returns a validation-error result (it does
 * NOT throw) so the model can read the errors and retry; on a match it echoes
 * the validated object back as the run's final structured result.
 *
 * Distinct from the existing `processStructuredMessage` / `RESPONSE_SCHEMAS`
 * path (Mastra `generate({ structuredOutput })` keyed to a *fixed named* schema
 * registry). That path post-hoc constrains the whole completion to one of a
 * handful of built-in shapes; this one lets a headless caller pass an arbitrary
 * schema per run and keeps Gordon's full tool-use loop intact, capturing the
 * verdict as a tool call at the end.
 *
 * The tool is present ONLY when a run requests an output schema (see
 * {@link buildStructuredOutputTools}). It is NOT registered in the hot tier and
 * does not change interactive behavior — interactive runs never request a
 * schema, so the spread is empty and the tool is absent/inert.
 *
 * Schema compilation is zod-native and dependency-free: the caller's JSON
 * Schema (object / draft-07 subset that LLM output schemas use) is compiled to
 * a Zod schema via {@link jsonSchemaToZod}, reusing Gordon's zod/validation
 * conventions rather than pulling in Ajv.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { jsonSchemaToZod, type JsonSchema } from "./jsonSchemaToZod.ts";

/** Canonical tool id. Matches Claude Code's surfaced name (snake_cased for Gordon). */
export const STRUCTURED_OUTPUT_TOOL_ID = "structured_output";

/** Result shape the tool returns on a successful, schema-valid payload. */
export interface StructuredOutputSuccess {
  ok: true;
  /** The validated (and zod-coerced) payload — this is the run's final structured result. */
  structured_output: Record<string, unknown>;
  message: string;
}

/** Result shape the tool returns on a schema mismatch — model is expected to retry. */
export interface StructuredOutputValidationError {
  ok: false;
  /** Always set so the model can branch on a stable flag. */
  validation_error: true;
  /** Human-readable, path-prefixed issues the model can correct from. */
  errors: string[];
  message: string;
}

export type StructuredOutputResult =
  | StructuredOutputSuccess
  | StructuredOutputValidationError;

/** Type guard — true when the tool emitted a final validated result. */
export function isStructuredOutputSuccess(
  result: unknown,
): result is StructuredOutputSuccess {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as StructuredOutputSuccess).ok === true &&
    "structured_output" in result
  );
}

/**
 * Build a `structured_output` tool bound to a specific caller-supplied JSON
 * schema. Mastra validates the model's tool input against the tool's declared
 * `inputSchema` BEFORE `execute` runs; a zod-compiled schema would make Mastra
 * reject mismatched calls opaquely (the model loses the diagnostics). So the
 * declared input is intentionally permissive (`passthrough`) and the real
 * gate lives inside `execute`, which `safeParse`s against the compiled schema
 * and returns a structured validation-error result on mismatch — letting the
 * model read the errors and call again. Same design as Claude Code's
 * SyntheticOutputTool (Ajv-validate inside `call`, surface errors for retry).
 */
export function createStructuredOutputTool(jsonSchema: JsonSchema) {
  const compiled = jsonSchemaToZod(jsonSchema);

  const description =
    "Return your FINAL response as structured JSON matching the caller's " +
    "requested schema. You MUST call this tool exactly once, at the very end " +
    "of the run, with a payload that satisfies the schema. If the payload does " +
    "not match, this tool returns the validation errors instead of finishing — " +
    "read them, fix the payload, and call again.";

  return createTool({
    id: STRUCTURED_OUTPUT_TOOL_ID,
    description,
    // Permissive on purpose — real validation happens in execute so the model
    // gets correctable error text rather than an opaque Mastra schema reject.
    inputSchema: z.object({}).passthrough(),
    // Discriminated on `ok` so the inferred output type IS the
    // StructuredOutputResult union (success vs validation-error), matching the
    // execute return rather than a loose `{ ok: boolean }`.
    outputSchema: z.discriminatedUnion("ok", [
      z.object({
        ok: z.literal(true),
        structured_output: z.record(z.string(), z.unknown()),
        message: z.string(),
      }),
      z.object({
        ok: z.literal(false),
        validation_error: z.literal(true),
        errors: z.array(z.string()),
        message: z.string(),
      }),
    ]),
    execute: async (input: Record<string, unknown>): Promise<StructuredOutputResult> => {
      const parsed = compiled.safeParse(input);
      if (parsed.success) {
        return {
          ok: true,
          structured_output: parsed.data as Record<string, unknown>,
          message: "Structured output accepted as the final result.",
        };
      }
      const errors = parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "root";
        return `${path}: ${issue.message}`;
      });
      return {
        ok: false,
        validation_error: true,
        errors,
        message:
          "Output does not match the required schema. Correct the listed fields " +
          "and call structured_output again with a valid payload.",
      };
    },
  });
}

/**
 * Tool-spread factory for agent registration.
 *
 * Returns `{ structured_output }` only when the run actually requested an
 * output schema; otherwise an empty object so the tool is absent from the
 * agent's surface (interactive runs are unaffected, no schema-token cost).
 *
 * Intended registration (in the three agent-definition files, e.g. gordon.ts):
 *
 *   ...buildStructuredOutputTools(resolveRunOutputSchema())
 *
 * where `resolveRunOutputSchema()` returns the JSON schema the SDK/gateway
 * caller attached to this run (or undefined). See the module docs for the
 * request-field plumbing.
 */
export function buildStructuredOutputTools(
  jsonSchema?: JsonSchema | null,
): Record<string, ReturnType<typeof createStructuredOutputTool>> {
  if (!jsonSchema) return {};
  return { [STRUCTURED_OUTPUT_TOOL_ID]: createStructuredOutputTool(jsonSchema) };
}

export type { JsonSchema } from "./jsonSchemaToZod.ts";
export { jsonSchemaToZod } from "./jsonSchemaToZod.ts";
