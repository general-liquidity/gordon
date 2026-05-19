import { describe, it, expect } from "bun:test";

import {
  isAdverseSelectionEnabled,
  detectAdverseSelection,
  aggregateFills,
  detectorToPayload,
  ADVERSE_SELECTION_FLAG_ENV,
} from "./adverseSelectionDetector.ts";

describe("isAdverseSelectionEnabled", () => {
  it("respects the flag", () => {
    expect(isAdverseSelectionEnabled({})).toBe(false);
    expect(isAdverseSelectionEnabled({ [ADVERSE_SELECTION_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("detectAdverseSelection — clean fill", () => {
  it("slow fill with no adverse move → clean", () => {
    const r = detectAdverseSelection({
      fill: {
        orderSubmittedAtMs: 1000,
        filledAtMs: 30_000,
        side: "buy",
        fillPrice: 100,
        midPriceAtSubmit: 100,
        midPriceAfterWindow: 100.1,
      },
    });
    expect(r.verdict).toBe("clean");
    expect(r.wasFastFill).toBe(false);
    expect(r.wasAdverseMove).toBe(false);
  });
});

describe("detectAdverseSelection — adversely selected", () => {
  it("fast fill + immediate adverse move → toxic", () => {
    const r = detectAdverseSelection({
      fill: {
        orderSubmittedAtMs: 1000,
        filledAtMs: 1500,
        side: "buy",
        fillPrice: 100,
        midPriceAtSubmit: 100,
        midPriceAfterWindow: 99.5,
      },
    });
    expect(r.verdict).toBe("adversely_selected");
    expect(r.wasFastFill).toBe(true);
    expect(r.wasAdverseMove).toBe(true);
  });

  it("short side: adverse move is UP, detection accounts for side", () => {
    const r = detectAdverseSelection({
      fill: {
        orderSubmittedAtMs: 1000,
        filledAtMs: 1100,
        side: "sell",
        fillPrice: 100,
        midPriceAtSubmit: 100,
        midPriceAfterWindow: 100.5,
      },
    });
    expect(r.verdict).toBe("adversely_selected");
  });
});

describe("detectAdverseSelection — neutral states", () => {
  it("fast fill but no adverse move → neutral", () => {
    const r = detectAdverseSelection({
      fill: {
        orderSubmittedAtMs: 1000,
        filledAtMs: 1100,
        side: "buy",
        fillPrice: 100,
        midPriceAtSubmit: 100,
        midPriceAfterWindow: 100.1,
      },
    });
    expect(r.verdict).toBe("neutral");
  });

  it("slow fill but adverse move → neutral (fundamental, not toxic)", () => {
    const r = detectAdverseSelection({
      fill: {
        orderSubmittedAtMs: 1000,
        filledAtMs: 30_000,
        side: "buy",
        fillPrice: 100,
        midPriceAtSubmit: 100,
        midPriceAfterWindow: 99.5,
      },
    });
    expect(r.verdict).toBe("neutral");
  });
});

describe("detectAdverseSelection — custom thresholds", () => {
  it("respects custom fast-fill seconds", () => {
    const r = detectAdverseSelection({
      fill: {
        orderSubmittedAtMs: 1000,
        filledAtMs: 6000,
        side: "buy",
        fillPrice: 100,
        midPriceAtSubmit: 100,
        midPriceAfterWindow: 99.5,
      },
      fastFillSeconds: 10,
    });
    expect(r.wasFastFill).toBe(true);
  });
});

describe("aggregateFills", () => {
  it("computes adverse fraction", () => {
    const r = aggregateFills([
      "adversely_selected",
      "adversely_selected",
      "clean",
      "neutral",
      "clean",
      "adversely_selected",
      "clean",
      "neutral",
      "clean",
      "clean",
    ]);
    expect(r.totalFills).toBe(10);
    expect(r.adverselySelectedCount).toBe(3);
    expect(r.fraction).toBeCloseTo(0.3, 5);
    expect(r.alarm).toBe(true);
  });

  it("doesn't alarm below 10 fills", () => {
    const r = aggregateFills(["adversely_selected", "adversely_selected"]);
    expect(r.alarm).toBe(false);
  });

  it("respects custom alarm threshold", () => {
    const r = aggregateFills(
      ["adversely_selected", "clean", "clean", "clean", "clean", "clean", "clean", "clean", "clean", "clean"],
      0.05,
    );
    expect(r.alarm).toBe(true);
  });
});

describe("detectAdverseSelection — MS6 microstructure toxicity prior", () => {
  it("high pre-fill toxicity upgrades neutral fast-fill to adversely_selected", () => {
    const r = detectAdverseSelection({
      fill: {
        orderSubmittedAtMs: 1000,
        filledAtMs: 1100,
        side: "buy",
        fillPrice: 100,
        midPriceAtSubmit: 100,
        midPriceAfterWindow: 100.1,
      },
      toxicityPriorBeforeFill: 0.75,
    });
    expect(r.verdict).toBe("adversely_selected");
    expect(r.manipulationUpgraded).toBe(true);
  });

  it("low toxicity prior doesn't upgrade", () => {
    const r = detectAdverseSelection({
      fill: {
        orderSubmittedAtMs: 1000,
        filledAtMs: 1100,
        side: "buy",
        fillPrice: 100,
        midPriceAtSubmit: 100,
        midPriceAfterWindow: 100.1,
      },
      toxicityPriorBeforeFill: 0.2,
    });
    expect(r.verdict).toBe("neutral");
    expect(r.manipulationUpgraded).toBe(false);
  });

  it("toxicity prior doesn't change clean verdict", () => {
    const r = detectAdverseSelection({
      fill: {
        orderSubmittedAtMs: 1000,
        filledAtMs: 30_000,
        side: "buy",
        fillPrice: 100,
        midPriceAtSubmit: 100,
        midPriceAfterWindow: 100.1,
      },
      toxicityPriorBeforeFill: 0.9,
    });
    expect(r.verdict).toBe("clean");
  });
});

describe("detectorToPayload", () => {
  it("emits stable shape", () => {
    const r = detectAdverseSelection({
      fill: {
        orderSubmittedAtMs: 1000,
        filledAtMs: 1100,
        side: "buy",
        fillPrice: 100,
        midPriceAtSubmit: 100,
        midPriceAfterWindow: 99.5,
      },
    });
    const p = detectorToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("adverse_selection.evaluated");
    expect(p.verdict).toBe("adversely_selected");
  });
});
