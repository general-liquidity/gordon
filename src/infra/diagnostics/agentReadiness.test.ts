import { describe, it, expect } from "bun:test";
import {
  checkAgentReadiness,
  isAgentReadinessEnabled,
  AGENT_READINESS_FLAG_ENV,
} from "./agentReadiness.ts";

describe("agentReadiness", () => {
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
});