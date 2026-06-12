import { describe, it, expect, afterEach } from "bun:test";
import { normalizePemSecret, resolveExchangeCredentials } from "./types.ts";

describe("normalizePemSecret", () => {
  it("converts a PEM with literal \\n escapes into a valid multi-line PEM", () => {
    const raw =
      "-----BEGIN EC PRIVATE KEY-----\\nMHcCAQEEIExampleKeyMaterialLine1\\nABCDEFGHIJKLMNOPQRSTUVWXYZabcdef\\nghijkl==\\n-----END EC PRIVATE KEY-----\\n";
    const out = normalizePemSecret(raw);

    expect(out.startsWith("-----BEGIN EC PRIVATE KEY-----")).toBe(true);
    expect(out.includes("\n")).toBe(true);
    expect(out.includes("\\n")).toBe(false);
    const lines = out.split("\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe("-----BEGIN EC PRIVATE KEY-----");
    expect(lines[lines.length - 1]).toBe("-----END EC PRIVATE KEY-----");
    // 1 BEGIN + 3 body + 1 END = 5 non-empty lines
    expect(lines.length).toBe(5);
  });

  it("handles literal \\r\\n escapes", () => {
    const raw =
      "-----BEGIN EC PRIVATE KEY-----\\r\\nBODYLINE\\r\\n-----END EC PRIVATE KEY-----";
    const out = normalizePemSecret(raw);
    expect(out.includes("\\r")).toBe(false);
    expect(out.includes("\\n")).toBe(false);
    expect(out.split("\n").filter((l) => l.length > 0).length).toBe(3);
  });

  it("strips surrounding double quotes around a PEM", () => {
    const raw =
      '"-----BEGIN EC PRIVATE KEY-----\\nBODY\\n-----END EC PRIVATE KEY-----"';
    const out = normalizePemSecret(raw);
    expect(out.startsWith("-----BEGIN")).toBe(true);
    expect(out.endsWith("-----END EC PRIVATE KEY-----")).toBe(true);
  });

  it("strips surrounding single quotes around a PEM", () => {
    const raw =
      "'-----BEGIN EC PRIVATE KEY-----\\nBODY\\n-----END EC PRIVATE KEY-----'";
    const out = normalizePemSecret(raw);
    expect(out.startsWith("-----BEGIN")).toBe(true);
    expect(out.endsWith("-----END EC PRIVATE KEY-----")).toBe(true);
  });

  it("passes a non-PEM HMAC secret through unchanged (no-op)", () => {
    const hmac = "abcDEF123+/=ghijKLMNOpqrstuvWXYZ0123456789==";
    expect(normalizePemSecret(hmac)).toBe(hmac);
  });

  it("does not inject newlines into an HMAC secret that contains a literal \\n run", () => {
    // A base64 HMAC secret will never contain BEGIN/PRIVATE KEY, so the
    // escape-replacement branch must not run.
    const hmac = "notapemkey\\nstillnotapem";
    expect(normalizePemSecret(hmac)).toBe(hmac);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizePemSecret("  hmacsecret  ")).toBe("hmacsecret");
  });
});

describe("resolveExchangeCredentials — passphrase handling", () => {
  const SAVED = {
    key: process.env.COINBASE_API_KEY,
    secret: process.env.COINBASE_API_SECRET,
    pass: process.env.COINBASE_PASSPHRASE,
    okxKey: process.env.OKX_API_KEY,
    okxSecret: process.env.OKX_API_SECRET,
    okxPass: process.env.OKX_PASSPHRASE,
  };

  afterEach(() => {
    const restore = (name: string, v: string | undefined) => {
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    };
    restore("COINBASE_API_KEY", SAVED.key);
    restore("COINBASE_API_SECRET", SAVED.secret);
    restore("COINBASE_PASSPHRASE", SAVED.pass);
    restore("OKX_API_KEY", SAVED.okxKey);
    restore("OKX_API_SECRET", SAVED.okxSecret);
    restore("OKX_PASSPHRASE", SAVED.okxPass);
  });

  it("omits password when no passphrase exists (CDP keys), and normalizes the PEM secret", () => {
    process.env.COINBASE_API_KEY = "organizations/abc/apiKeys/def";
    process.env.COINBASE_API_SECRET =
      "-----BEGIN EC PRIVATE KEY-----\\nBODY\\n-----END EC PRIVATE KEY-----";
    delete process.env.COINBASE_PASSPHRASE;

    const creds = resolveExchangeCredentials({
      type: "ccxt:coinbase",
      apiKey: "***",
      apiSecret: "***",
    });

    expect(creds.passphrase).toBeUndefined();
    expect(creds.apiSecret.startsWith("-----BEGIN")).toBe(true);
    expect(creds.apiSecret.includes("\n")).toBe(true);
    expect(creds.apiSecret.includes("\\n")).toBe(false);
  });

  it("preserves a real passphrase when present (legacy keys, e.g. OKX)", () => {
    process.env.OKX_API_KEY = "okxkey";
    process.env.OKX_API_SECRET = "okxsecret";
    process.env.OKX_PASSPHRASE = "my-passphrase";

    const creds = resolveExchangeCredentials({
      type: "ccxt:okx",
      apiKey: "***",
      apiSecret: "***",
      passphrase: "***",
    });

    expect(creds.passphrase).toBe("my-passphrase");
  });

  it("treats an empty-string passphrase as absent", () => {
    const creds = resolveExchangeCredentials({
      type: "ccxt:coinbase",
      apiKey: "key",
      apiSecret: "plainhmacsecret",
      passphrase: "",
    });
    expect(creds.passphrase).toBeUndefined();
  });

  it("leaves a non-PEM HMAC secret unchanged through resolution", () => {
    const creds = resolveExchangeCredentials({
      type: "ccxt:binance",
      apiKey: "key",
      apiSecret: "plainHmacSecret123",
    });
    expect(creds.apiSecret).toBe("plainHmacSecret123");
  });
});

describe("resolveExchangeCredentials — generic env fallback for long-tail venues", () => {
  const NAMES = ["BYBIT_API_KEY", "BYBIT_API_SECRET", "CCXT_BYBIT_API_KEY", "CCXT_BYBIT_API_SECRET"];
  const SAVED: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const name of NAMES) {
      if (SAVED[name] === undefined) delete process.env[name];
      else process.env[name] = SAVED[name];
    }
  });

  it("falls back to <UPPER>_API_KEY / _API_SECRET for an uncurated venue (bybit)", () => {
    for (const n of NAMES) SAVED[n] = process.env[n];
    delete process.env.CCXT_BYBIT_API_KEY;
    delete process.env.CCXT_BYBIT_API_SECRET;
    process.env.BYBIT_API_KEY = "generic-key";
    process.env.BYBIT_API_SECRET = "generic-secret";

    const creds = resolveExchangeCredentials({
      type: "ccxt:bybit",
      apiKey: "***",
      apiSecret: "***",
    });
    expect(creds.apiKey).toBe("generic-key");
    expect(creds.apiSecret).toBe("generic-secret");
  });

  it("CCXT_<UPPER>_* wins over the generic fallback when both are present", () => {
    for (const n of NAMES) SAVED[n] = process.env[n];
    process.env.CCXT_BYBIT_API_KEY = "ccxt-key";
    process.env.BYBIT_API_KEY = "generic-key";
    process.env.CCXT_BYBIT_API_SECRET = "ccxt-secret";
    process.env.BYBIT_API_SECRET = "generic-secret";

    const creds = resolveExchangeCredentials({
      type: "ccxt:bybit",
      apiKey: "***",
      apiSecret: "***",
    });
    expect(creds.apiKey).toBe("ccxt-key");
    expect(creds.apiSecret).toBe("ccxt-secret");
  });
});
