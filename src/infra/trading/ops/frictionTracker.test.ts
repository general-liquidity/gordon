import { describe, it, expect, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  recordFriction,
  readFrictionLog,
  auditFriction,
  formatAudit,
  auditToPayload,
  FRICTION_TRACKER_PATH_ENV,
  type FrictionEvent,
} from "./frictionTracker.ts";

let workDir: string;
let logPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "friction-"));
  logPath = join(workDir, "friction.jsonl");
});

function cleanup() {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("recordFriction", () => {
  it("writes JSONL", () => {
    const env = {};
    recordFriction({ tradeId: "t1", kind: "commission", costUsd: 2.5 }, env, logPath);
    recordFriction({ tradeId: "t1", kind: "slippage", costUsd: 12 }, env, logPath);
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!) as FrictionEvent;
    expect(first.tradeId).toBe("t1");
    expect(first.kind).toBe("commission");
    expect(first.component).toBe("explicit");
    cleanup();
  });

  it("auto-classifies kind → component for all three columns", () => {
    const env = {};
    const ev1 = recordFriction({ tradeId: "t1", kind: "commission", costUsd: 1 }, env, logPath)!;
    const ev2 = recordFriction({ tradeId: "t1", kind: "slippage", costUsd: 1 }, env, logPath)!;
    const ev3 = recordFriction({ tradeId: "t1", kind: "moved_stop", costUsd: 1 }, env, logPath)!;
    expect(ev1.component).toBe("explicit");
    expect(ev2.component).toBe("implicit");
    expect(ev3.component).toBe("psychological");
    cleanup();
  });

  it("uses GORDON_FRICTION_TRACKER_PATH override", () => {
    const customPath = join(workDir, "custom.jsonl");
    const env = {
      [FRICTION_TRACKER_PATH_ENV]: customPath,
    };
    recordFriction({ tradeId: "t1", kind: "commission", costUsd: 1 }, env);
    expect(existsSync(customPath)).toBe(true);
    cleanup();
  });
});

describe("readFrictionLog", () => {
  it("returns empty for missing file", () => {
    expect(readFrictionLog(join(workDir, "ghost.jsonl"))).toEqual([]);
    cleanup();
  });

  it("skips malformed lines", () => {
    const env = {};
    recordFriction({ tradeId: "t1", kind: "commission", costUsd: 1 }, env, logPath);
    const fs = require("node:fs");
    fs.appendFileSync(logPath, "not-json\n", "utf8");
    recordFriction({ tradeId: "t2", kind: "slippage", costUsd: 1 }, env, logPath);
    const events = readFrictionLog(logPath);
    expect(events.length).toBe(2);
    cleanup();
  });
});

const makeEvent = (
  recordedAt: string,
  kind: FrictionEvent["kind"],
  costUsd: number,
): FrictionEvent => ({
  id: `fric-${recordedAt}`,
  recordedAt,
  tradeId: "t",
  kind,
  component:
    kind === "commission" || kind === "exchange_fee" || kind === "platform_fee"
      ? "explicit"
      : kind === "slippage" || kind === "market_impact"
        ? "implicit"
        : "psychological",
  costUsd,
});

describe("auditFriction", () => {
  it("ok when friction < 10% of gross", () => {
    const events = [
      makeEvent("2026-05-01T10:00:00Z", "commission", 50),
      makeEvent("2026-05-15T10:00:00Z", "slippage", 30),
    ];
    const audit = auditFriction({
      events,
      windowStart: "2026-05-01T00:00:00Z",
      windowEnd: "2026-05-31T23:59:59Z",
      grossProfitUsd: 1000,
    });
    expect(audit.total).toBe(80);
    expect(audit.frictionRatio).toBeCloseTo(0.08, 5);
    expect(audit.verdict).toBe("ok");
    expect(audit.netProfitUsd).toBe(920);
  });

  it("warn at 10% (half of fail threshold)", () => {
    const events = [makeEvent("2026-05-01T10:00:00Z", "commission", 100)];
    const audit = auditFriction({
      events,
      windowStart: "2026-05-01T00:00:00Z",
      windowEnd: "2026-05-31T23:59:59Z",
      grossProfitUsd: 1000,
    });
    expect(audit.verdict).toBe("warn");
  });

  it("fail at 20% per Wright Ch 16", () => {
    const events = [
      makeEvent("2026-05-01T10:00:00Z", "commission", 100),
      makeEvent("2026-05-02T10:00:00Z", "slippage", 100),
      makeEvent("2026-05-03T10:00:00Z", "moved_stop", 50),
    ];
    const audit = auditFriction({
      events,
      windowStart: "2026-05-01T00:00:00Z",
      windowEnd: "2026-05-31T23:59:59Z",
      grossProfitUsd: 1000,
    });
    expect(audit.frictionRatio).toBe(0.25);
    expect(audit.verdict).toBe("fail");
  });

  it("fails when gross profit is zero or negative but friction non-zero", () => {
    const events = [makeEvent("2026-05-01T10:00:00Z", "commission", 10)];
    const audit = auditFriction({
      events,
      windowStart: "2026-05-01T00:00:00Z",
      windowEnd: "2026-05-31T23:59:59Z",
      grossProfitUsd: 0,
    });
    expect(audit.verdict).toBe("fail");
  });

  it("filters by window", () => {
    const events = [
      makeEvent("2026-04-30T23:59:59Z", "commission", 1000), // outside
      makeEvent("2026-05-15T10:00:00Z", "commission", 50),
      makeEvent("2026-06-01T00:00:01Z", "commission", 1000), // outside
    ];
    const audit = auditFriction({
      events,
      windowStart: "2026-05-01T00:00:00Z",
      windowEnd: "2026-05-31T23:59:59Z",
      grossProfitUsd: 1000,
    });
    expect(audit.total).toBe(50);
    expect(audit.eventCount).toBe(1);
  });

  it("breaks out friction by component", () => {
    const events = [
      makeEvent("2026-05-01T10:00:00Z", "commission", 30),
      makeEvent("2026-05-02T10:00:00Z", "slippage", 70),
      makeEvent("2026-05-03T10:00:00Z", "hesitation", 20),
      makeEvent("2026-05-04T10:00:00Z", "moved_stop", 40),
    ];
    const audit = auditFriction({
      events,
      windowStart: "2026-05-01T00:00:00Z",
      windowEnd: "2026-05-31T23:59:59Z",
      grossProfitUsd: 1000,
    });
    expect(audit.byComponent.explicit).toBe(30);
    expect(audit.byComponent.implicit).toBe(70);
    expect(audit.byComponent.psychological).toBe(60);
  });

  it("respects custom fail threshold", () => {
    const events = [makeEvent("2026-05-01T10:00:00Z", "commission", 100)];
    const audit = auditFriction({
      events,
      windowStart: "2026-05-01T00:00:00Z",
      windowEnd: "2026-05-31T23:59:59Z",
      grossProfitUsd: 1000,
      failRatio: 0.05,
    });
    expect(audit.verdict).toBe("fail");
  });
});

describe("formatAudit + auditToPayload", () => {
  it("formats a human summary including verdict", () => {
    const audit = auditFriction({
      events: [makeEvent("2026-05-01T10:00:00Z", "commission", 50)],
      windowStart: "2026-05-01T00:00:00Z",
      windowEnd: "2026-05-31T23:59:59Z",
      grossProfitUsd: 1000,
    });
    const s = formatAudit(audit);
    expect(s).toContain("Friction audit");
    expect(s.toLowerCase()).toContain("ok");
    expect(s).toContain("explicit $50.00");
  });

  it("emits stable payload shape", () => {
    const audit = auditFriction({
      events: [makeEvent("2026-05-01T10:00:00Z", "commission", 50)],
      windowStart: "2026-05-01T00:00:00Z",
      windowEnd: "2026-05-31T23:59:59Z",
      grossProfitUsd: 1000,
    });
    const p = auditToPayload(audit) as { kind: string; verdict: string };
    expect(p.kind).toBe("friction_tracker.audited");
    expect(p.verdict).toBe("ok");
  });
});
