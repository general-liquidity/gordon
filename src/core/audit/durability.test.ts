import { describe, expect, it } from "bun:test";
import {
  DEFAULT_OFFLOAD_LIMIT,
  applyDurabilityTruncation,
  classifyHandoffPayload,
  isLossless,
  resolveDurabilityClass,
} from "./durability.ts";
import { computeTraceContentHash } from "./signing.ts";
import type { AuditTrace } from "./types.ts";

describe("durability classification", () => {
  it("classifies handoff payload kinds as boundary", () => {
    expect(classifyHandoffPayload("dispatch_in")).toBe("boundary");
    expect(classifyHandoffPayload("child_deliverable")).toBe("boundary");
    expect(classifyHandoffPayload("absorption")).toBe("boundary");
  });

  it("treats absent class as bestEffort", () => {
    expect(resolveDurabilityClass(undefined)).toBe("bestEffort");
    expect(resolveDurabilityClass("boundary")).toBe("boundary");
    expect(isLossless(undefined)).toBe(false);
    expect(isLossless("bestEffort")).toBe(false);
    expect(isLossless("boundary")).toBe(true);
  });
});

describe("applyDurabilityTruncation", () => {
  const big = "x".repeat(DEFAULT_OFFLOAD_LIMIT + 500);

  it("stores boundary payloads lossless", () => {
    expect(applyDurabilityTruncation(big, "boundary")).toBe(big);
    expect(applyDurabilityTruncation(big, "boundary").length).toBe(big.length);
  });

  it("truncates bestEffort payloads to the offload limit with an elision marker", () => {
    const out = applyDurabilityTruncation(big, "bestEffort");
    expect(out.length).toBeLessThanOrEqual(DEFAULT_OFFLOAD_LIMIT);
    expect(out).toContain("chars offloaded");
  });

  it("truncates unclassified (absent) payloads like bestEffort", () => {
    const out = applyDurabilityTruncation(big, undefined);
    expect(out.length).toBeLessThanOrEqual(DEFAULT_OFFLOAD_LIMIT);
  });

  it("leaves short payloads unchanged", () => {
    expect(applyDurabilityTruncation("short", "bestEffort")).toBe("short");
  });
});

describe("HMAC chain is not disturbed by the optional field", () => {
  it("hashes identically whether durability_class is absent or explicitly undefined", () => {
    const base: AuditTrace = {
      trace_id: "11111111-1111-1111-1111-111111111111",
      trigger: { type: "system", source: "test", payload_summary: "p" },
      agent_steps: [
        {
          step_id: "22222222-2222-2222-2222-222222222222",
          agent_id: "gordon",
          started_at: "2026-01-01T00:00:00.000Z",
          reasoning_summary: "r",
          tool_calls: [
            {
              tool_name: "t",
              input_summary: "i",
              output_summary: "o",
              duration_ms: 1,
              success: true,
            },
          ],
        },
      ],
      outcome: { type: "no_action", details: "d" },
      started_at: "2026-01-01T00:00:00.000Z",
    };
    const withUndefined: AuditTrace = structuredClone(base);
    withUndefined.agent_steps[0]!.durability_class = undefined;
    withUndefined.agent_steps[0]!.tool_calls[0]!.durability_class = undefined;
    expect(computeTraceContentHash(withUndefined)).toBe(computeTraceContentHash(base));
  });

  it("changes the hash when a boundary class is actually set (signed into the record)", () => {
    const base: AuditTrace = {
      trace_id: "11111111-1111-1111-1111-111111111111",
      trigger: { type: "system", source: "test", payload_summary: "p" },
      agent_steps: [
        {
          step_id: "22222222-2222-2222-2222-222222222222",
          agent_id: "gordon",
          started_at: "2026-01-01T00:00:00.000Z",
          reasoning_summary: "r",
          tool_calls: [],
        },
      ],
      outcome: { type: "no_action", details: "d" },
      started_at: "2026-01-01T00:00:00.000Z",
    };
    const boundary = structuredClone(base);
    boundary.agent_steps[0]!.durability_class = "boundary";
    expect(computeTraceContentHash(boundary)).not.toBe(computeTraceContentHash(base));
  });
});
