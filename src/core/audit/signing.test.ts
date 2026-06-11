import { describe, it, expect } from "bun:test";

import {
  computeTraceContentHash,
  signTrace,
  verifyAuditChain,
  GENESIS_SIGNATURE,
} from "./signing.ts";
import type { AuditTrace } from "./types.ts";

const KEY = "test-hmac-key-for-audit-chain";

function makeTrace(details: string): AuditTrace {
  const now = new Date().toISOString();
  return {
    trace_id: crypto.randomUUID(),
    trigger: { type: "system", source: "test", payload_summary: "payload" },
    agent_steps: [
      {
        step_id: crypto.randomUUID(),
        agent_id: "gordon",
        started_at: now,
        ended_at: now,
        reasoning_summary: "reasoning",
        tool_calls: [
          {
            tool_name: "get_market_data",
            input_summary: "BTCUSDT",
            output_summary: "ok",
            duration_ms: 5,
            success: true,
          },
        ],
      },
    ],
    outcome: { type: "no_action", details },
    started_at: now,
    ended_at: now,
    duration_ms: 10,
  };
}

function makeChain(n: number): AuditTrace[] {
  const out: AuditTrace[] = [];
  let prev = GENESIS_SIGNATURE;
  for (let i = 0; i < n; i++) {
    const signed = signTrace(makeTrace(`trace ${i}`), prev, KEY);
    out.push(signed);
    prev = signed.signature!;
  }
  return out;
}

describe("computeTraceContentHash", () => {
  it("is stable and excludes signing fields", () => {
    const trace = makeTrace("x");
    const hash = computeTraceContentHash(trace);
    expect(hash).toBe(computeTraceContentHash(trace));

    const signed = signTrace(trace, GENESIS_SIGNATURE, KEY);
    expect(computeTraceContentHash(signed)).toBe(hash);
  });

  it("treats undefined-valued fields the same as absent fields", () => {
    const trace = makeTrace("x");
    const withUndefined = { ...trace, parent_trace_id: undefined };
    expect(computeTraceContentHash(withUndefined)).toBe(computeTraceContentHash(trace));
  });

  it("changes when content changes", () => {
    const trace = makeTrace("x");
    const tampered = { ...trace, outcome: { ...trace.outcome, details: "y" } };
    expect(computeTraceContentHash(tampered)).not.toBe(computeTraceContentHash(trace));
  });
});

describe("verifyAuditChain", () => {
  it("verifies a well-formed chain", () => {
    const chain = makeChain(3);
    const result = verifyAuditChain(chain, KEY);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(3);
  });

  it("verifies the empty chain", () => {
    expect(verifyAuditChain([], KEY).valid).toBe(true);
  });

  it("detects content tampering at the right index", () => {
    const chain = makeChain(3);
    chain[1] = {
      ...chain[1]!,
      outcome: { ...chain[1]!.outcome, details: "tampered after signing" },
    };
    const result = verifyAuditChain(chain, KEY);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.firstBreak.reason).toBe("content_hash_mismatch");
    expect(result.firstBreak.index).toBe(1);
    expect(result.firstBreak.traceId).toBe(chain[1]!.trace_id);
  });

  it("detects a forged signature", () => {
    const chain = makeChain(2);
    chain[1] = { ...chain[1]!, signature: "0".repeat(64) };
    const result = verifyAuditChain(chain, KEY);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.firstBreak.reason).toBe("signature_mismatch");
    expect(result.firstBreak.index).toBe(1);
  });

  it("detects a removed middle trace as a broken link", () => {
    const chain = makeChain(3);
    const spliced = [chain[0]!, chain[2]!];
    const result = verifyAuditChain(spliced, KEY);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.firstBreak.reason).toBe("chain_link_mismatch");
    expect(result.firstBreak.index).toBe(1);
  });

  it("rejects a chain signed with a different key", () => {
    const chain = makeChain(2);
    const result = verifyAuditChain(chain, "some-other-key");
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.firstBreak.reason).toBe("signature_mismatch");
    expect(result.firstBreak.index).toBe(0);
  });

  it("flags unsigned (pre-signing) traces", () => {
    const result = verifyAuditChain([makeTrace("legacy")], KEY);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.firstBreak.reason).toBe("unsigned_trace");
  });

  it("accepts a window that starts mid-chain (pruned head)", () => {
    const chain = makeChain(4);
    // Pruning legitimately removes the oldest traces.
    const window = chain.slice(2);
    const result = verifyAuditChain(window, KEY);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(2);
  });
});
