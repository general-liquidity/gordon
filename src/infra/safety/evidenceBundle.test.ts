import { describe, it, expect } from "bun:test";
import {
  isEvidenceBundleEnabled,
  buildEvidenceBundle,
  createEvidenceBundleBuilder,
  evidenceBundleToPayload,
  EVIDENCE_BUNDLE_FLAG_ENV,
  type EvidenceCheck,
} from "./evidenceBundle.ts";

describe("isEvidenceBundleEnabled", () => {
  it("respects the flag", () => {
    expect(isEvidenceBundleEnabled({})).toBe(false);
    expect(isEvidenceBundleEnabled({ [EVIDENCE_BUNDLE_FLAG_ENV]: "1" })).toBe(true);
    expect(isEvidenceBundleEnabled({ [EVIDENCE_BUNDLE_FLAG_ENV]: "true" })).toBe(true);
  });
});

const META = {
  actionId: "action_abc123",
  actionType: "execute_plan",
  timestamp: 1716240000000,
};

describe("buildEvidenceBundle — validation", () => {
  it("throws on missing actionId", () => {
    expect(() =>
      buildEvidenceBundle({ ...META, actionId: "" } as never),
    ).toThrow();
  });
  it("throws on missing actionType", () => {
    expect(() =>
      buildEvidenceBundle({ ...META, actionType: "" } as never),
    ).toThrow();
  });
  it("throws on non-finite timestamp", () => {
    expect(() =>
      buildEvidenceBundle({ ...META, timestamp: NaN }),
    ).toThrow();
  });
  it("throws on non-string rationale", () => {
    expect(() =>
      buildEvidenceBundle({ ...META, rationale: 42 as unknown as string }),
    ).toThrow();
  });
});

describe("buildEvidenceBundle — empty bundle is READY", () => {
  it("zero checks/assumptions/gaps/risks → ready", () => {
    const b = buildEvidenceBundle(META);
    expect(b.summary.status).toBe("ready");
    expect(b.summary.checksTotal).toBe(0);
    expect(b.summary.assumptionsTotal).toBe(0);
  });
});

describe("buildEvidenceBundle — status: blocked", () => {
  it("any check failed → blocked", () => {
    const b = buildEvidenceBundle({
      ...META,
      checks: [
        { name: "risk_classifier", outcome: "pass" },
        { name: "consensus_protocol", outcome: "fail", detail: "score 0.42 < 0.6" },
      ],
    });
    expect(b.summary.status).toBe("blocked");
    expect(b.summary.checksFailed).toBe(1);
  });

  it("any HIGH-severity gap → blocked", () => {
    const b = buildEvidenceBundle({
      ...META,
      gaps: [
        {
          area: "counterparty_credit",
          reason: "no credit data on this venue",
          severity: "high",
        },
      ],
    });
    expect(b.summary.status).toBe("blocked");
    expect(b.summary.gapsHigh).toBe(1);
  });

  it("failed check beats violated assumption (still blocked)", () => {
    const b = buildEvidenceBundle({
      ...META,
      checks: [{ name: "x", outcome: "fail" }],
      assumptions: [
        { name: "regime_alignment", held: false, basis: "regime/detector" },
      ],
    });
    expect(b.summary.status).toBe("blocked");
  });
});

describe("buildEvidenceBundle — status: conditional", () => {
  it("warning check + all assumptions hold → conditional", () => {
    const b = buildEvidenceBundle({
      ...META,
      checks: [
        { name: "trust_trajectory", outcome: "pass" },
        { name: "vol_regime", outcome: "warning", detail: "elevated vol" },
      ],
    });
    expect(b.summary.status).toBe("conditional");
    expect(b.summary.checksWarning).toBe(1);
  });

  it("violated assumption alone → conditional", () => {
    const b = buildEvidenceBundle({
      ...META,
      checks: [{ name: "risk_classifier", outcome: "pass" }],
      assumptions: [
        { name: "mandate_scope", held: false, basis: "mandates" },
      ],
    });
    expect(b.summary.status).toBe("conditional");
    expect(b.summary.assumptionsViolated).toBe(1);
  });

  it("medium gap alone → conditional", () => {
    const b = buildEvidenceBundle({
      ...META,
      gaps: [
        {
          area: "correlation_to_open_book",
          reason: "open positions stale > 60s",
          severity: "medium",
        },
      ],
    });
    expect(b.summary.status).toBe("conditional");
    expect(b.summary.gapsMedium).toBe(1);
  });
});

describe("buildEvidenceBundle — status: ready", () => {
  it("all checks pass, assumptions hold, only low gap + residual risk", () => {
    const b = buildEvidenceBundle({
      ...META,
      rationale: "Execute swing-long BTC on regime-flip confirmation",
      checks: [
        { name: "risk_classifier", outcome: "pass" },
        { name: "consensus_protocol", outcome: "pass" },
        { name: "trust_trajectory", outcome: "skip", detail: "below threshold" },
      ],
      assumptions: [
        { name: "regime_alignment", held: true, basis: "regime/detector" },
        { name: "mandate_scope", held: true, basis: "mandates" },
      ],
      gaps: [
        {
          area: "macro_event_window",
          reason: "no FOMC for 3 days",
          severity: "low",
        },
      ],
      residualRisks: [
        {
          description: "Drawdown from sudden BTC dominance shift",
          category: "market",
          mitigation: "ATR-based trailing stop",
        },
      ],
    });
    expect(b.summary.status).toBe("ready");
    expect(b.summary.checksPassed).toBe(2);
    expect(b.summary.checksSkipped).toBe(1);
    expect(b.summary.residualRiskCount).toBe(1);
  });
});

describe("buildEvidenceBundle — verdict string", () => {
  it("includes status + counts + categories", () => {
    const b = buildEvidenceBundle({
      ...META,
      checks: [
        { name: "a", outcome: "pass" },
        { name: "b", outcome: "warning" },
      ],
      assumptions: [{ name: "c", held: true }],
      gaps: [{ area: "d", reason: "x", severity: "medium" }],
    });
    expect(b.summary.verdict).toContain("CONDITIONAL");
    expect(b.summary.verdict).toContain("2 checks");
    expect(b.summary.verdict).toContain("0H/1M/0L"); // gaps high/medium/low
  });
});

describe("buildEvidenceBundle — immutability", () => {
  it("returned bundle is frozen at the top level", () => {
    const b = buildEvidenceBundle(META);
    expect(Object.isFrozen(b)).toBe(true);
  });

  it("checks/assumptions/gaps arrays are independent of caller mutations", () => {
    const checks: EvidenceCheck[] = [{ name: "x", outcome: "pass" }];
    const b = buildEvidenceBundle({ ...META, checks });
    checks.push({ name: "y", outcome: "fail" });
    expect(b.checks.length).toBe(1);
    expect(b.summary.status).toBe("ready");
  });
});

describe("createEvidenceBundleBuilder — fluent API", () => {
  it("accumulates and seals", () => {
    const b = createEvidenceBundleBuilder()
      .addCheck({ name: "risk", outcome: "pass" })
      .addCheck({ name: "consensus", outcome: "pass" })
      .addAssumption({ name: "regime", held: true })
      .addGap({ area: "macro", reason: "OK", severity: "low" })
      .addResidualRisk({
        description: "slippage",
        category: "execution",
        mitigation: "limit order",
      })
      .build(META);

    expect(b.summary.status).toBe("ready");
    expect(b.checks.length).toBe(2);
    expect(b.assumptions.length).toBe(1);
    expect(b.gaps.length).toBe(1);
    expect(b.residualRisks.length).toBe(1);
  });

  it("snapshot survives subsequent builder mutations", () => {
    const builder = createEvidenceBundleBuilder().addCheck({
      name: "a",
      outcome: "pass",
    });
    const snapshot = builder.build(META);
    builder.addCheck({ name: "b", outcome: "fail" as const });
    expect(snapshot.checks.length).toBe(1);
    expect(snapshot.summary.status).toBe("ready");
  });
});

describe("evidenceBundleToPayload", () => {
  it("emits stable shape", () => {
    const b = buildEvidenceBundle({
      ...META,
      rationale: "test",
      checks: [{ name: "x", outcome: "pass" }],
      assumptions: [{ name: "y", held: true }],
      gaps: [{ area: "z", reason: "r", severity: "medium" }],
      residualRisks: [
        { description: "rr", category: "market" },
      ],
    });
    const p = evidenceBundleToPayload(b) as {
      kind: string;
      actionId: string;
      status: string;
      summary: {
        checks: { total: number; passed: number };
        gaps: { high: number; medium: number; low: number };
      };
    };
    expect(p.kind).toBe("evidence_bundle.recorded");
    expect(p.actionId).toBe(META.actionId);
    expect(p.status).toBe("conditional");
    expect(p.summary.checks.total).toBe(1);
    expect(p.summary.gaps.medium).toBe(1);
  });

  it("rationale defaults to null when absent", () => {
    const b = buildEvidenceBundle(META);
    const p = evidenceBundleToPayload(b) as { rationale: unknown };
    expect(p.rationale).toBeNull();
  });
});
