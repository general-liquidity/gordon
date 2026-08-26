import { describe, it, expect } from "bun:test";
import * as agentReadiness from "./agentReadiness.ts";
import {
  checkAgentReadiness,
  isAgentReadinessEnabled,
  AGENT_READINESS_FLAG_ENV,
} from "./agentReadiness.ts";

describe("agentReadiness", () => {
  it("exposes no override flag", () => {
    // GORDON_AGENT_READINESS_OVERRIDE overrode nothing: with no gate to
    // bypass it only suppressed the doctor rows, which is what leaving
    // GORDON_AGENT_READINESS_GATE off already does.
    const names = Object.keys(agentReadiness);
    expect(names).not.toContain("isAgentReadinessOverridden");
    expect(names).not.toContain("AGENT_READINESS_OVERRIDE_ENV");
  });

  it("is disabled by default", () => {
    const env = { ...process.env };
    delete env[AGENT_READINESS_FLAG_ENV];
    expect(isAgentReadinessEnabled(env)).toBe(false);
  });

  it("reports readiness with LLM key hint", () => {
    const result = checkAgentReadiness({ hasLlmKey: true });
    expect(result.conditions.length).toBeGreaterThan(0);
    expect(result.conditions.some((c) => c.id === "can_hand_off")).toBe(true);
  });

  it("carries no condition that is ok regardless of input", () => {
    // `can_test` reported ok: true with the message "Eval harness modules
    // loadable" without probing anything. A row that cannot fail is not
    // evidence, and in a readiness report it reads as if it were.
    const best = checkAgentReadiness({ gordonHome: process.cwd(), hasLlmKey: true });
    const worst = checkAgentReadiness({ gordonHome: "/gordon-does-not-exist", hasLlmKey: false });
    const alwaysOk = best.conditions
      .filter((c) => c.ok)
      .filter((c) => worst.conditions.find((w) => w.id === c.id)?.ok === true)
      .map((c) => c.id);
    expect(alwaysOk).toEqual([]);
  });
});