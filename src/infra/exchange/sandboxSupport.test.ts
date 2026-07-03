import { describe, it, expect } from "bun:test";

import {
  resolveSandboxMode,
  LiveOptInRequiredError,
  ALLOW_LIVE_ENV,
} from "./sandboxSupport.ts";

const NO_ENV: NodeJS.ProcessEnv = {};

describe("resolveSandboxMode — safe-by-default crypto sandbox", () => {
  it("explicit sandbox:true always resolves to sandbox", () => {
    expect(
      resolveSandboxMode({ exchangeId: "ccxt:binance", requestedSandbox: true, env: NO_ENV }),
    ).toBe(true);
  });

  it("explicit sandbox:false is respected as a deliberate LIVE choice (supported venue)", () => {
    expect(
      resolveSandboxMode({ exchangeId: "ccxt:binance", requestedSandbox: false, env: NO_ENV }),
    ).toBe(false);
  });

  it("explicit sandbox:false is respected as LIVE even on a no-sandbox venue", () => {
    expect(
      resolveSandboxMode({ exchangeId: "ccxt:coinbase", requestedSandbox: false, env: NO_ENV }),
    ).toBe(false);
  });

  it("undefined sandbox defaults to SANDBOX for a venue that supports one", () => {
    expect(
      resolveSandboxMode({ exchangeId: "ccxt:binance", requestedSandbox: undefined, env: NO_ENV }),
    ).toBe(true);
  });

  it("undefined sandbox on a NO-sandbox venue REFUSES (no silent live)", () => {
    expect(() =>
      resolveSandboxMode({ exchangeId: "ccxt:coinbase", requestedSandbox: undefined, env: NO_ENV }),
    ).toThrow(LiveOptInRequiredError);
  });

  it("no-sandbox venue goes live with explicit live:true opt-in", () => {
    expect(
      resolveSandboxMode({
        exchangeId: "ccxt:coinbase",
        requestedSandbox: undefined,
        live: true,
        env: NO_ENV,
      }),
    ).toBe(false);
  });

  it("no-sandbox venue goes live with GORDON_ALLOW_LIVE=1", () => {
    expect(
      resolveSandboxMode({
        exchangeId: "ccxt:coinbase",
        requestedSandbox: undefined,
        env: { [ALLOW_LIVE_ENV]: "1" },
      }),
    ).toBe(false);
  });

  it("GORDON_ALLOW_LIVE does not force live on a sandbox-capable venue left unset", () => {
    // Safe-by-default still wins for venues that HAVE a sandbox: the env flag
    // only unblocks no-sandbox venues, it does not override the safe default.
    expect(
      resolveSandboxMode({
        exchangeId: "ccxt:binance",
        requestedSandbox: undefined,
        env: { [ALLOW_LIVE_ENV]: "1" },
      }),
    ).toBe(true);
  });
});
