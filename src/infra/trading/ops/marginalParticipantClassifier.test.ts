import { describe, it, expect } from "bun:test";

import { classifyMarginalParticipant, marginalToPayload } from "./marginalParticipantClassifier.ts";

describe("classifyMarginalParticipant — typical state (default)", () => {
  it("no drivers → typical with default confidence", () => {
    const r = classifyMarginalParticipant({ drivers: [] });
    expect(r.marginal).toBe("typical");
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("calm conditions (low vix + low correlation) → typical with high confidence", () => {
    const r = classifyMarginalParticipant({
      drivers: [],
      vixZScore: -1.5,
      correlationZScore: -1.5,
    });
    expect(r.marginal).toBe("typical");
    expect(r.confidence).toBeGreaterThan(0.6);
  });
});

describe("classifyMarginalParticipant — opportunity state", () => {
  it("stress driver alone reaches opportunity threshold", () => {
    const r = classifyMarginalParticipant({
      drivers: ["margin_call_cascade", "vix_spike"],
    });
    expect(r.marginal).toBe("opportunity");
    expect(r.drivers.length).toBe(2);
  });

  it("multiple calendar drivers reach opportunity threshold", () => {
    const r = classifyMarginalParticipant({
      drivers: ["index_reconstitution", "month_end_rebalance", "etf_inclusion"],
    });
    expect(r.marginal).toBe("opportunity");
  });

  it("Bill Ackman March 2020 scenario (multiple stress drivers)", () => {
    const r = classifyMarginalParticipant({
      drivers: ["margin_call_cascade", "correlation_spike", "bid_evaporation", "vix_spike"],
      vixZScore: 4,
      correlationZScore: 3,
    });
    expect(r.marginal).toBe("opportunity");
    expect(r.confidence).toBe(1);
  });
});

describe("classifyMarginalParticipant — uncertain state", () => {
  it("single calendar driver → uncertain", () => {
    const r = classifyMarginalParticipant({
      drivers: ["futures_roll"],
    });
    expect(r.marginal).toBe("uncertain");
  });
});

describe("classifyMarginalParticipant — deduplication", () => {
  it("repeated drivers count once", () => {
    const r = classifyMarginalParticipant({
      drivers: ["vix_spike", "vix_spike", "vix_spike"],
    });
    expect(r.drivers.length).toBe(1);
  });
});

describe("marginalToPayload", () => {
  it("emits stable shape", () => {
    const r = classifyMarginalParticipant({ drivers: ["margin_call_cascade"] });
    const p = marginalToPayload(r) as { kind: string; marginal: string };
    expect(p.kind).toBe("marginal_participant.classified");
    expect(p.marginal).toBeDefined();
  });
});
