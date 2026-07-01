import { describe, expect, test } from "bun:test";
import {
  classifyGameType,
  formatGameType,
  type GameTypeInputs,
} from "./gameTypeClassifier.ts";

describe("classifyGameType", () => {
  test("productive asset with real yield above drag => positive-sum", () => {
    const r = classifyGameType({
      instrumentClass: "productive_asset",
      counterparty: "issuer_or_production",
      realYieldAnnualized: 0.06,
      feeDragAnnualized: 0.002,
    });
    expect(r.gameType).toBe("positive_sum");
    expect(r.generation).toBeCloseTo(0.06, 12);
    expect(r.netEdgePerYear).toBeCloseTo(0.058, 12);
    expect(r.whoFundsEdge).toContain("Real economic value");
  });

  test("derivative with no drag => zero-sum (netting, no generation)", () => {
    const r = classifyGameType({
      instrumentClass: "derivative",
      counterparty: "peer_netting",
    });
    expect(r.gameType).toBe("zero_sum");
    expect(r.generation).toBe(0);
    expect(r.netEdgePerYear).toBe(0);
    expect(r.whoFundsEdge).toContain("Another trader");
  });

  test("derivative with funding + fee drag => negative-sum", () => {
    const r = classifyGameType({
      instrumentClass: "derivative",
      counterparty: "peer_netting",
      fundingDragAnnualized: 0.12,
      feeDragAnnualized: 0.03,
    });
    expect(r.gameType).toBe("negative_sum");
    expect(r.totalDrag).toBeCloseTo(0.15, 12);
    expect(r.netEdgePerYear).toBeCloseTo(-0.15, 12);
    expect(r.whoFundsEdge).toContain("fund the edge");
  });

  test("house counterparty adds rake => negative-sum by construction", () => {
    const r = classifyGameType({
      instrumentClass: "non_yielding_store",
      counterparty: "house_or_venue",
      houseEdgeAnnualized: 0.02,
    });
    expect(r.gameType).toBe("negative_sum");
    expect(r.totalDrag).toBeCloseTo(0.02, 12);
    expect(r.whoFundsEdge).toContain("venue");
  });

  test("house edge ignored unless counterparty is house_or_venue", () => {
    const r = classifyGameType({
      instrumentClass: "derivative",
      counterparty: "peer_netting",
      houseEdgeAnnualized: 0.05,
    });
    expect(r.components.houseEdgeAnnualized).toBe(0);
    expect(r.gameType).toBe("zero_sum");
  });

  test("real yield NOT credited to a productive asset wrapped by a house", () => {
    // A yielding asset accessed through a rake-taking venue: generation is
    // not funded by production for the participant pool.
    const r = classifyGameType({
      instrumentClass: "productive_asset",
      counterparty: "house_or_venue",
      realYieldAnnualized: 0.05,
      houseEdgeAnnualized: 0.01,
    });
    expect(r.generation).toBe(0);
    expect(r.gameType).toBe("negative_sum");
  });

  test("real yield NOT credited to a derivative", () => {
    const r = classifyGameType({
      instrumentClass: "derivative",
      counterparty: "issuer_or_production",
      realYieldAnnualized: 0.08,
    });
    expect(r.generation).toBe(0);
  });

  test("non-yielding store held spot with fees => negative-sum", () => {
    const r = classifyGameType({
      instrumentClass: "non_yielding_store",
      counterparty: "peer_netting",
      feeDragAnnualized: 0.01,
    });
    expect(r.gameType).toBe("negative_sum");
    expect(r.generation).toBe(0);
  });

  test("epsilon dead-band classifies tiny net as zero-sum", () => {
    const r = classifyGameType(
      {
        instrumentClass: "productive_asset",
        counterparty: "issuer_or_production",
        realYieldAnnualized: 0.006,
        feeDragAnnualized: 0.004,
      },
      { epsilon: 0.005 },
    );
    // net = 0.002, within +/-0.005 dead-band.
    expect(r.netEdgePerYear).toBeCloseTo(0.002, 12);
    expect(r.gameType).toBe("zero_sum");
  });

  test("negative drags are floored at zero", () => {
    const r = classifyGameType({
      instrumentClass: "derivative",
      counterparty: "peer_netting",
      feeDragAnnualized: -1,
    });
    expect(r.totalDrag).toBe(0);
    expect(r.gameType).toBe("zero_sum");
  });

  test("no hardcoded venue references in output", () => {
    const r = classifyGameType({
      instrumentClass: "derivative",
      counterparty: "peer_netting",
      fundingDragAnnualized: 0.1,
    });
    expect(r.reasoning.toLowerCase()).not.toContain("binance");
    expect(r.reasoning.toLowerCase()).not.toContain("coinbase");
  });
});

describe("formatGameType", () => {
  test("summary carries the game type", () => {
    const inputs: GameTypeInputs = {
      instrumentClass: "derivative",
      counterparty: "peer_netting",
      fundingDragAnnualized: 0.1,
    };
    const s = formatGameType(classifyGameType(inputs));
    expect(s).toContain("negative-sum");
  });
});
