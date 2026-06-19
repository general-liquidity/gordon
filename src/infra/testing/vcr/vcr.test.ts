import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { VcrNoMatchError, VcrSession, withCassette } from "./index.ts";
import { canonicalizeUrl, matchesRequest } from "./cassette.ts";
import { redactBody, redactHeaders, VCR_REDACTED } from "./redaction.ts";

const TMP_DIR = join(process.cwd(), "src", "infra", "testing", "vcr", "__cassettes_test__");

afterEach(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
});

/** A controllable fake fetch standing in for the real network. */
function fakeFetch(
  handler: (url: string, init?: RequestInit) => { body: string; status?: number; headers?: Record<string, string> },
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const r = handler(url, init);
    return new Response(r.body, { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
}

describe("VCR record→replay round-trip", () => {
  it("records with a fake fetch then replays without it", async () => {
    let realCalls = 0;
    const real = fakeFetch((url) => {
      realCalls++;
      return { body: JSON.stringify({ url, ok: true }), status: 200 };
    });

    // RECORD
    const rec = new VcrSession({ name: "roundtrip", mode: "record", cassetteDir: TMP_DIR, realFetch: real });
    const recResp = await rec.fetch("https://api.example.com/v1/price?symbol=BTC");
    expect(await recResp.json()).toEqual({ url: "https://api.example.com/v1/price?symbol=BTC", ok: true });
    rec.save();
    expect(realCalls).toBe(1);
    expect(existsSync(join(TMP_DIR, "roundtrip.json"))).toBe(true);

    // REPLAY — real fetch that throws if hit, proving we don't pass through
    const throwingReal = fakeFetch(() => {
      throw new Error("network hit during replay");
    });
    const play = new VcrSession({ name: "roundtrip", mode: "replay", cassetteDir: TMP_DIR, realFetch: throwingReal });
    const playResp = await play.fetch("https://api.example.com/v1/price?symbol=BTC");
    expect(playResp.status).toBe(200);
    expect(await playResp.json()).toEqual({ url: "https://api.example.com/v1/price?symbol=BTC", ok: true });
    expect(realCalls).toBe(1); // unchanged — replay used no real fetch
  });

  it("auto mode records then replays on second run", async () => {
    const real = fakeFetch(() => ({ body: "hello", status: 200 }));
    const first = new VcrSession({ name: "automode", mode: "auto", cassetteDir: TMP_DIR, realFetch: real });
    expect(first.mode).toBe("record");
    await first.fetch("https://x.test/a");
    first.save();

    const second = new VcrSession({ name: "automode", mode: "auto", cassetteDir: TMP_DIR, realFetch: real });
    expect(second.mode).toBe("replay");
    expect(await (await second.fetch("https://x.test/a")).text()).toBe("hello");
  });
});

describe("matcher ignores volatile fields", () => {
  it("strips ignored query params so timestamp/nonce don't break the match", () => {
    const a = canonicalizeUrl("https://api.test/o?symbol=BTC&timestamp=111&nonce=aaa", ["timestamp", "nonce"]);
    const b = canonicalizeUrl("https://api.test/o?symbol=BTC&timestamp=999&nonce=zzz", ["timestamp", "nonce"]);
    expect(a).toBe(b);
  });

  it("sorts remaining params so ordering is irrelevant", () => {
    const a = canonicalizeUrl("https://api.test/o?b=2&a=1", []);
    const b = canonicalizeUrl("https://api.test/o?a=1&b=2", []);
    expect(a).toBe(b);
  });

  it("default matcher matches across volatile timestamp param at the session level", async () => {
    const real = fakeFetch(() => ({ body: "signed-ok", status: 200 }));
    const rec = new VcrSession({ name: "volatile", mode: "record", cassetteDir: TMP_DIR, realFetch: real });
    await rec.fetch("https://api.test/order?symbol=BTC&timestamp=1000&nonce=abc");
    rec.save();

    const play = new VcrSession({ name: "volatile", mode: "replay", cassetteDir: TMP_DIR });
    // Different timestamp & nonce — still matches because they're in the default ignore set.
    const resp = await play.fetch("https://api.test/order?symbol=BTC&timestamp=2000&nonce=xyz");
    expect(await resp.text()).toBe("signed-ok");
  });

  it("matchesRequest honors body matching toggle", () => {
    const recorded = { method: "POST", url: "https://x/y", headers: {}, body: "a" };
    const live = { method: "POST", url: "https://x/y", headers: {}, body: "b" };
    expect(matchesRequest(recorded, live, { matchBody: true })).toBe(false);
    expect(matchesRequest(recorded, live, { matchBody: false })).toBe(true);
  });
});

describe("secret redaction on record", () => {
  it("strips a planted API key from a recorded body before disk", async () => {
    const PLANTED_KEY = "sk-ant-api03-PLANTEDsecretVALUE1234567890abcdef";
    const ACCOUNT_LOGIN = "MT5-LOGIN-99887766";
    const real = fakeFetch(() => ({
      body: JSON.stringify({ token: PLANTED_KEY, account: ACCOUNT_LOGIN, data: 42 }),
      status: 200,
      headers: { "set-cookie": "session=topsecret" },
    }));

    const rec = new VcrSession({
      name: "redact",
      mode: "record",
      cassetteDir: TMP_DIR,
      realFetch: real,
      plantedSecrets: [ACCOUNT_LOGIN],
    });
    await rec.fetch("https://broker.test/login", {
      method: "POST",
      headers: { authorization: `Bearer ${PLANTED_KEY}`, "x-api-key": PLANTED_KEY },
      body: JSON.stringify({ apiKey: PLANTED_KEY, login: ACCOUNT_LOGIN }),
    });

    const interactions = rec.getInteractions();
    const serialized = JSON.stringify(interactions);

    // The format-detected Anthropic key must be gone everywhere.
    expect(serialized).not.toContain(PLANTED_KEY);
    // The planted (non-format) account login must be gone everywhere.
    expect(serialized).not.toContain(ACCOUNT_LOGIN);
    // Sensitive headers redacted by name (value replaced, key kept).
    const first = interactions[0]!;
    expect(first.request.headers["authorization"]).toBe(VCR_REDACTED);
    expect(first.request.headers["x-api-key"]).toBe(VCR_REDACTED);
    expect(first.response.headers["set-cookie"]).toBe(VCR_REDACTED);

    // And the on-disk cassette is clean too.
    rec.save();
    const onDisk = Bun.file(join(TMP_DIR, "redact.json"));
    const text = await onDisk.text();
    expect(text).not.toContain(PLANTED_KEY);
    expect(text).not.toContain(ACCOUNT_LOGIN);
    expect(text).not.toContain("topsecret");
  });

  it("redactHeaders keeps non-sensitive headers but redacts sensitive ones", () => {
    const out = redactHeaders({
      "content-type": "application/json",
      authorization: "Bearer abc",
      "x-account-id": "12345",
    });
    expect(out["content-type"]).toBe("application/json");
    expect(out["authorization"]).toBe(VCR_REDACTED);
    expect(out["x-account-id"]).toBe(VCR_REDACTED);
  });

  it("redactBody handles undefined and scrubs format-shaped secrets", () => {
    expect(redactBody(undefined)).toBeUndefined();
    const realJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36";
    expect(redactBody(`prefix ${realJwt} suffix`)).not.toContain(realJwt);
  });
});

describe("unmatched replay fails loudly", () => {
  it("throws VcrNoMatchError instead of silently passing through", async () => {
    const real = fakeFetch(() => ({ body: "ok" }));
    const rec = new VcrSession({ name: "nomatch", mode: "record", cassetteDir: TMP_DIR, realFetch: real });
    await rec.fetch("https://api.test/recorded");
    rec.save();

    const play = new VcrSession({ name: "nomatch", mode: "replay", cassetteDir: TMP_DIR });
    await expect(play.fetch("https://api.test/NOT-recorded")).rejects.toBeInstanceOf(VcrNoMatchError);
  });

  it("throws when constructing a replay session with no cassette", () => {
    expect(() => new VcrSession({ name: "ghost", mode: "replay", cassetteDir: TMP_DIR })).toThrow(/cassette not found/);
  });
});

describe("withCassette scoped global install", () => {
  it("swaps globalThis.fetch during fn and always restores it", async () => {
    const sentinel = globalThis.fetch;
    const real = fakeFetch(() => ({ body: "global-ok" }));

    await withCassette({ name: "scoped", mode: "record", cassetteDir: TMP_DIR, realFetch: real }, async () => {
      expect(globalThis.fetch).not.toBe(sentinel);
      const resp = await fetch("https://global.test/x");
      expect(await resp.text()).toBe("global-ok");
    });

    expect(globalThis.fetch).toBe(sentinel);
  });

  it("restores globalThis.fetch even when fn throws", async () => {
    const sentinel = globalThis.fetch;
    const real = fakeFetch(() => ({ body: "x" }));
    await expect(
      withCassette({ name: "throwy", mode: "record", cassetteDir: TMP_DIR, realFetch: real }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(globalThis.fetch).toBe(sentinel);
  });
});
