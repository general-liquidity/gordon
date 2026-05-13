import { describe, it, expect } from "bun:test";

import {
  isSprintContractEnabled,
  createSprintContract,
  compareWithActuals,
  contractToPayload,
  diffToPayload,
} from "./sprintContract.ts";

describe("isSprintContractEnabled", () => {
  it("respects the flag", () => {
    expect(isSprintContractEnabled({})).toBe(false);
    expect(isSprintContractEnabled({ GORDON_SPRINT_CONTRACT: "1" })).toBe(true);
    expect(isSprintContractEnabled({ GORDON_SPRINT_CONTRACT: "true" })).toBe(true);
  });
});

describe("createSprintContract", () => {
  it("normalizes empty drafts to empty arrays", () => {
    const c = createSprintContract({});
    expect(c.scope.symbols).toEqual([]);
    expect(c.scope.venues).toEqual([]);
    expect(c.scope.strategies).toEqual([]);
    expect(c.verificationStandards).toEqual([]);
    expect(c.exclusions).toEqual([]);
    expect(c.intent).toBeUndefined();
    expect(c.contractId).toMatch(/^sprint-/);
    expect(new Date(c.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("dedupes and trims inputs, lowercases venues", () => {
    const c = createSprintContract({
      scope: {
        symbols: ["BTCUSDT", "BTCUSDT", " ETHUSDT "],
        venues: ["Binance", "BINANCE", "coinbase "],
        strategies: ["regime-rsi", "regime-rsi"],
      },
      verificationStandards: [" win rate > 60% ", "win rate > 60%"],
      exclusions: ["no shorting"],
      intent: "  test session  ",
    });
    expect(c.scope.symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(c.scope.venues).toEqual(["binance", "coinbase"]);
    expect(c.scope.strategies).toEqual(["regime-rsi"]);
    expect(c.verificationStandards).toEqual(["win rate > 60%"]);
    expect(c.exclusions).toEqual(["no shorting"]);
    expect(c.intent).toBe("test session");
  });
});

describe("compareWithActuals", () => {
  const baseContract = createSprintContract({
    scope: {
      symbols: ["BTCUSDT", "ETHUSDT"],
      venues: ["binance"],
      strategies: ["regime-rsi"],
    },
    verificationStandards: ["win rate above 60%", "no daily drawdown beyond 2%"],
    exclusions: ["no shorting", "no leverage above 3x"],
  });

  it("clean verdict when actuals match scope, standards met, no violations", () => {
    const diff = compareWithActuals(baseContract, {
      symbolsTouched: ["BTCUSDT"],
      venuesUsed: ["Binance"],
      strategiesInvoked: ["regime-rsi"],
      verificationOutcomes: [
        { standard: "session win rate above 60%", met: true },
        { standard: "no daily drawdown beyond 2%", met: true },
      ],
      detectedViolations: [],
    });
    expect(diff.verdict).toBe("clean");
    expect(diff.outOfScopeSymbols).toEqual([]);
    expect(diff.unmetStandards).toEqual([]);
    expect(diff.violatedExclusions).toEqual([]);
  });

  it("drift verdict when symbol scope drift exists but no exclusion violation", () => {
    const diff = compareWithActuals(baseContract, {
      symbolsTouched: ["BTCUSDT", "SOLUSDT"],
      venuesUsed: ["binance"],
      strategiesInvoked: ["regime-rsi"],
      verificationOutcomes: [
        { standard: "win rate above 60%", met: true },
        { standard: "no daily drawdown beyond 2%", met: true },
      ],
      detectedViolations: [],
    });
    expect(diff.verdict).toBe("drift");
    expect(diff.outOfScopeSymbols).toEqual(["SOLUSDT"]);
  });

  it("drift verdict when standards are unmet", () => {
    const diff = compareWithActuals(baseContract, {
      symbolsTouched: ["BTCUSDT"],
      venuesUsed: ["binance"],
      strategiesInvoked: ["regime-rsi"],
      verificationOutcomes: [
        { standard: "win rate above 60%", met: false },
      ],
      detectedViolations: [],
    });
    expect(diff.verdict).toBe("drift");
    expect(diff.unmetStandards).toContain("win rate above 60%");
    expect(diff.unmetStandards).toContain("no daily drawdown beyond 2%");
  });

  it("violation verdict when an exclusion is violated, regardless of scope", () => {
    const diff = compareWithActuals(baseContract, {
      symbolsTouched: ["BTCUSDT"],
      venuesUsed: ["binance"],
      strategiesInvoked: ["regime-rsi"],
      verificationOutcomes: [
        { standard: "win rate above 60%", met: true },
        { standard: "no daily drawdown beyond 2%", met: true },
      ],
      // The detected-violation string must mention the exclusion text;
      // this is the contract — the caller (Gordon's runtime) is
      // responsible for tagging violations with which rule they breached.
      detectedViolations: ["no shorting rule breached: opened short position on BTCUSDT"],
    });
    expect(diff.verdict).toBe("violation");
    expect(diff.violatedExclusions).toContain("no shorting");
    expect(diff.honoredExclusions).toContain("no leverage above 3x");
  });

  it("treats empty scope arrays as no constraint", () => {
    const contract = createSprintContract({
      verificationStandards: ["something"],
    });
    const diff = compareWithActuals(contract, {
      symbolsTouched: ["LITERALLY_ANYTHING"],
      venuesUsed: ["any-venue"],
      strategiesInvoked: ["anything"],
      verificationOutcomes: [{ standard: "something", met: true }],
      detectedViolations: [],
    });
    expect(diff.outOfScopeSymbols).toEqual([]);
    expect(diff.outOfScopeVenues).toEqual([]);
    expect(diff.outOfScopeStrategies).toEqual([]);
  });

  it("venue match is case-insensitive", () => {
    const diff = compareWithActuals(baseContract, {
      symbolsTouched: ["BTCUSDT"],
      venuesUsed: ["BINANCE"],
      strategiesInvoked: ["regime-rsi"],
      verificationOutcomes: [
        { standard: "win rate above 60%", met: true },
        { standard: "no daily drawdown beyond 2%", met: true },
      ],
      detectedViolations: [],
    });
    expect(diff.outOfScopeVenues).toEqual([]);
  });
});

describe("contractToPayload + diffToPayload", () => {
  it("produces stable shapes", () => {
    const contract = createSprintContract({
      scope: { symbols: ["BTCUSDT"] },
      verificationStandards: ["win"],
      exclusions: ["no shorting"],
      intent: "test",
    });
    const payload = contractToPayload(contract);
    expect(payload.kind).toBe("sprint.contract_recorded");
    expect(payload.contractId).toBe(contract.contractId);
    expect(payload.scope).toEqual(contract.scope);

    const diff = compareWithActuals(contract, {
      symbolsTouched: ["BTCUSDT"],
      venuesUsed: [],
      strategiesInvoked: [],
      verificationOutcomes: [{ standard: "win", met: true }],
      detectedViolations: [],
    });
    const dpayload = diffToPayload(diff);
    expect(dpayload.kind).toBe("sprint.contract_diff_recorded");
    expect(dpayload.verdict).toBe("clean");
  });
});
