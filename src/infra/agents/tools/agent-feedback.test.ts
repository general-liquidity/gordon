import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  agentFeedbackTools,
  appendAgentFeedback,
  defaultAgentFeedbackPath,
  readAgentFeedback,
} from "./agent-feedback.ts";

let tempDir: string;
let feedbackPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-feedback-test-"));
  feedbackPath = join(tempDir, "feedback.jsonl");
  process.env.GORDON_AGENT_FEEDBACK_PATH = feedbackPath;
});

afterEach(() => {
  delete process.env.GORDON_AGENT_FEEDBACK_PATH;
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

interface ReportResult {
  acknowledged: boolean;
  path: string;
  severity: string;
  error?: string;
}

async function runTool(input: Record<string, unknown>): Promise<ReportResult> {
  const tool = agentFeedbackTools.report_blocked;
  const exec = tool.execute as (args: unknown) => Promise<ReportResult>;
  return await exec(input);
}

describe("agent-feedback path helpers", () => {
  it("defaultAgentFeedbackPath honors GORDON_AGENT_FEEDBACK_PATH", () => {
    expect(defaultAgentFeedbackPath()).toBe(feedbackPath);
  });

  it("readAgentFeedback returns [] when file missing", () => {
    expect(readAgentFeedback(feedbackPath)).toEqual([]);
  });

  it("appendAgentFeedback writes a single JSONL row", () => {
    const result = appendAgentFeedback(
      {
        intent: "Place a BTC long",
        approachesTried: ["called execute_plan, got risk_rejected"],
        blocker: "Risk classifier rejects every variant",
        severity: "medium",
      },
      feedbackPath,
    );
    expect(result.written).toBe(true);
    expect(existsSync(feedbackPath)).toBe(true);
    const back = readAgentFeedback(feedbackPath);
    expect(back.length).toBe(1);
    expect(back[0]?.intent).toBe("Place a BTC long");
    expect(back[0]?.severity).toBe("medium");
    expect(back[0]?.appendedAt).toBeDefined();
  });

  it("readAgentFeedback returns newest-first", () => {
    appendAgentFeedback(
      {
        intent: "first",
        approachesTried: ["a"],
        blocker: "b1",
        severity: "low",
      },
      feedbackPath,
    );
    appendAgentFeedback(
      {
        intent: "second",
        approachesTried: ["c"],
        blocker: "b2",
        severity: "high",
      },
      feedbackPath,
    );
    const back = readAgentFeedback(feedbackPath);
    expect(back.length).toBe(2);
    expect(back[0]?.intent).toBe("second");
    expect(back[1]?.intent).toBe("first");
  });
});

describe("report_blocked tool", () => {
  it("acknowledges + persists the report", async () => {
    const result = await runTool({
      intent: "Place a BTC long after user confirmation",
      approachesTried: [
        "called execute_plan with planId=p1, got risk_rejected",
        "retried after adjusting size, got same rejection",
      ],
      blocker: "Risk classifier blocks every variant because daily drawdown is at 4.8% of 5% cap",
      suggestedNext: "User would need to raise the cap or close existing position",
      severity: "high",
    });
    expect(result.acknowledged).toBe(true);
    expect(result.path).toBe(feedbackPath);
    expect(result.severity).toBe("high");
    const back = readAgentFeedback(feedbackPath);
    expect(back.length).toBe(1);
    expect(back[0]?.severity).toBe("high");
    expect(back[0]?.suggestedNext).toContain("raise the cap");
    expect(back[0]?.approachesTried.length).toBe(2);
  });

  it("defaults severity to medium when not supplied", async () => {
    const result = await runTool({
      intent: "Fetch the trending tokens for the user",
      approachesTried: ["get_trending_tokens returned empty array twice"],
      blocker: "Upstream API may be degraded; cannot tell from current tool output",
    });
    expect(result.severity).toBe("medium");
  });

  it("never throws — defensive even when persistence fails", async () => {
    process.env.GORDON_AGENT_FEEDBACK_PATH = "/dev/null/definitely/not/writable/x.jsonl";
    let caught: unknown;
    try {
      await runTool({
        intent: "Test defensive fallback",
        approachesTried: ["this is a test approach"],
        blocker: "Forcing a write failure to confirm we still return",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeUndefined();
  });
});
