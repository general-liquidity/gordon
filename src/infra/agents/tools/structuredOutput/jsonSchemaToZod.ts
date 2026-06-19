/**
 * Minimal, dependency-free JSON-Schema → Zod compiler.
 *
 * Covers the draft-07 subset that LLM-facing output schemas actually use:
 * object / array / string / number / integer / boolean / null, `enum`,
 * `const`, `required`, `properties`, `items`, `additionalProperties`,
 * `nullable`, and the common string/number range keywords. This is the same
 * surface Claude Code's SyntheticOutputTool feeds to Ajv — Gordon compiles to
 * Zod instead so it can reuse the repo's existing `safeParse` error-shaping
 * conventions and avoid adding Ajv as a dependency.
 *
 * Anything outside the supported subset (unions via `oneOf`/`anyOf`,
 * `$ref`, `allOf`, pattern-properties, tuple `items`) degrades to a passthrough
 * `z.unknown()` for that node rather than throwing — the goal is a usable
 * validation gate for forced agent output, not a spec-complete validator.
 */

import { z } from "zod";

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  additionalProperties?: boolean | JsonSchema;
  nullable?: boolean;
  description?: string;
  // String
  minLength?: number;
  maxLength?: number;
  // Number
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  // Array
  minItems?: number;
  maxItems?: number;
  [key: string]: unknown;
}

function applyNullable(schema: z.ZodTypeAny, node: JsonSchema): z.ZodTypeAny {
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  if (node.nullable === true || types.includes("null")) {
    return schema.nullable();
  }
  return schema;
}

function buildString(node: JsonSchema): z.ZodTypeAny {
  let s = z.string();
  if (typeof node.minLength === "number") s = s.min(node.minLength);
  if (typeof node.maxLength === "number") s = s.max(node.maxLength);
  return s;
}

function buildNumber(node: JsonSchema, integer: boolean): z.ZodTypeAny {
  let n = z.number();
  if (integer) n = n.int();
  if (typeof node.minimum === "number") n = n.min(node.minimum);
  if (typeof node.maximum === "number") n = n.max(node.maximum);
  if (typeof node.exclusiveMinimum === "number") n = n.gt(node.exclusiveMinimum);
  if (typeof node.exclusiveMaximum === "number") n = n.lt(node.exclusiveMaximum);
  return n;
}

function buildArray(node: JsonSchema): z.ZodTypeAny {
  const inner = node.items ? jsonSchemaToZod(node.items) : z.unknown();
  let a = z.array(inner);
  if (typeof node.minItems === "number") a = a.min(node.minItems);
  if (typeof node.maxItems === "number") a = a.max(node.maxItems);
  return a;
}

function buildObject(node: JsonSchema): z.ZodTypeAny {
  const props = node.properties ?? {};
  const required = new Set(node.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, childSchema] of Object.entries(props)) {
    const child = jsonSchemaToZod(childSchema);
    shape[key] = required.has(key) ? child : child.optional();
  }

  const base = z.object(shape);
  // `additionalProperties: false` (or omitted on a fully-specified object) →
  // strict; otherwise allow extras to pass through. LLM schemas usually set
  // false to pin the shape, which is the stricter, safer default for a verdict.
  if (node.additionalProperties === false) {
    return base.strict();
  }
  return base.passthrough();
}

/**
 * Compile a JSON Schema node into a Zod schema. Always returns a usable
 * validator — unsupported constructs collapse to `z.unknown()` for that node.
 */
export function jsonSchemaToZod(node: JsonSchema): z.ZodTypeAny {
  if (!node || typeof node !== "object") return z.unknown();

  // `const` — exact value match.
  if ("const" in node && node.const !== undefined) {
    return applyNullable(
      z.literal(node.const as Parameters<typeof z.literal>[0]),
      node,
    );
  }

  // `enum` — closed set. z.enum needs string literals; fall back to a refine
  // for mixed/non-string enums.
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const values = node.enum;
    const allStrings = values.every((v) => typeof v === "string");
    if (allStrings) {
      return applyNullable(
        z.enum(values as [string, ...string[]]),
        node,
      );
    }
    return applyNullable(
      z.unknown().refine((v) => values.some((e) => Object.is(e, v) || e === v), {
        message: `must be one of: ${values.map((v) => JSON.stringify(v)).join(", ")}`,
      }),
      node,
    );
  }

  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  const primaryType = types.find((t) => t !== "null");

  let built: z.ZodTypeAny;
  switch (primaryType) {
    case "string":
      built = buildString(node);
      break;
    case "number":
      built = buildNumber(node, false);
      break;
    case "integer":
      built = buildNumber(node, true);
      break;
    case "boolean":
      built = z.boolean();
      break;
    case "object":
      built = buildObject(node);
      break;
    case "array":
      built = buildArray(node);
      break;
    case "null":
      return z.null();
    default:
      // No usable type but has `properties` → treat as object.
      if (node.properties) {
        built = buildObject(node);
      } else {
        built = z.unknown();
      }
  }

  return applyNullable(built, node);
}
