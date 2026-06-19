/**
 * resolveStructuredSchema — the bridge that lets a headless/SDK caller pass an
 * ARBITRARY JSON Schema (compiled via jsonSchemaToZod) to the existing
 * processStructuredMessage path, instead of only the five built-in named
 * schemas. Asserts the compile, the named-lookup, and the error paths.
 */

import { describe, expect, it } from "bun:test";

import { resolveStructuredSchema } from "./index.ts";

describe("resolveStructuredSchema", () => {
  it("compiles an arbitrary JSON schema and validates against it", () => {
    const schema = resolveStructuredSchema({
      jsonSchema: {
        type: "object",
        properties: { verdict: { type: "string" }, score: { type: "number" } },
        required: ["verdict"],
      },
    });
    expect(schema.safeParse({ verdict: "buy", score: 0.8 }).success).toBe(true);
    expect(schema.safeParse({ score: 0.8 }).success).toBe(false); // missing required
  });

  it("resolves a built-in named schema", () => {
    const schema = resolveStructuredSchema({ schemaName: "tradeSignal" });
    expect(
      schema.safeParse({
        symbol: "BTC",
        direction: "long",
        confidence: 0.7,
        reasoning: "momentum",
      }).success,
    ).toBe(true);
  });

  it("throws on an unknown named schema", () => {
    expect(() => resolveStructuredSchema({ schemaName: "nope" })).toThrow(
      /Unknown schema/,
    );
  });

  it("throws when neither schemaName nor jsonSchema is given", () => {
    expect(() => resolveStructuredSchema({})).toThrow(
      /either schemaName or jsonSchema/,
    );
  });

  it("prefers jsonSchema when both are provided", () => {
    const schema = resolveStructuredSchema({
      schemaName: "tradeSignal",
      jsonSchema: {
        type: "object",
        properties: { x: { type: "number" } },
        required: ["x"],
      },
    });
    // tradeSignal would reject {x:1} (it needs symbol/direction/…); the
    // arbitrary jsonSchema accepts it — proving jsonSchema wins.
    expect(schema.safeParse({ x: 1 }).success).toBe(true);
  });
});
