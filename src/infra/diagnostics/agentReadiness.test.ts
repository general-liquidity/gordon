import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isAgentReadinessGateEnabled,
  checkAgentReadiness,
  hasReadinessOverride,
  readinessToPayload,
  type ReadinessInputs,
} from "./agentReadiness.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-readiness-test-"));
});

describe("isAgentReadinessGateEnabled", () => {
  it("respects the flag", () => {
    expect(isAgentReadinessGateEnabled({})).toBe(false);
    expect(isAgentReadinessGateEnabled({ GORDON_AGENT_READINESS_GATE: "1" })).toBe(true);
    expect(isAgentReadinessGateEnabled({ GORDON_AGENT_READINESS_GATE: "true" })).toBe(true);
  });
});

describe("hasReadinessOverride", () => {
  it("respects the override env var", () => {
    expect(hasReadinessOverride({})).toBe(false);
    expect(hasReadinessOverride({ GORDON_AGENT_READINESS_OVERRIDE: "1" })).toBe(true);
  });
});

describe("checkAgentReadiness", () => {
  it("can_start fails when gordon home dir is undefined", () => {
    const v = checkAgentReadiness({ gordonHomeDir: undefined });
    expect(v.conditions.find((c) => c.id === "can_start")?.status).toBe("fail");
  });

  it("can_start warns when home dir doesn't exist (not blocking)", () => {
    const v = checkAgentReadiness({
      gordonHomeDir: join(tempDir, "missing"),
      paperModeReachable: true,
    });
    const c = v.conditions.find((c) => c.id === "can_start");
    expect(c?.status).toBe("warn");
    expect(v.ready).toBe(true);
  });

  it("can_start passes when home dir exists", () => {
    const home = join(tempDir, "home");
    mkdirSync(home);
    const v = checkAgentReadiness({
      gordonHomeDir: home,
      paperModeReachable: true,
      mastraDbPath: join(home, "missing-db"),
      aceLessonsPath: join(home, "missing-ace"),
      sessionHandoffPath: join(home, "missing-handoff"),
    });
    expect(v.conditions.find((c) => c.id === "can_start")?.status).toBe("pass");
  });

  it("can_test fails when both probes report false", () => {
    const v = checkAgentReadiness({
      gordonHomeDir: tempDir,
      paperModeReachable: false,
      evalHarnessReachable: false,
    });
    expect(v.conditions.find((c) => c.id === "can_test")?.status).toBe("fail");
    expect(v.ready).toBe(false);
  });

  it("can_test passes when at least one probe is true", () => {
    const v = checkAgentReadiness({
      gordonHomeDir: tempDir,
      paperModeReachable: true,
      evalHarnessReachable: false,
    });
    expect(v.conditions.find((c) => c.id === "can_test")?.status).toBe("pass");
  });

  it("can_test warns when no probes provided", () => {
    const v = checkAgentReadiness({ gordonHomeDir: tempDir });
    expect(v.conditions.find((c) => c.id === "can_test")?.status).toBe("warn");
  });

  it("can_see_progress passes when ACE lessons file exists", () => {
    const ace = join(tempDir, "ace.json");
    writeFileSync(ace, "{}");
    const v = checkAgentReadiness({
      gordonHomeDir: tempDir,
      aceLessonsPath: ace,
      paperModeReachable: true,
    });
    expect(v.conditions.find((c) => c.id === "can_see_progress")?.status).toBe("pass");
  });

  it("can_see_progress warns when nothing visible", () => {
    const v = checkAgentReadiness({
      gordonHomeDir: tempDir,
      aceLessonsPath: join(tempDir, "no"),
      mastraDbPath: join(tempDir, "no-db"),
      actionLogEntryCount: 0,
      paperModeReachable: true,
    });
    expect(v.conditions.find((c) => c.id === "can_see_progress")?.status).toBe("warn");
  });

  it("can_hand_off warns when artifact absent (treated as fresh)", () => {
    const v = checkAgentReadiness({
      gordonHomeDir: tempDir,
      sessionHandoffPath: join(tempDir, "missing"),
      paperModeReachable: true,
    });
    expect(v.conditions.find((c) => c.id === "can_hand_off")?.status).toBe("warn");
    expect(v.ready).toBe(true);
  });

  it("can_hand_off fails on unparseable artifact", () => {
    const handoff = join(tempDir, "handoff.json");
    writeFileSync(handoff, "not-json{");
    const v = checkAgentReadiness({
      gordonHomeDir: tempDir,
      sessionHandoffPath: handoff,
      paperModeReachable: true,
    });
    expect(v.conditions.find((c) => c.id === "can_hand_off")?.status).toBe("fail");
    expect(v.ready).toBe(false);
  });

  it("can_hand_off passes on valid JSON artifact", () => {
    const handoff = join(tempDir, "handoff.json");
    writeFileSync(handoff, JSON.stringify({ lastTask: "test" }));
    const v = checkAgentReadiness({
      gordonHomeDir: tempDir,
      sessionHandoffPath: handoff,
      paperModeReachable: true,
    });
    expect(v.conditions.find((c) => c.id === "can_hand_off")?.status).toBe("pass");
  });

  it("blocks when any condition fails", () => {
    const v = checkAgentReadiness({
      gordonHomeDir: undefined, // forces can_start fail
      paperModeReachable: true,
    });
    expect(v.ready).toBe(false);
    expect(v.blockingMessage).toContain("can_start");
  });
});

describe("readinessToPayload", () => {
  it("emits stable shape", () => {
    const verdict = checkAgentReadiness({
      gordonHomeDir: tempDir,
      paperModeReachable: true,
    });
    const p = readinessToPayload(verdict);
    expect(p.kind).toBe("agent_readiness.gate_recorded");
    expect(p.ready).toBe(verdict.ready);
    expect(Array.isArray(p.conditions)).toBe(true);
  });
});
