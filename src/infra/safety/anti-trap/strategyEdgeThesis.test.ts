import { describe, it, expect } from "bun:test";
import {
  captureEdgeThesis,
  edgeThesisToPayload,
  isStrategyEdgeThesisEnabled,
  STRATEGY_EDGE_THESIS_FLAG_ENV,
  type EdgeThesisInput,
} from "./strategyEdgeThesis.ts";

const validInput: EdgeThesisInput = {
  strategyId: "strat-01",
  inefficiencyDescription:
    "month-end index rebalancing produces predictable order flow into the closing auction on rebalance days",
  counterpartyIdentification:
    "passive index funds with mandated tracking error against the benchmark",
  counterpartyConstraint:
    "their mandates require closing-auction execution to minimize tracking error vs the index",
  persistenceRationale:
    "regulatory and IPS constraints prevent these funds from adjusting timing even when prices move adversely",
};

describe("isStrategyEdgeThesisEnabled", () => {
  it("respects the flag", () => {
    expect(isStrategyEdgeThesisEnabled({})).toBe(false);
    expect(
      isStrategyEdgeThesisEnabled({ [STRATEGY_EDGE_THESIS_FLAG_ENV]: "1" }),
    ).toBe(true);
  });
});

describe("captureEdgeThesis — validation", () => {
  it("rejects empty strategyId", () => {
    expect(() =>
      captureEdgeThesis({ ...validInput, strategyId: "" }),
    ).toThrow();
  });

  it("rejects too-short inefficiencyDescription", () => {
    expect(() =>
      captureEdgeThesis({ ...validInput, inefficiencyDescription: "too short" }),
    ).toThrow();
  });

  it("rejects too-short counterpartyIdentification", () => {
    expect(() =>
      captureEdgeThesis({ ...validInput, counterpartyIdentification: "short" }),
    ).toThrow();
  });

  it("rejects too-short counterpartyConstraint", () => {
    expect(() =>
      captureEdgeThesis({ ...validInput, counterpartyConstraint: "short" }),
    ).toThrow();
  });

  it("rejects too-short persistenceRationale", () => {
    expect(() =>
      captureEdgeThesis({ ...validInput, persistenceRationale: "short" }),
    ).toThrow();
  });

  it("error messages reference the article's framing", () => {
    try {
      captureEdgeThesis({ ...validInput, inefficiencyDescription: "x" });
      throw new Error("should have thrown");
    } catch (e: unknown) {
      const msg = (e as Error).message;
      expect(msg).toContain("mispricing");
    }
  });
});

describe("captureEdgeThesis — clean thesis → valid", () => {
  it("all fields valid + no anti-patterns → status=valid, record present", () => {
    const r = captureEdgeThesis(validInput);
    expect(r.status).toBe("valid");
    expect(r.record).not.toBeNull();
    expect(r.warnings.length).toBe(0);
  });

  it("record includes a non-empty 64-char SHA-256 hash", () => {
    const r = captureEdgeThesis(validInput);
    expect(r.record?.thesisHash).toBeDefined();
    expect(r.record?.thesisHash.length).toBe(64);
    expect(r.record?.thesisHash).toMatch(/^[0-9a-f]+$/);
  });

  it("hash is deterministic across captures with same inputs", () => {
    const a = captureEdgeThesis(validInput);
    const b = captureEdgeThesis(validInput);
    expect(a.record?.thesisHash).toBe(b.record?.thesisHash);
  });

  it("hash differs when any field changes", () => {
    const a = captureEdgeThesis(validInput);
    const b = captureEdgeThesis({
      ...validInput,
      strategyId: "strat-02",
    });
    expect(a.record?.thesisHash).not.toBe(b.record?.thesisHash);
  });

  it("recordedAt is a valid ISO timestamp", () => {
    const r = captureEdgeThesis(validInput);
    expect(Number.isNaN(Date.parse(r.record!.recordedAt))).toBe(false);
  });
});

describe("captureEdgeThesis — anti-pattern detection", () => {
  it("detects 'because it worked historically' phrase", () => {
    const r = captureEdgeThesis({
      ...validInput,
      persistenceRationale:
        "this strategy works because it worked historically across multiple market regimes",
    });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.field === "persistenceRationale")).toBe(true);
  });

  it("detects 'backtest showed' phrase", () => {
    const r = captureEdgeThesis({
      ...validInput,
      counterpartyConstraint:
        "the backtest showed this counterparty acts predictably during these windows",
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("detects 'data mining' phrase", () => {
    const r = captureEdgeThesis({
      ...validInput,
      inefficiencyDescription:
        "this is essentially a data mining result from sweeping over many parameter sets",
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("detects 'trial and error' phrase", () => {
    const r = captureEdgeThesis({
      ...validInput,
      counterpartyIdentification:
        "found these counterparties through trial and error in production",
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("detects 'looked good in backtest' phrase", () => {
    const r = captureEdgeThesis({
      ...validInput,
      persistenceRationale:
        "the rotation strategy looked good in backtest across the 2018-2024 window",
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("warnings record the field and matched text", () => {
    const r = captureEdgeThesis({
      ...validInput,
      inefficiencyDescription:
        "essentially the backtest showed a persistent anomaly across many windows",
    });
    expect(r.warnings.length).toBeGreaterThan(0);
    const w = r.warnings[0]!;
    expect(w.field).toBe("inefficiencyDescription");
    expect(w.matchedText.toLowerCase()).toContain("backtest");
  });

  it("multiple anti-patterns all surfaced", () => {
    const r = captureEdgeThesis({
      ...validInput,
      inefficiencyDescription:
        "the backtest showed an effect that worked in the past across many regimes",
    });
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("captureEdgeThesis — informational vs active mode", () => {
  const taintedInput: EdgeThesisInput = {
    ...validInput,
    persistenceRationale:
      "the rotation effect has worked in the past across multiple market regimes consistently",
  };

  it("informational (default): anti-pattern → advisory_warning + record present", () => {
    const r = captureEdgeThesis(taintedInput);
    expect(r.mode).toBe("informational");
    expect(r.status).toBe("advisory_warning");
    expect(r.record).not.toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("active mode: anti-pattern → invalid + record null", () => {
    const r = captureEdgeThesis({ ...taintedInput, mode: "active" });
    expect(r.mode).toBe("active");
    expect(r.status).toBe("invalid");
    expect(r.record).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("clean thesis in active mode → still valid", () => {
    const r = captureEdgeThesis({ ...validInput, mode: "active" });
    expect(r.status).toBe("valid");
    expect(r.record).not.toBeNull();
  });
});

describe("captureEdgeThesis — reasoning text quality", () => {
  it("valid reasoning includes hash prefix", () => {
    const r = captureEdgeThesis(validInput);
    expect(r.reasoning).toContain(r.record!.thesisHash.slice(0, 8));
  });

  it("invalid reasoning includes guidance to rewrite", () => {
    const r = captureEdgeThesis({
      ...validInput,
      inefficiencyDescription:
        "found this signal through trial and error during the 2023 selloff",
      mode: "active",
    });
    expect(r.reasoning.toLowerCase()).toContain("rewrite");
  });

  it("advisory_warning reasoning encourages reflection", () => {
    const r = captureEdgeThesis({
      ...validInput,
      counterpartyIdentification:
        "passive funds — found it by trying many candidate windows in backtest",
    });
    expect(r.status).toBe("advisory_warning");
    expect(r.reasoning.toLowerCase()).toContain("consider");
  });
});

describe("edgeThesisToPayload", () => {
  it("emits stable shape on valid result", () => {
    const r = captureEdgeThesis(validInput);
    const p = edgeThesisToPayload(r) as {
      kind: string;
      status: string;
      warningCount: number;
      thesisHash: string;
    };
    expect(p.kind).toBe("strategy_edge_thesis.captured");
    expect(p.status).toBe("valid");
    expect(p.warningCount).toBe(0);
    expect(p.thesisHash).toBe(r.record!.thesisHash);
  });

  it("emits null hash on invalid result", () => {
    const r = captureEdgeThesis({
      ...validInput,
      inefficiencyDescription:
        "the backtest showed a clear pattern across windows",
      mode: "active",
    });
    const p = edgeThesisToPayload(r) as { thesisHash: string | null };
    expect(p.thesisHash).toBeNull();
  });
});
