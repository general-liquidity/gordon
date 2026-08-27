import { describe, it, expect } from "bun:test";
import {
  stampEditPrediction,
  verifyEditPrediction,
  serializeStampedRecord,
  parseStampedRecord,
  stampedEditToPayload,
  verificationToPayload,
  type StampEditPredictionInput,
} from "./decisionObservability.ts";

const validStamp: StampEditPredictionInput = {
  editId: "ace-lesson-001",
  editKind: "ace_lesson",
  editDescription: "Tighten FTA threshold from -0.5R to -0.4R for regime-rsi strategy",
  prediction: {
    metric: "win_rate_pct",
    direction: "increase",
    expectedDelta: 5,
    baseline: 52,
    verificationWindow: { type: "trades", n: 30 },
  },
  rationale:
    "MAE distribution of recent winners suggests -0.4R captures 80%+ without false positives",
};

describe("stampEditPrediction — validation", () => {
  it("rejects empty editId", () => {
    expect(() => stampEditPrediction({ ...validStamp, editId: "" })).toThrow();
  });

  it("rejects too-short editDescription", () => {
    expect(() => stampEditPrediction({ ...validStamp, editDescription: "short" })).toThrow();
  });

  it("rejects empty metric", () => {
    expect(() =>
      stampEditPrediction({
        ...validStamp,
        prediction: { ...validStamp.prediction, metric: "" },
      }),
    ).toThrow();
  });

  it("rejects non-positive expectedDelta", () => {
    expect(() =>
      stampEditPrediction({
        ...validStamp,
        prediction: { ...validStamp.prediction, expectedDelta: 0 },
      }),
    ).toThrow();
    expect(() =>
      stampEditPrediction({
        ...validStamp,
        prediction: { ...validStamp.prediction, expectedDelta: -1 },
      }),
    ).toThrow();
  });

  it("rejects non-finite baseline", () => {
    expect(() =>
      stampEditPrediction({
        ...validStamp,
        prediction: { ...validStamp.prediction, baseline: NaN },
      }),
    ).toThrow();
  });

  it("rejects non-integer or < 1 window size", () => {
    expect(() =>
      stampEditPrediction({
        ...validStamp,
        prediction: {
          ...validStamp.prediction,
          verificationWindow: { type: "trades", n: 0 },
        },
      }),
    ).toThrow();
    expect(() =>
      stampEditPrediction({
        ...validStamp,
        prediction: {
          ...validStamp.prediction,
          verificationWindow: { type: "trades", n: 1.5 },
        },
      }),
    ).toThrow();
  });

  it("rejects invalid stampedAt ISO", () => {
    expect(() => stampEditPrediction({ ...validStamp, stampedAt: "not-a-date" })).toThrow();
  });
});

describe("stampEditPrediction — output structure", () => {
  it("produces a stamped record with status='pending'", () => {
    const r = stampEditPrediction(validStamp);
    expect(r.status).toBe("pending");
    expect(r.editId).toBe(validStamp.editId);
    expect(r.editKind).toBe("ace_lesson");
    expect(r.rationale).toBe(validStamp.rationale);
  });

  it("computes predictedThreshold = baseline + delta for 'increase'", () => {
    const r = stampEditPrediction(validStamp);
    expect(r.predictedThreshold).toBeCloseTo(52 + 5, 6);
  });

  it("computes predictedThreshold = baseline - delta for 'decrease'", () => {
    const r = stampEditPrediction({
      ...validStamp,
      prediction: { ...validStamp.prediction, direction: "decrease" },
    });
    expect(r.predictedThreshold).toBeCloseTo(52 - 5, 6);
  });

  it("contractHash is a 64-char hex SHA-256", () => {
    const r = stampEditPrediction(validStamp);
    expect(r.contractHash.length).toBe(64);
    expect(r.contractHash).toMatch(/^[0-9a-f]+$/);
  });

  it("contractHash is deterministic for identical inputs", () => {
    const a = stampEditPrediction({ ...validStamp, stampedAt: "2026-01-01T00:00:00.000Z" });
    const b = stampEditPrediction({ ...validStamp, stampedAt: "2026-01-01T00:00:00.000Z" });
    expect(a.contractHash).toBe(b.contractHash);
  });

  it("contractHash differs when any contract field changes", () => {
    const a = stampEditPrediction(validStamp);
    const b = stampEditPrediction({
      ...validStamp,
      prediction: { ...validStamp.prediction, expectedDelta: 10 },
    });
    expect(a.contractHash).not.toBe(b.contractHash);
  });

  it("omits rationale when empty", () => {
    const r = stampEditPrediction({ ...validStamp, rationale: "" });
    expect(r.rationale).toBeUndefined();
  });
});

describe("verifyEditPrediction — basic verdicts", () => {
  it("windowElapsed=false → still_pending regardless of observed", () => {
    const stamped = stampEditPrediction(validStamp);
    const r = verifyEditPrediction({
      stamped,
      observedValue: 60, // would otherwise verify
      windowElapsed: false,
    });
    expect(r.status).toBe("still_pending");
  });

  it("direction=increase, observed meets threshold → verified", () => {
    const stamped = stampEditPrediction(validStamp);
    const r = verifyEditPrediction({
      stamped,
      observedValue: 58, // baseline 52 + delta 5 = 57; observed > threshold
      windowElapsed: true,
    });
    expect(r.directionCorrect).toBe(true);
    expect(r.magnitudeMet).toBe(true);
    expect(r.status).toBe("verified");
  });

  it("direction=increase, observed below threshold → failed", () => {
    const stamped = stampEditPrediction(validStamp);
    const r = verifyEditPrediction({
      stamped,
      observedValue: 54, // delta = +2, below required +5
      windowElapsed: true,
    });
    expect(r.directionCorrect).toBe(true);
    expect(r.magnitudeMet).toBe(false);
    expect(r.status).toBe("failed");
  });

  it("direction=increase, observed went down → failed (direction wrong)", () => {
    const stamped = stampEditPrediction(validStamp);
    const r = verifyEditPrediction({
      stamped,
      observedValue: 50,
      windowElapsed: true,
    });
    expect(r.directionCorrect).toBe(false);
    expect(r.magnitudeMet).toBe(false);
    expect(r.status).toBe("failed");
  });

  it("direction=decrease, observed meets threshold → verified", () => {
    const stamped = stampEditPrediction({
      ...validStamp,
      prediction: { ...validStamp.prediction, direction: "decrease" },
    });
    // baseline 52 - delta 5 = 47; observed 45 meets
    const r = verifyEditPrediction({
      stamped,
      observedValue: 45,
      windowElapsed: true,
    });
    expect(r.directionCorrect).toBe(true);
    expect(r.magnitudeMet).toBe(true);
    expect(r.status).toBe("verified");
  });

  it("direction=decrease, observed went up → failed (direction wrong)", () => {
    const stamped = stampEditPrediction({
      ...validStamp,
      prediction: { ...validStamp.prediction, direction: "decrease" },
    });
    const r = verifyEditPrediction({
      stamped,
      observedValue: 55,
      windowElapsed: true,
    });
    expect(r.directionCorrect).toBe(false);
    expect(r.status).toBe("failed");
  });

  it("rejects non-finite observedValue", () => {
    const stamped = stampEditPrediction(validStamp);
    expect(() =>
      verifyEditPrediction({
        stamped,
        observedValue: NaN,
        windowElapsed: true,
      }),
    ).toThrow();
  });
});

describe("verifyEditPrediction — contract tampering detection", () => {
  it("recomputes contractHash when originalStampInput supplied", () => {
    const stamped = stampEditPrediction(validStamp);
    const r = verifyEditPrediction({
      stamped,
      observedValue: 58,
      windowElapsed: true,
      originalStampInput: validStamp,
    });
    expect(r.contractIntact).toBe(true);
    expect(r.status).toBe("verified");
  });

  it("detects tampered prediction (e.g., expectedDelta changed)", () => {
    const stamped = stampEditPrediction(validStamp);
    const r = verifyEditPrediction({
      stamped,
      observedValue: 58,
      windowElapsed: true,
      originalStampInput: {
        ...validStamp,
        prediction: { ...validStamp.prediction, expectedDelta: 10 },
      },
    });
    expect(r.contractIntact).toBe(false);
    expect(r.status).toBe("failed");
  });
});

describe("serialize / parse round-trip", () => {
  it("preserves the record", () => {
    const stamped = stampEditPrediction(validStamp);
    const line = serializeStampedRecord(stamped);
    const parsed = parseStampedRecord(line);
    expect(parsed.editId).toBe(stamped.editId);
    expect(parsed.contractHash).toBe(stamped.contractHash);
    expect(parsed.predictedThreshold).toBe(stamped.predictedThreshold);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseStampedRecord("{not json}")).toThrow();
  });

  it("rejects JSON missing required fields", () => {
    expect(() => parseStampedRecord(JSON.stringify({ editId: "x" }))).toThrow();
  });
});

describe("payload shapes", () => {
  it("stampedEditToPayload emits stable shape", () => {
    const r = stampEditPrediction(validStamp);
    const p = stampedEditToPayload(r) as {
      kind: string;
      metric: string;
      direction: string;
      predictedThreshold: number;
    };
    expect(p.kind).toBe("decision_observability.stamped");
    expect(p.metric).toBe("win_rate_pct");
    expect(p.predictedThreshold).toBeCloseTo(57, 6);
  });

  it("verificationToPayload emits stable shape", () => {
    const stamped = stampEditPrediction(validStamp);
    const r = verifyEditPrediction({
      stamped,
      observedValue: 58,
      windowElapsed: true,
    });
    const p = verificationToPayload(r) as {
      kind: string;
      status: string;
      directionCorrect: boolean;
    };
    expect(p.kind).toBe("decision_observability.verified");
    expect(p.status).toBe("verified");
    expect(p.directionCorrect).toBe(true);
  });
});
