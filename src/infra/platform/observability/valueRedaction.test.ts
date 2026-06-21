import { describe, expect, test } from "bun:test";
import {
  redactDeep,
  redactString,
  redactValues,
  REDACTION_PLACEHOLDER,
} from "./valueRedaction.ts";

describe("redactValues — Anthropic API keys", () => {
  test("redacts sk-ant-api01 prefix", () => {
    const result = redactValues(
      "the key is sk-ant-api01-aaaaaaaaaaaaaaaaaaaaaaaa and that's it",
    );
    expect(result.text).toContain(REDACTION_PLACEHOLDER);
    expect(result.text).not.toContain("aaaaaaaaaaaa");
    expect(result.matched).toContain("anthropic_api_key");
    expect(result.redactionCount).toBe(1);
  });

  test("redacts multiple Anthropic keys", () => {
    const result = redactValues(
      "key1=sk-ant-api01-bbbbbbbbbbbbbbbbbbbb key2=sk-ant-api02-cccccccccccccccccccc",
    );
    expect(result.redactionCount).toBe(2);
  });
});

describe("redactValues — OpenAI keys", () => {
  test("redacts sk- prefix", () => {
    const result = redactValues("openai key: sk-aaaaaaaaaaaaaaaaaaaa more text");
    expect(result.text).toContain(REDACTION_PLACEHOLDER);
    expect(result.matched).toContain("openai_api_key");
  });

  test("redacts project-scoped sk-proj- prefix", () => {
    const result = redactValues("openai project: sk-proj-bbbbbbbbbbbbbbbbbbbb after");
    expect(result.matched).toContain("openai_api_key");
  });
});

describe("redactValues — GitHub tokens", () => {
  test("redacts ghp_ personal token", () => {
    const result = redactValues("github: ghp_aaaaaaaaaaaaaaaaaaaaaa more");
    expect(result.matched).toContain("github_token");
  });

  test("redacts gho_ oauth token", () => {
    const result = redactValues("oauth: gho_bbbbbbbbbbbbbbbbbbbbbb tail");
    expect(result.matched).toContain("github_token");
  });

  test("redacts ghs_ server token", () => {
    const result = redactValues("server: ghs_cccccccccccccccccccccc");
    expect(result.matched).toContain("github_token");
  });
});

describe("redactValues — AWS", () => {
  test("redacts AKIA access key ID", () => {
    const result = redactValues("AKIAIOSFODNN7EXAMPLE in the logs");
    expect(result.matched).toContain("aws_access_key_id");
  });

  test("redacts ASIA temporary key ID", () => {
    const result = redactValues("ASIAIOSFODNN7EXAMPLE");
    expect(result.matched).toContain("aws_access_key_id");
  });

  test("aws_secret_access_key only matches with prefix", () => {
    // 40-char base64-ish without prefix should NOT be redacted as AWS
    // secret (too ambiguous — would false-positive on hashes).
    const result = redactValues(
      "random 40-char string: abcd1234abcd1234abcd1234abcd1234abcd1234",
    );
    expect(result.matched).not.toContain("aws_secret_access_key");
  });

  test("aws_secret_access_key matches when prefixed", () => {
    const result = redactValues(
      "aws_secret_access_key=abcd1234abcd1234abcd1234abcd1234abcd1234",
    );
    expect(result.matched).toContain("aws_secret_access_key");
    // The secret value should be replaced, but the key-name preserved.
    expect(result.text).toContain("aws_secret_access_key=");
    expect(result.text).toContain(REDACTION_PLACEHOLDER);
    expect(result.text).not.toContain("abcd1234abcd1234");
  });
});

describe("redactValues — Slack tokens", () => {
  test("redacts xoxb bot token", () => {
    const result = redactValues("slack: xoxb-1234567890-abcdef");
    expect(result.matched).toContain("slack_token");
  });

  test("redacts xoxp user token", () => {
    const result = redactValues("xoxp-aaaaaaaaaa");
    expect(result.matched).toContain("slack_token");
  });
});

describe("redactValues — JWTs", () => {
  test("redacts a three-segment JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const result = redactValues(`token: ${jwt} done`);
    expect(result.matched).toContain("jwt");
    expect(result.text).not.toContain("eyJhbGciOi");
  });
});

describe("redactValues — Bearer header", () => {
  test("redacts Bearer value, preserves prefix", () => {
    const result = redactValues(
      "Authorization: Bearer abcdef1234567890.token-value here",
    );
    expect(result.matched).toContain("bearer_token");
    // Operator should still see "Authorization: Bearer ..." surface,
    // just without the actual token.
    expect(result.text.toLowerCase()).toContain("authorization");
    expect(result.text.toLowerCase()).toContain("bearer");
    expect(result.text).toContain(REDACTION_PLACEHOLDER);
    expect(result.text).not.toContain("abcdef1234567890");
  });

  test("case-insensitive Authorization match", () => {
    const result = redactValues("authorization: bearer abcdef1234567890token");
    expect(result.matched).toContain("bearer_token");
  });
});

describe("redactValues — PEM private keys", () => {
  test("redacts RSA private key block", () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----\nMIIEpQIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----`;
    const result = redactValues(`config:\n${pem}\nend`);
    expect(result.matched).toContain("private_key_block");
    expect(result.text).not.toContain("MIIEpQIBAAKCAQEA");
  });

  test("redacts OPENSSH key block", () => {
    const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXkt...\n-----END OPENSSH PRIVATE KEY-----`;
    const result = redactValues(pem);
    expect(result.matched).toContain("private_key_block");
  });

  test("redacts generic PRIVATE KEY block", () => {
    const pem = `-----BEGIN PRIVATE KEY-----\nfoo\n-----END PRIVATE KEY-----`;
    const result = redactValues(pem);
    expect(result.matched).toContain("private_key_block");
  });
});

describe("redactValues — launch-hardening patterns", () => {
  test("redacts a scoped 64-hex api key", () => {
    const hex = "a".repeat(64);
    const result = redactValues(`api_key=${hex}`);
    expect(result.matched.length).toBeGreaterThan(0);
    expect(result.text).not.toContain(hex);
    expect(result.text).toContain(REDACTION_PLACEHOLDER);
  });

  test("redacts a long high-entropy token (40 chars)", () => {
    const token = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0";
    const result = redactValues(`opaque session ${token} end`);
    expect(result.text).not.toContain(token);
    expect(result.text).toContain(REDACTION_PLACEHOLDER);
  });

  test("redacts a scoped account number", () => {
    const result = redactValues("account=ABC123XYZ extra");
    expect(result.matched).toContain("account_number");
    expect(result.text).not.toContain("ABC123XYZ");
    expect(result.text).toContain("account=");
  });

  test("does NOT redact prices / quantities", () => {
    const result = redactValues("price=64250.50 qty=0.5 size=12");
    expect(result.text).toBe("price=64250.50 qty=0.5 size=12");
    expect(result.redactionCount).toBe(0);
  });

  test("does NOT redact a short order id or symbol", () => {
    const result = redactValues("symbol=BTCUSDT side=BUY ts=1718900000");
    expect(result.text).toBe("symbol=BTCUSDT side=BUY ts=1718900000");
    expect(result.redactionCount).toBe(0);
  });
});

describe("redactValues — clean input", () => {
  test("returns text unchanged when no patterns match", () => {
    const text = "BTC price moved from 60000 to 62500 today, +4.2%";
    const result = redactValues(text);
    expect(result.text).toBe(text);
    expect(result.matched).toEqual([]);
    expect(result.redactionCount).toBe(0);
  });

  test("handles empty string", () => {
    const result = redactValues("");
    expect(result.text).toBe("");
    expect(result.matched).toEqual([]);
  });

  test("idempotent on already-redacted output", () => {
    const first = redactValues("token: sk-aaaaaaaaaaaaaaaaaaaa");
    const second = redactValues(first.text);
    expect(second.text).toBe(first.text);
    expect(second.matched).toEqual([]);
  });
});

describe("redactString convenience", () => {
  test("returns just the text", () => {
    expect(redactString("clean text")).toBe("clean text");
    expect(redactString("ghp_aaaaaaaaaaaaaaaaaaaaaa")).toContain(REDACTION_PLACEHOLDER);
  });
});

describe("redactDeep — structured values", () => {
  test("redacts string leaves in flat object", () => {
    const result = redactDeep({
      url: "https://api.example.com",
      token: "sk-aaaaaaaaaaaaaaaaaaaa",
    });
    expect(result).toEqual({
      url: "https://api.example.com",
      token: REDACTION_PLACEHOLDER,
    });
  });

  test("recurses into nested objects", () => {
    const result = redactDeep({
      inner: { creds: { key: "ghp_bbbbbbbbbbbbbbbbbbbbbb" } },
    }) as { inner: { creds: { key: string } } };
    expect(result.inner.creds.key).toBe(REDACTION_PLACEHOLDER);
  });

  test("recurses into arrays", () => {
    const result = redactDeep(["clean", "sk-ant-api01-aaaaaaaaaaaaaaaaaaaaaaaa"]) as string[];
    expect(result[0]).toBe("clean");
    expect(result[1]).toBe(REDACTION_PLACEHOLDER);
  });

  test("preserves non-string leaves", () => {
    const result = redactDeep({ count: 42, active: true, ts: null }) as Record<string, unknown>;
    expect(result).toEqual({ count: 42, active: true, ts: null });
  });

  test("cycle-safe", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(() => redactDeep(obj)).not.toThrow();
  });

  test("depth-bounded", () => {
    // Build deeply nested structure
    let nested: Record<string, unknown> = { token: "ghp_aaaaaaaaaaaaaaaaaaaaaa" };
    for (let i = 0; i < 20; i++) {
      nested = { inner: nested };
    }
    expect(() => redactDeep(nested)).not.toThrow();
  });
});
