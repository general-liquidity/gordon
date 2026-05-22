import { describe, it, expect } from "bun:test";
import {
  CANONICAL_EVENTS,
  getCanonicalEvent,
  CHF_UNPEG_2015,
  PBOC_CNY_DEVALUATION_2015,
  US_ELECTION_OVERNIGHT_2016,
  COVID_VOL_SPIKE_2020,
} from "./catalog.ts";

describe("catalog — shape", () => {
  it("exposes all four canonical events", () => {
    expect(CANONICAL_EVENTS.length).toBe(4);
    const ids = CANONICAL_EVENTS.map((e) => e.id);
    expect(ids).toContain("chf-unpeg-2015-01-15");
    expect(ids).toContain("pboc-cny-devaluation-2015-08-11");
    expect(ids).toContain("us-election-overnight-2016-11-08");
    expect(ids).toContain("covid-vol-spike-2020-03-11");
  });

  it("each event has all required fields populated", () => {
    for (const event of CANONICAL_EVENTS) {
      expect(event.id).toBeTruthy();
      expect(event.name).toBeTruthy();
      expect(event.description).toBeTruthy();
      expect(event.primaryAssets.length).toBeGreaterThan(0);
      expect(event.characteristics).toBeDefined();
      expect(event.references?.length).toBeGreaterThan(0);
    }
  });

  it("each event has ISO-parseable timestamps in chronological order", () => {
    for (const event of CANONICAL_EVENTS) {
      const start = Date.parse(event.windowStart);
      const end = Date.parse(event.windowEnd);
      const volStart = Date.parse(event.volExpansionStart);
      expect(Number.isFinite(start)).toBe(true);
      expect(Number.isFinite(end)).toBe(true);
      expect(Number.isFinite(volStart)).toBe(true);
      expect(end).toBeGreaterThan(start);
      expect(volStart).toBeGreaterThanOrEqual(start);
      expect(volStart).toBeLessThanOrEqual(end);
    }
  });
});

describe("getCanonicalEvent", () => {
  it("returns event for valid id", () => {
    expect(getCanonicalEvent("chf-unpeg-2015-01-15")?.id).toBe(CHF_UNPEG_2015.id);
  });

  it("returns undefined for unknown id", () => {
    expect(getCanonicalEvent("not-a-real-event")).toBeUndefined();
  });
});

describe("catalog — event-specific assertions", () => {
  it("CHF unpeg has gap risk + spread widening flags", () => {
    expect(CHF_UNPEG_2015.characteristics.gapRisk).toBe(true);
    expect(CHF_UNPEG_2015.characteristics.spreadWidening).toBe(true);
    expect(CHF_UNPEG_2015.primaryAssets.some((a) => a.symbol.includes("CHF"))).toBe(true);
  });

  it("PBOC devaluation includes cross-asset contagion entries", () => {
    expect(PBOC_CNY_DEVALUATION_2015.contagionAssets?.length).toBeGreaterThan(0);
    const contagionMarkets = (PBOC_CNY_DEVALUATION_2015.contagionAssets ?? []).map((a) => a.market);
    expect(contagionMarkets).toContain("commodity");
    expect(contagionMarkets).toContain("equity_index");
  });

  it("US election event spans the close/open window", () => {
    const start = Date.parse(US_ELECTION_OVERNIGHT_2016.windowStart);
    const end = Date.parse(US_ELECTION_OVERNIGHT_2016.windowEnd);
    const hours = (end - start) / (1000 * 60 * 60);
    expect(hours).toBeGreaterThan(20);
    expect(US_ELECTION_OVERNIGHT_2016.characteristics.sessionsHalted).toBe(true);
  });

  it("COVID event spans the multi-day vol spike", () => {
    const start = Date.parse(COVID_VOL_SPIKE_2020.windowStart);
    const end = Date.parse(COVID_VOL_SPIKE_2020.windowEnd);
    const days = (end - start) / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThan(10);
    expect(COVID_VOL_SPIKE_2020.characteristics.sessionsHalted).toBe(true);
  });
});
