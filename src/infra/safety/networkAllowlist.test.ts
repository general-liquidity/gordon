import { describe, it, expect, beforeEach } from "bun:test";

import {
  isNetworkAllowlistEnabled,
  getAllowlistMode,
  checkOutbound,
  enforceOutbound,
  addAllowedHost,
  listAllowedHosts,
  resetAllowlistForTesting,
  resultToPayload,
  BlockedOutboundError,
  GORDON_DEFAULT_ALLOWLIST,
  NETWORK_ALLOWLIST_FLAG_ENV,
  NETWORK_ALLOWLIST_MODE_ENV,
} from "./networkAllowlist.ts";

beforeEach(() => {
  resetAllowlistForTesting();
});

describe("isNetworkAllowlistEnabled", () => {
  it("defaults on and supports explicit disable", () => {
    expect(isNetworkAllowlistEnabled({})).toBe(true);
    expect(isNetworkAllowlistEnabled({ [NETWORK_ALLOWLIST_FLAG_ENV]: "1" })).toBe(true);
    expect(isNetworkAllowlistEnabled({ [NETWORK_ALLOWLIST_FLAG_ENV]: "true" })).toBe(true);
    expect(isNetworkAllowlistEnabled({ [NETWORK_ALLOWLIST_FLAG_ENV]: "0" })).toBe(false);
    expect(isNetworkAllowlistEnabled({ [NETWORK_ALLOWLIST_FLAG_ENV]: "false" })).toBe(false);
  });
});

describe("getAllowlistMode", () => {
  it("defaults to warn", () => {
    expect(getAllowlistMode({})).toBe("warn");
  });
  it("respects 'block' override", () => {
    expect(getAllowlistMode({ [NETWORK_ALLOWLIST_MODE_ENV]: "block" })).toBe("block");
  });
  it("falls back to warn for unknown values", () => {
    expect(getAllowlistMode({ [NETWORK_ALLOWLIST_MODE_ENV]: "asdf" })).toBe("warn");
  });
});

describe("GORDON_DEFAULT_ALLOWLIST", () => {
  it("includes the major venues", () => {
    const patterns = GORDON_DEFAULT_ALLOWLIST.map((r) => r.hostPattern);
    expect(patterns).toContain("api.anthropic.com");
    expect(patterns.some((p) => p.includes("binance"))).toBe(true);
    expect(patterns.some((p) => p.includes("coinbase"))).toBe(true);
  });
});

describe("checkOutbound — exact match", () => {
  it("allows api.anthropic.com", () => {
    const r = checkOutbound({ url: "https://api.anthropic.com/v1/messages" });
    expect(r.allowed).toBe(true);
    expect(r.host).toBe("api.anthropic.com");
  });

  it("does not match a different host", () => {
    const r = checkOutbound({ url: "https://evil.example.com/exfil" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("not on allowlist");
  });
});

describe("checkOutbound — wildcard match", () => {
  it("matches subdomains via *.binance.com", () => {
    const r = checkOutbound({ url: "https://api.binance.com/api/v3/klines" });
    expect(r.allowed).toBe(true);
    expect(r.host).toBe("api.binance.com");
  });

  it("matches deeper subdomains", () => {
    const r = checkOutbound({ url: "https://fapi.binance.com/fapi/v1/exchangeInfo" });
    expect(r.allowed).toBe(true);
  });

  it("does NOT match the bare suffix as a sibling", () => {
    // *.binance.com should not match "evilbinance.com"
    const r = checkOutbound({ url: "https://evilbinance.com/" });
    expect(r.allowed).toBe(false);
  });
});

describe("checkOutbound — malformed URL", () => {
  it("rejects URLs without a parseable host", () => {
    const r = checkOutbound({ url: "not-a-url" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("malformed");
  });
});

describe("addAllowedHost", () => {
  it("adds a runtime host that subsequent checks accept", () => {
    const before = checkOutbound({ url: "https://my-corp-broker.internal/orders" });
    expect(before.allowed).toBe(false);
    addAllowedHost({ hostPattern: "my-corp-broker.internal", reason: "private broker" });
    const after = checkOutbound({ url: "https://my-corp-broker.internal/orders" });
    expect(after.allowed).toBe(true);
  });
});

describe("listAllowedHosts", () => {
  it("returns the canonical list", () => {
    const list = listAllowedHosts();
    expect(list.length).toBe(GORDON_DEFAULT_ALLOWLIST.length);
  });

  it("reflects additions", () => {
    addAllowedHost({ hostPattern: "x.example", reason: "test" });
    const list = listAllowedHosts();
    expect(list.some((r) => r.hostPattern === "x.example")).toBe(true);
  });
});

describe("enforceOutbound — block mode", () => {
  it("throws BlockedOutboundError on a miss", () => {
    expect(() =>
      enforceOutbound({ url: "https://evil.example.com" }, { mode: "block" }),
    ).toThrow(BlockedOutboundError);
  });

  it("returns the result on an allowed URL", () => {
    const r = enforceOutbound(
      { url: "https://api.anthropic.com/v1/messages" },
      { mode: "block" },
    );
    expect(r.allowed).toBe(true);
  });
});

describe("enforceOutbound — warn mode", () => {
  it("does NOT throw on a miss", () => {
    const r = enforceOutbound(
      { url: "https://evil.example.com" },
      { mode: "warn" },
    );
    expect(r.allowed).toBe(false);
    expect(r.mode).toBe("warn");
  });
});

describe("custom rules option", () => {
  it("checkOutbound honors caller-supplied rules", () => {
    const r = checkOutbound(
      { url: "https://only-this.example/foo" },
      { rules: [{ hostPattern: "only-this.example" }] },
    );
    expect(r.allowed).toBe(true);
  });
});

describe("resultToPayload", () => {
  it("emits stable shape on a hit", () => {
    const r = checkOutbound({ url: "https://api.anthropic.com/v1/messages", caller: "executor" });
    const p = resultToPayload(r, "executor");
    expect(p.kind).toBe("network_allowlist.check_recorded");
    expect(p.allowed).toBe(true);
    expect(p.caller).toBe("executor");
  });

  it("emits stable shape on a miss", () => {
    const r = checkOutbound({ url: "https://evil.example.com" });
    const p = resultToPayload(r);
    expect(p.allowed).toBe(false);
    expect(p.reason).toContain("allowlist");
  });
});

describe("Exfiltration scenario — pastebin.com", () => {
  it("blocks an outbound to pastebin.com under block mode", () => {
    expect(() =>
      enforceOutbound(
        { url: "https://pastebin.com/raw/abc123", caller: "compromised-tool" },
        { mode: "block" },
      ),
    ).toThrow(BlockedOutboundError);
  });
});

describe("Launch-hardening: Dedalus primary host + typo guard", () => {
  it("allows the primary Dedalus router host api.dedaluslabs.ai", () => {
    const r = checkOutbound({ url: "https://api.dedaluslabs.ai/v1/chat/completions" });
    expect(r.allowed).toBe(true);
    expect(r.host).toBe("api.dedaluslabs.ai");
  });

  it("allows a real exchange host api.binance.com", () => {
    const r = checkOutbound({ url: "https://api.binance.com/api/v3/ping" });
    expect(r.allowed).toBe(true);
  });

  it("blocks the old typo host api.dedalus.ai", () => {
    const r = checkOutbound({ url: "https://api.dedalus.ai/v1/chat/completions" });
    expect(r.allowed).toBe(false);
    expect(() =>
      enforceOutbound({ url: "https://api.dedalus.ai/v1/chat/completions" }, { mode: "block" }),
    ).toThrow(BlockedOutboundError);
  });

  it("blocks pastebin.com", () => {
    const r = checkOutbound({ url: "https://pastebin.com/raw/xyz" });
    expect(r.allowed).toBe(false);
  });
});
