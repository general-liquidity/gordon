import { describe, expect, it } from "bun:test";

import { DeribitOptionsProvider } from "./deribit.ts";
import {
  OptionsChainManager,
  optionsChainProviders,
  registerOptionsChainSources,
} from "./index.ts";
import type { OptionContract } from "./types.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Representative Deribit JSON for both public endpoints. Built relative to
 * `now` so expiry math is deterministic regardless of when the test runs:
 *   - BTC-CALL  : live, OI 120, IV 55.2%  → mapped
 *   - BTC-PUT   : live, OI 80,  IV 60.0%  → mapped
 *   - BTC-EXPIRED : expiration in the PAST → timeYears ≤ 0 → skipped
 *   - BTC-ZERO  : live but OI 0           → skipped
 *   - BTC-NOSUMMARY : in instruments, absent from book summary → unjoined, skipped
 */
function makeFetch(now: number): typeof fetch {
  const in30d = now + 30 * DAY_MS;
  const expiredAt = now - 7 * DAY_MS;

  const instruments = [
    {
      instrument_name: "BTC-CALL",
      strike: 70000,
      option_type: "call",
      expiration_timestamp: in30d,
    },
    { instrument_name: "BTC-PUT", strike: 60000, option_type: "put", expiration_timestamp: in30d },
    {
      instrument_name: "BTC-EXPIRED",
      strike: 65000,
      option_type: "call",
      expiration_timestamp: expiredAt,
    },
    {
      instrument_name: "BTC-ZERO",
      strike: 80000,
      option_type: "call",
      expiration_timestamp: in30d,
    },
    {
      instrument_name: "BTC-NOSUMMARY",
      strike: 90000,
      option_type: "put",
      expiration_timestamp: in30d,
    },
  ];

  const summaries = [
    { instrument_name: "BTC-CALL", open_interest: 120, mark_iv: 55.2, underlying_price: 65000 },
    { instrument_name: "BTC-PUT", open_interest: 80, mark_iv: 60.0, underlying_price: 65010 },
    { instrument_name: "BTC-EXPIRED", open_interest: 50, mark_iv: 40.0, underlying_price: 64990 },
    { instrument_name: "BTC-ZERO", open_interest: 0, mark_iv: 70.0, underlying_price: 65020 },
    // BTC-NOSUMMARY intentionally absent.
  ];

  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const payload = url.includes("get_book_summary_by_currency")
      ? { result: summaries }
      : url.includes("get_instruments")
        ? { result: instruments }
        : { result: [] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("DeribitOptionsProvider", () => {
  it("joins instruments + book summary into OptionContracts with correct mapping", async () => {
    const now = Date.now();
    const provider = new DeribitOptionsProvider(makeFetch(now));
    const snapshot = await provider.getChain("BTC");

    expect(snapshot.underlying).toBe("BTC");
    // Only the two live, positive-OI, joined rows survive.
    expect(snapshot.contracts.length).toBe(2);

    const call = snapshot.contracts.find((c) => c.optionType === "call");
    const put = snapshot.contracts.find((c) => c.optionType === "put");
    expect(call).toBeDefined();
    expect(put).toBeDefined();

    // strike passthrough
    expect(call!.strike).toBe(70000);
    expect(put!.strike).toBe(60000);

    // mark_iv is a PERCENT on the wire → fraction in the contract.
    expect(call!.iv).toBeCloseTo(0.552, 6);
    expect(put!.iv).toBeCloseTo(0.6, 6);

    // openInterest passthrough
    expect(call!.openInterest).toBe(120);
    expect(put!.openInterest).toBe(80);

    // timeYears positive for a ~30d expiry, and ≈ 30/365.25.
    expect(call!.timeYears).toBeGreaterThan(0);
    expect(call!.timeYears).toBeCloseTo((30 * DAY_MS) / (365.25 * DAY_MS), 2);
  });

  it("skips expired, zero-OI, and unjoined rows", async () => {
    const now = Date.now();
    const provider = new DeribitOptionsProvider(makeFetch(now));
    const snapshot = await provider.getChain("BTC");

    // Expired (past expiration), zero-OI, and the no-summary instrument are all dropped.
    expect(snapshot.contracts.length).toBe(2);
    expect(snapshot.contracts.every((c) => c.timeYears > 0)).toBeTrue();
    expect(snapshot.contracts.every((c) => c.openInterest > 0)).toBeTrue();
    // The 65000 strike only existed on the EXPIRED instrument → must be gone.
    expect(snapshot.contracts.some((c) => c.strike === 65000)).toBeFalse();
    // The 80000 (zero-OI) and 90000 (no-summary) strikes must be gone too.
    expect(snapshot.contracts.some((c) => c.strike === 80000)).toBeFalse();
    expect(snapshot.contracts.some((c) => c.strike === 90000)).toBeFalse();
  });

  it("derives spotUsd as the median underlying_price across joined rows", async () => {
    const now = Date.now();
    const provider = new DeribitOptionsProvider(makeFetch(now));
    const snapshot = await provider.getChain("BTC");

    // Only the two surviving rows contribute underlying_price (65000, 65010) → median 65005.
    expect(snapshot.spotUsd).toBe(65005);
    expect(Number.isFinite(snapshot.spotUsd)).toBeTrue();
  });

  it("produces contracts that satisfy the OptionContract shape", async () => {
    const now = Date.now();
    const provider = new DeribitOptionsProvider(makeFetch(now));
    const snapshot = await provider.getChain("BTC");

    for (const c of snapshot.contracts) {
      // Structural conformance to OptionContract: the 5 required fields, right types.
      const contract: OptionContract = c;
      expect(typeof contract.strike).toBe("number");
      expect(typeof contract.timeYears).toBe("number");
      expect(typeof contract.openInterest).toBe("number");
      expect(typeof contract.iv).toBe("number");
      expect(contract.optionType === "call" || contract.optionType === "put").toBeTrue();
      // Every field finite, IV a positive fraction.
      expect(Number.isFinite(contract.strike)).toBeTrue();
      expect(Number.isFinite(contract.timeYears)).toBeTrue();
      expect(Number.isFinite(contract.iv)).toBeTrue();
      expect(contract.iv).toBeGreaterThan(0);
    }
  });

  it("sets fetchedAt and stamps the snapshot timestamp", async () => {
    const before = Date.now();
    const provider = new DeribitOptionsProvider(makeFetch(before));
    const snapshot = await provider.getChain("BTC");
    expect(snapshot.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(snapshot.fetchedAt).toBeLessThanOrEqual(Date.now());
  });

  it("rejects unsupported currencies (Deribit lists BTC/ETH only)", async () => {
    const provider = new DeribitOptionsProvider(makeFetch(Date.now()));
    await expect(provider.getChain("DOGE")).rejects.toThrow();
  });

  it("uppercases the currency when querying", async () => {
    let lastUrl = "";
    const fetchImpl = (async (input: string | URL | Request) => {
      lastUrl = typeof input === "string" ? input : input.toString();
      const payload = lastUrl.includes("get_book_summary_by_currency")
        ? { result: [] }
        : { result: [] };
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new DeribitOptionsProvider(fetchImpl);
    const snapshot = await provider.getChain("btc");
    expect(snapshot.underlying).toBe("BTC");
    expect(lastUrl).toContain("currency=BTC");
  });
});

describe("options-chain adapter (manager + registry)", () => {
  it("registers the Deribit provider with a finite priority + crypto currencies", () => {
    const providers = optionsChainProviders();
    expect(providers.map((p) => p.id)).toEqual(["deribit"]);
    for (const p of providers) {
      expect(typeof p.priority).toBe("number");
      expect(p.requiresAuth).toBeFalse();
      const caps = p.getCapabilities();
      expect(caps.currencies).toContain("BTC");
      expect(caps.currencies).toContain("ETH");
    }
  });

  it("manager routes to the provider that lists the currency and returns its chain", async () => {
    const now = Date.now();
    const manager = new OptionsChainManager();
    manager.register(new DeribitOptionsProvider(makeFetch(now)));
    const snapshot = await manager.getChain("BTC");
    expect(snapshot.contracts.length).toBe(2);
  });

  it("manager throws for a currency no provider lists", async () => {
    const manager = new OptionsChainManager();
    manager.register(new DeribitOptionsProvider(makeFetch(Date.now())));
    await expect(manager.getChain("SOL")).rejects.toThrow();
  });

  it("registerOptionsChainSources wires the default-set providers onto a manager", () => {
    const manager = new OptionsChainManager();
    registerOptionsChainSources(manager);
    expect(manager.listProviders().map((p) => p.id)).toEqual(["deribit"]);
  });

  it("manager falls through a failing provider to a healthy lower-priority one", async () => {
    const now = Date.now();
    const failing = new DeribitOptionsProvider((async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch);
    // Give the failing one higher priority (tried first); the healthy one is a clone with a distinct id.
    const healthy = new DeribitOptionsProvider(makeFetch(now));
    Object.defineProperty(healthy, "id", { value: "deribit-backup" });
    Object.defineProperty(failing, "priority", { value: 1 });
    Object.defineProperty(healthy, "priority", { value: 2 });

    const manager = new OptionsChainManager();
    manager.register(failing);
    manager.register(healthy);
    const snapshot = await manager.getChain("BTC");
    expect(snapshot.contracts.length).toBe(2);
  });
});
