import { describe, it, expect } from "bun:test";
import {
  ccxtSubIdRequiresPassphrase,
  ccxtSubIdRequiresWallet,
  ccxtExchangeRequiresPassphrase,
  ccxtExchangeRequiresWallet,
  getCcxtSetupInstructions,
  getCcxtHelpFragment,
} from "./ccxt-ux.ts";

describe("ccxtSubIdRequiresPassphrase", () => {
  it("flags exchanges that need passphrase", () => {
    expect(ccxtSubIdRequiresPassphrase("okx")).toBe(true);
    expect(ccxtSubIdRequiresPassphrase("kucoin")).toBe(true);
    expect(ccxtSubIdRequiresPassphrase("bitget")).toBe(true);
    expect(ccxtSubIdRequiresPassphrase("gate")).toBe(true);
    expect(ccxtSubIdRequiresPassphrase("coinbase")).toBe(true);
  });

  it("returns false for non-passphrase exchanges", () => {
    expect(ccxtSubIdRequiresPassphrase("binance")).toBe(false);
    expect(ccxtSubIdRequiresPassphrase("bybit")).toBe(false);
    expect(ccxtSubIdRequiresPassphrase("mexc")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(ccxtSubIdRequiresPassphrase("OKX")).toBe(true);
    expect(ccxtSubIdRequiresPassphrase("KuCoin")).toBe(true);
  });
});

describe("ccxtSubIdRequiresWallet", () => {
  it("flags DEX-style exchanges that use wallets", () => {
    expect(ccxtSubIdRequiresWallet("hyperliquid")).toBe(true);
    expect(ccxtSubIdRequiresWallet("apex")).toBe(true);
    expect(ccxtSubIdRequiresWallet("dydx")).toBe(true);
    expect(ccxtSubIdRequiresWallet("paradex")).toBe(true);
    expect(ccxtSubIdRequiresWallet("lighter")).toBe(true);
  });

  it("returns false for CEX exchanges", () => {
    expect(ccxtSubIdRequiresWallet("binance")).toBe(false);
    expect(ccxtSubIdRequiresWallet("kucoin")).toBe(false);
  });
});

describe("ccxtExchangeRequiresPassphrase + ccxtExchangeRequiresWallet (full id)", () => {
  it("handles ccxt: prefix correctly", () => {
    expect(ccxtExchangeRequiresPassphrase("ccxt:okx")).toBe(true);
    expect(ccxtExchangeRequiresPassphrase("ccxt:kucoin")).toBe(true);
    expect(ccxtExchangeRequiresWallet("ccxt:hyperliquid")).toBe(true);
  });

  it("returns false for non-CCXT ids", () => {
    expect(ccxtExchangeRequiresPassphrase("okx")).toBe(false); // native, not ccxt:
    expect(ccxtExchangeRequiresWallet("hyperliquid")).toBe(false); // native
  });
});

describe("getCcxtSetupInstructions", () => {
  it("emits env var names with the canonical CCXT_<UPPER>_ pattern", () => {
    const text = getCcxtSetupInstructions("ccxt:bybit");
    expect(text).toContain("CCXT_BYBIT_API_KEY");
    expect(text).toContain("CCXT_BYBIT_API_SECRET");
  });

  it("includes passphrase env when the exchange needs it", () => {
    const text = getCcxtSetupInstructions("ccxt:okx");
    expect(text).toContain("CCXT_OKX_API_KEY");
    expect(text).toContain("CCXT_OKX_API_SECRET");
    expect(text).toContain("CCXT_OKX_PASSPHRASE");
    expect(text).toContain("requires a passphrase");
  });

  it("emits wallet env when the exchange uses wallet auth", () => {
    const text = getCcxtSetupInstructions("ccxt:hyperliquid");
    expect(text).toContain("CCXT_HYPERLIQUID_WALLET_PRIVATE_KEY");
    expect(text).not.toContain("CCXT_HYPERLIQUID_API_KEY");
    expect(text).toContain("wallet-based auth");
  });

  it("annotates sandbox mode", () => {
    const text = getCcxtSetupInstructions("ccxt:bybit", true);
    expect(text).toContain("setSandboxMode(true)");
    expect(text).toContain("--sandbox");
  });

  it("returns empty string for non-ccxt ids", () => {
    expect(getCcxtSetupInstructions("binance")).toBe("");
    expect(getCcxtSetupInstructions("bybit")).toBe("");
  });

  it("normalizes hyphenated sub-ids in env var names", () => {
    const text = getCcxtSetupInstructions("ccxt:crypto_com");
    expect(text).toContain("CCXT_CRYPTO_COM_API_KEY");
  });
});

describe("getCcxtHelpFragment", () => {
  it("lists example ccxt: exchanges + env var pattern", () => {
    const text = getCcxtHelpFragment();
    expect(text).toContain("ccxt:bybit");
    expect(text).toContain("ccxt:kucoin");
    expect(text).toContain("CCXT_<UPPER_SUB_ID>_API_KEY");
  });
});
