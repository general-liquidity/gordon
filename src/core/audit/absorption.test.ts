import { describe, expect, it } from "bun:test";
import { computeTraceContentHash, signTrace, verifyAuditChain, GENESIS_SIGNATURE } from "./signing.ts";
import { classifyHandoffPayload } from "./durability.ts";
import type { AuditTrace, ParentAbsorptionRecord } from "./types.ts";
import { HandoffCoordinator } from "../../infra/agents/orchestrator/HandoffCoordinator.ts";

function baseTrace(): AuditTrace {
  return {
    trace_id: "11111111-1111-1111-1111-111111111111",
    trigger: { type: "agent_handoff", source: "gordon", payload_summary: "delegate research" },
    agent_steps: [
      {
        step_id: "22222222-2222-2222-2222-222222222222",
        agent_id: "gordon",
        started_at: "2026-01-01T00:00:00.000Z",
        reasoning_summary: "spawned researcher",
        tool_calls: [],
      },
    ],
    outcome: { type: "analysis_complete", details: "done" },
    started_at: "2026-01-01T00:00:00.000Z",
  };
}

function absorptionRecord(): ParentAbsorptionRecord {
  return {
    parent_step_id: "22222222-2222-2222-2222-222222222222",
    child_trace_id: "33333333-3333-3333-3333-333333333333",
    status: "absorbed",
    durability_class: "boundary",
    recorded_at: "2026-01-01T00:05:00.000Z",
  };
}

describe("absorptions field lives OUTSIDE the signed content hash", () => {
  it("hashes identically whether absorptions is absent or explicitly undefined", () => {
    const base = baseTrace();
    const withUndefined: AuditTrace = { ...base, absorptions: undefined };
    expect(computeTraceContentHash(withUndefined)).toBe(computeTraceContentHash(base));
  });

  it("hashes identically whether absorptions is absent or POPULATED (unsigned annotation)", () => {
    const base = baseTrace();
    const withAbsorptions: AuditTrace = { ...base, absorptions: [absorptionRecord()] };
    // Load-bearing: unlike durability_class, a populated absorptions field must
    // NOT change the content hash — it is excluded via SIGNING_FIELDS.
    expect(computeTraceContentHash(withAbsorptions)).toBe(computeTraceContentHash(base));
  });

  it("keeps a signed trace verifiable after absorptions is attached post-hoc", () => {
    const key = "test-hmac-key";
    const signed = signTrace(baseTrace(), GENESIS_SIGNATURE, key);
    expect(verifyAuditChain([signed], key).valid).toBe(true);

    // Annotate the already-signed trace — no re-signing.
    const annotated: AuditTrace = { ...signed, absorptions: [absorptionRecord()] };
    expect(annotated.content_hash).toBe(signed.content_hash);
    expect(annotated.signature).toBe(signed.signature);
    expect(verifyAuditChain([annotated], key).valid).toBe(true);
  });

  it("still detects tampering of signed content when absorptions is present", () => {
    const key = "test-hmac-key";
    const signed = signTrace(baseTrace(), GENESIS_SIGNATURE, key);
    const tampered: AuditTrace = {
      ...signed,
      absorptions: [absorptionRecord()],
      outcome: { ...signed.outcome, details: "TAMPERED" },
    };
    const result = verifyAuditChain([tampered], key);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.firstBreak.reason).toBe("content_hash_mismatch");
  });
});

describe("HandoffCoordinator.recordAbsorption", () => {
  it("records a boundary-durable parent -> child link", () => {
    const coord = new HandoffCoordinator();
    const rec = coord.recordAbsorption(
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
      "absorbed",
      "used the risk section",
    );
    expect(rec.parent_step_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(rec.child_trace_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(rec.status).toBe("absorbed");
    expect(rec.note).toBe("used the risk section");
    // Reuses the durability boundary tier.
    expect(rec.durability_class).toBe(classifyHandoffPayload("absorption"));
    expect(rec.durability_class).toBe("boundary");
  });

  it("distinguishes absorbed from dropped and queries per parent step", () => {
    const coord = new HandoffCoordinator();
    coord.recordAbsorption("stepA", "traceX", "absorbed");
    coord.recordAbsorption("stepA", "traceY", "dropped");
    coord.recordAbsorption("stepB", "traceZ", "observed");

    expect(coord.getAbsorptions()).toHaveLength(3);
    const forA = coord.getAbsorptionsForStep("stepA");
    expect(forA.map((a) => a.status)).toEqual(["absorbed", "dropped"]);
    expect(coord.getAbsorptionsForStep("stepB")).toHaveLength(1);
  });

  it("omits note when not provided", () => {
    const coord = new HandoffCoordinator();
    const rec = coord.recordAbsorption("s", "t", "observed");
    expect(rec.note).toBeUndefined();
    expect("note" in rec).toBe(false);
  });

  it("clears absorptions on clear()", () => {
    const coord = new HandoffCoordinator();
    coord.recordAbsorption("s", "t", "absorbed");
    coord.clear();
    expect(coord.getAbsorptions()).toHaveLength(0);
  });
});
