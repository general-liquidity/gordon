import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TrustTrajectory,
  buildTrustTrajectoryHook,
  isSafetyCritical,
  recordPermissionEvaluation,
} from "./trustTrajectory.ts";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("isSafetyCritical", () => {
  it("flags trade-execution tool names", () => {
    expect(isSafetyCritical("execute_plan")).toBe(true);
    expect(isSafetyCritical("place_market_order")).toBe(true);
    expect(isSafetyCritical("place_order")).toBe(true);
    expect(isSafetyCritical("execute_trade")).toBe(true);
    expect(isSafetyCritical("cancel_order")).toBe(true);
    expect(isSafetyCritical("wallet_transfer")).toBe(true);
    expect(isSafetyCritical("withdraw_funds")).toBe(true);
    expect(isSafetyCritical("exec_shell")).toBe(true);
  });

  it("does not flag read-only or analysis tools", () => {
    expect(isSafetyCritical("get_chart")).toBe(false);
    expect(isSafetyCritical("detect_market_regime")).toBe(false);
    expect(isSafetyCritical("record_insight")).toBe(false);
  });
});

describe("TrustTrajectory.scoreFor", () => {
  let t: TrustTrajectory;
  beforeEach(() => {
    t = new TrustTrajectory({ minApprovals: 3, scoreThreshold: 0.9 });
  });

  it("returns ineligible with no history", () => {
    const s = t.scoreFor("get_chart", undefined, NOW);
    expect(s.eligible).toBe(false);
    expect(s.totalDecisions).toBe(0);
  });

  it("becomes eligible after enough approvals", () => {
    for (let i = 0; i < 4; i++) {
      t.record({ toolName: "get_chart", decision: "approved", timestamp: NOW - i * DAY });
    }
    const s = t.scoreFor("get_chart", undefined, NOW);
    expect(s.approvals).toBe(4);
    expect(s.score).toBe(1);
    expect(s.eligible).toBe(true);
  });

  it("a recent rejection blocks auto-approval even with many approvals", () => {
    for (let i = 0; i < 10; i++) {
      t.record({ toolName: "get_chart", decision: "approved", timestamp: NOW - (i + 5) * DAY });
    }
    t.record({ toolName: "get_chart", decision: "rejected", timestamp: NOW - 1 * DAY });
    const s = t.scoreFor("get_chart", undefined, NOW);
    expect(s.approvals).toBe(10);
    expect(s.rejections).toBe(1);
    expect(s.eligible).toBe(false);
    expect(s.reason).toContain("Recent rejection");
  });

  it("an old rejection (past cooldown) does not block auto-approval", () => {
    for (let i = 0; i < 10; i++) {
      t.record({ toolName: "get_chart", decision: "approved", timestamp: NOW - i * DAY });
    }
    // Rejection 14 days ago, default cooldown is 7 days
    t.record({ toolName: "get_chart", decision: "rejected", timestamp: NOW - 14 * DAY });
    const s = t.scoreFor("get_chart", undefined, NOW);
    expect(s.eligible).toBe(true);
  });

  it("ignores events outside the window", () => {
    // Trust window default = 30 days
    for (let i = 0; i < 5; i++) {
      t.record({
        toolName: "get_chart",
        decision: "approved",
        timestamp: NOW - 90 * DAY - i * DAY,
      });
    }
    const s = t.scoreFor("get_chart", undefined, NOW);
    expect(s.approvals).toBe(0);
    expect(s.eligible).toBe(false);
  });

  it("never auto-approves safety-critical tools, even with many approvals", () => {
    const trusty = new TrustTrajectory({ minApprovals: 1, scoreThreshold: 0.5 });
    for (let i = 0; i < 50; i++) {
      trusty.record({ toolName: "place_order", decision: "approved", timestamp: NOW - i });
    }
    const s = trusty.scoreFor("place_order", undefined, NOW);
    expect(s.eligible).toBe(false);
    expect(s.reason).toContain("safety-critical");
  });

  it("respects scoreThreshold even with high volume", () => {
    const strict = new TrustTrajectory({ minApprovals: 3, scoreThreshold: 0.95 });
    for (let i = 0; i < 9; i++) {
      strict.record({ toolName: "get_chart", decision: "approved", timestamp: NOW - i * DAY });
    }
    // 90% score, but threshold is 95%
    strict.record({ toolName: "get_chart", decision: "rejected", timestamp: NOW - 30 * DAY });
    const s = strict.scoreFor("get_chart", undefined, NOW);
    expect(s.score).toBeCloseTo(0.9, 5);
    expect(s.eligible).toBe(false);
  });

  it("keys trust by tool name and permission scope", () => {
    for (let i = 0; i < 4; i++) {
      t.record({
        toolName: "rebalance_portfolio",
        permissionScope: "papertrade.execute",
        decision: "approved",
        timestamp: NOW - i,
      });
    }
    expect(t.scoreFor("rebalance_portfolio", "papertrade.execute", NOW).eligible).toBe(true);
    const live = t.scoreFor("rebalance_portfolio", "livetrade.execute", NOW);
    expect(live.eligible).toBe(false);
    expect(live.totalDecisions).toBe(0);
  });
});

describe("TrustTrajectory persistence", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "trust-"));
  });

  it("appends events to a JSONL file when persistPath is set", () => {
    const path = join(dir, "trust.jsonl");
    const t = new TrustTrajectory({ persistPath: path });
    t.record({ toolName: "get_chart", decision: "approved", timestamp: NOW });
    t.record({ toolName: "get_chart", decision: "approved", timestamp: NOW + 1 });
    const raw = readFileSync(path, "utf8").trim().split("\n");
    expect(raw.length).toBe(2);
    expect(JSON.parse(raw[0]!).toolName).toBe("get_chart");
  });

  it("loads existing events on construction", () => {
    const path = join(dir, "trust.jsonl");
    const writer = new TrustTrajectory({ persistPath: path });
    for (let i = 0; i < 4; i++) {
      writer.record({ toolName: "get_chart", decision: "approved", timestamp: NOW - i });
    }
    const reader = new TrustTrajectory({ persistPath: path, minApprovals: 3, scoreThreshold: 0.9 });
    expect(reader.listEvents().length).toBe(4);
    expect(reader.scoreFor("get_chart", undefined, NOW).eligible).toBe(true);
  });

  it("hook auto-approves trusted tools and abstains otherwise", () => {
    const t = new TrustTrajectory({ minApprovals: 3, scoreThreshold: 0.9 });
    const hook = buildTrustTrajectoryHook(t, { now: () => NOW });

    // Untrained tool — abstain
    expect(hook({ toolName: "get_chart", policy: {} }).decision).toBe("abstain");

    // Train it up
    for (let i = 0; i < 4; i++) {
      t.record({ toolName: "get_chart", decision: "approved", timestamp: NOW - i });
    }
    const result = hook({ toolName: "get_chart", policy: {} });
    expect(result.decision).toBe("allow");
    expect(result.actor).toBe("classifier:trust-trajectory");
  });

  it("hook requires the same permission scope before auto-approving", () => {
    const t = new TrustTrajectory({ minApprovals: 3, scoreThreshold: 0.9 });
    const hook = buildTrustTrajectoryHook(t, { now: () => NOW });
    for (let i = 0; i < 4; i++) {
      t.record({
        toolName: "rebalance_portfolio",
        permissionScope: "papertrade.execute",
        decision: "approved",
        timestamp: NOW - i,
      });
    }

    expect(
      hook({
        toolName: "rebalance_portfolio",
        policy: { tool: { permissionScope: "livetrade.execute" } },
      }).decision,
    ).toBe("abstain");
    expect(
      hook({
        toolName: "rebalance_portfolio",
        policy: { tool: { permissionScope: "papertrade.execute" } },
      }).decision,
    ).toBe("allow");
  });

  it("hook refuses to auto-approve when policy says always_require_human", () => {
    const t = new TrustTrajectory({ minApprovals: 1, scoreThreshold: 0.5 });
    for (let i = 0; i < 10; i++)
      t.record({ toolName: "get_chart", decision: "approved", timestamp: NOW - i });
    const hook = buildTrustTrajectoryHook(t, { now: () => NOW });
    const result = hook({
      toolName: "get_chart",
      policy: { approvalClass: "always_require_human" },
    });
    expect(result.decision).toBe("abstain");
  });

  it("recordPermissionEvaluation maps statuses to decisions", () => {
    const t = new TrustTrajectory();
    recordPermissionEvaluation(t, "get_chart", "allowed", NOW, "market.read");
    recordPermissionEvaluation(t, "get_chart", "blocked", NOW + 1, "market.read");
    recordPermissionEvaluation(t, "get_chart", "pending", NOW + 2, "market.read"); // no-op
    const events = t.listEvents();
    expect(events.length).toBe(2);
    expect(events[0]?.decision).toBe("approved");
    expect(events[1]?.decision).toBe("rejected");
    expect(events[0]?.permissionScope).toBe("market.read");
  });

  it("survives malformed rows in the ledger file", () => {
    const path = join(dir, "trust.jsonl");
    const writer = new TrustTrajectory({ persistPath: path });
    writer.record({ toolName: "get_chart", decision: "approved", timestamp: NOW });
    // Append junk by hand to simulate corruption
    const raw = readFileSync(path, "utf8");
    writeFileSync(path, `${raw}not-json\n{}\n`);
    const reader = new TrustTrajectory({ persistPath: path });
    expect(reader.listEvents().length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("authority-granting scopes are never trust-auto-approved", () => {
  it("flags manage_flags by name", () => {
    expect(isSafetyCritical("manage_flags")).toBe(true);
  });

  it("abstains for an authority-granting scope however long the approval history", () => {
    const t = new TrustTrajectory({ minApprovals: 3, scoreThreshold: 0.9 });
    // A tool whose NAME is on no deny-list, reached through a scope that is.
    for (let i = 0; i < 12; i++) {
      t.record({
        toolName: "some_future_tool",
        permissionScope: "system.mode.write",
        decision: "approved",
        timestamp: NOW - i,
      });
    }
    const hook = buildTrustTrajectoryHook(t, { now: () => NOW });
    expect(
      hook({
        toolName: "some_future_tool",
        policy: { tool: { permissionScope: "system.mode.write" } },
      }).decision,
    ).toBe("abstain");
  });

  it("still auto-approves a read scope with the same approval history", () => {
    const t = new TrustTrajectory({ minApprovals: 3, scoreThreshold: 0.9 });
    for (let i = 0; i < 12; i++) {
      t.record({
        toolName: "some_future_tool",
        permissionScope: "market.read",
        decision: "approved",
        timestamp: NOW - i,
      });
    }
    const hook = buildTrustTrajectoryHook(t, { now: () => NOW });
    expect(
      hook({
        toolName: "some_future_tool",
        policy: { tool: { permissionScope: "market.read" } },
      }).decision,
    ).toBe("allow");
  });
});
