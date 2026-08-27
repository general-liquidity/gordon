import { describe, it, expect } from "bun:test";

import {
  AUDIT_THEMES,
  audit,
  currentTheme,
  formatSelfAuditPass,
  initRotationState,
  nextTheme,
  runSelfAuditPass,
  selfAuditPassToPayload,
  type SelfAuditInputs,
} from "./rotatingSelfAudit.ts";

const FIXED_NOW = 1_000_000_000_000;
const nowFn = () => FIXED_NOW;

describe("rotation pointer", () => {
  it("starts at the requested index and wraps negatives", () => {
    expect(currentTheme(initRotationState(0))).toBe("script_health");
    expect(currentTheme(initRotationState(2))).toBe("unused_assets");
    expect(currentTheme(initRotationState(-1))).toBe(AUDIT_THEMES[AUDIT_THEMES.length - 1]!);
  });

  it("advances through every theme and counts a full rotation", () => {
    let state = initRotationState(0);
    const seen: string[] = [currentTheme(state)];
    for (let i = 0; i < AUDIT_THEMES.length - 1; i++) {
      state = nextTheme(state);
      seen.push(currentTheme(state));
    }
    expect(seen).toEqual([...AUDIT_THEMES]);
    expect(state.rotations).toBe(0);
    // one more step wraps back to the start and increments rotations
    state = nextTheme(state);
    expect(currentTheme(state)).toBe("script_health");
    expect(state.rotations).toBe(1);
  });

  it("nextTheme does not mutate the input state", () => {
    const s = initRotationState(1);
    const n = nextTheme(s);
    expect(s.index).toBe(1);
    expect(n.index).toBe(2);
  });
});

describe("audit — script_health", () => {
  it("flags non-zero exit as critical and stale as warn", () => {
    const inputs: SelfAuditInputs = {
      scripts: [
        { name: "fetch-cron", lastExitCode: 1, lastRunAtMs: FIXED_NOW - 1000 },
        {
          name: "reconcile",
          lastExitCode: 0,
          lastRunAtMs: FIXED_NOW - 10_000,
          expectedIntervalMs: 5_000,
        },
        {
          name: "healthy",
          lastExitCode: 0,
          lastRunAtMs: FIXED_NOW - 100,
          expectedIntervalMs: 5_000,
        },
      ],
    };
    const f = audit("script_health", inputs, { now: nowFn });
    const bySubject = Object.fromEntries(f.map((x) => [x.subject, x]));
    expect(bySubject["fetch-cron"]!.severity).toBe("critical");
    expect(bySubject.reconcile!.severity).toBe("warn");
    expect(bySubject.healthy).toBeUndefined();
  });

  it("flags a never-run script as info", () => {
    const f = audit("script_health", { scripts: [{ name: "dormant" }] }, { now: nowFn });
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("info");
  });
});

describe("audit — discovery_coverage", () => {
  it("warns below the coverage threshold and reports stale symbols", () => {
    const f = audit(
      "discovery_coverage",
      { discovery: { universeSize: 100, scannedCount: 40, staleCount: 5 } },
      { now: nowFn },
    );
    expect(f.find((x) => x.subject === "universe")!.severity).toBe("warn");
    expect(f.find((x) => x.subject === "freshness")!.severity).toBe("info");
  });

  it("stays silent at full coverage", () => {
    const f = audit(
      "discovery_coverage",
      { discovery: { universeSize: 50, scannedCount: 50 } },
      { now: nowFn },
    );
    expect(f).toHaveLength(0);
  });
});

describe("audit — unused_assets", () => {
  it("warns on unreferenced assets and infos on stale/never-used", () => {
    const inputs: SelfAuditInputs = {
      assets: [
        { id: "a", kind: "skill", referenced: false },
        { id: "b", kind: "tool" },
        {
          id: "c",
          kind: "playbook",
          lastUsedAtMs: FIXED_NOW - 40 * 24 * 60 * 60 * 1000,
          referenced: true,
        },
        { id: "d", kind: "recipe", lastUsedAtMs: FIXED_NOW - 1000, referenced: true },
      ],
    };
    const f = audit("unused_assets", inputs, { now: nowFn });
    const bySubject = Object.fromEntries(f.map((x) => [x.subject, x]));
    expect(bySubject["skill:a"]!.severity).toBe("warn");
    expect(bySubject["tool:b"]!.severity).toBe("info");
    expect(bySubject["playbook:c"]!.severity).toBe("info");
    expect(bySubject["recipe:d"]).toBeUndefined();
  });
});

describe("audit — guardrails_risk", () => {
  it("critical on disabled, warn on tripped", () => {
    const f = audit("guardrails_risk", {
      guardrails: [
        { name: "kill-switch", enabled: false },
        { name: "wip-limit", enabled: true, tripped: true },
        { name: "risk-gate", enabled: true },
      ],
    });
    const bySubject = Object.fromEntries(f.map((x) => [x.subject, x]));
    expect(bySubject["kill-switch"]!.severity).toBe("critical");
    expect(bySubject["wip-limit"]!.severity).toBe("warn");
    expect(bySubject["risk-gate"]).toBeUndefined();
  });
});

describe("audit — data_api_tokens", () => {
  it("critical on expired, warn on expiring soon and low budget", () => {
    const inputs: SelfAuditInputs = {
      dataApis: [
        { provider: "expired", expiresAtMs: FIXED_NOW - 1 },
        { provider: "soon", expiresAtMs: FIXED_NOW + 60_000 },
        { provider: "low", remaining: 5, limit: 100 },
        {
          provider: "fine",
          remaining: 90,
          limit: 100,
          expiresAtMs: FIXED_NOW + 10 * 24 * 60 * 60 * 1000,
        },
      ],
    };
    const f = audit("data_api_tokens", inputs, { now: nowFn });
    const bySubject = Object.fromEntries(f.map((x) => [x.subject, x]));
    expect(bySubject.expired!.severity).toBe("critical");
    expect(bySubject.soon!.severity).toBe("warn");
    expect(bySubject.low!.severity).toBe("warn");
    expect(bySubject.fine).toBeUndefined();
  });
});

describe("audit — missing slice", () => {
  it("returns no findings when the theme's input slice is absent", () => {
    expect(audit("script_health", {})).toHaveLength(0);
    expect(audit("discovery_coverage", {})).toHaveLength(0);
    expect(audit("unused_assets", {})).toHaveLength(0);
    expect(audit("guardrails_risk", {})).toHaveLength(0);
    expect(audit("data_api_tokens", {})).toHaveLength(0);
  });
});

describe("runSelfAuditPass", () => {
  it("audits the current theme and advances the pointer", () => {
    const state = initRotationState(0);
    const pass = runSelfAuditPass(
      state,
      { scripts: [{ name: "x", lastExitCode: 2, lastRunAtMs: FIXED_NOW }] },
      { now: nowFn },
    );
    expect(pass.theme).toBe("script_health");
    expect(pass.criticalCount).toBe(1);
    expect(currentTheme(pass.nextState)).toBe("discovery_coverage");
  });

  it("counts severities correctly", () => {
    const pass = runSelfAuditPass(
      initRotationState(3),
      {
        guardrails: [
          { name: "a", enabled: false },
          { name: "b", enabled: true, tripped: true },
        ],
      },
      { now: nowFn },
    );
    expect(pass.theme).toBe("guardrails_risk");
    expect(pass.criticalCount).toBe(1);
    expect(pass.warnCount).toBe(1);
    expect(pass.infoCount).toBe(0);
  });
});

describe("formatSelfAuditPass / selfAuditPassToPayload", () => {
  it("format includes a header and remediation lines", () => {
    const pass = runSelfAuditPass(
      initRotationState(0),
      { scripts: [{ name: "x", lastExitCode: 1, lastRunAtMs: FIXED_NOW }] },
      { now: nowFn },
    );
    const out = formatSelfAuditPass(pass);
    expect(out).toContain("[script_health]");
    expect(out).toContain("1 critical");
    expect(out).toContain("fix:");
  });

  it("payload emits a stable shape with the next theme", () => {
    const pass = runSelfAuditPass(initRotationState(0), {}, { now: nowFn });
    const p = selfAuditPassToPayload(pass);
    expect(p.kind).toBe("self_audit.pass_recorded");
    expect(p.theme).toBe("script_health");
    expect(p.nextTheme).toBe("discovery_coverage");
  });
});
