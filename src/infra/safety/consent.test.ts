import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONSENT_PATH_ENV,
  hasAcceptedLiveConsent,
  recordLiveConsent,
  requireLiveConsent,
} from "./consent.ts";

let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gordon-consent-"));
  env = { [CONSENT_PATH_ENV]: join(dir, "consent.json") };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("live-trading consent gate", () => {
  it("starts un-accepted", () => {
    expect(hasAcceptedLiveConsent(env)).toBe(false);
  });

  it("never gates paper / sandbox execution", () => {
    expect(requireLiveConsent({ sandboxActive: true }, env).ok).toBe(true);
  });

  it("blocks the FIRST live execution before acceptance", () => {
    const check = requireLiveConsent({ sandboxActive: false }, env);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("lose money");
    expect(check.reason).toContain("ARM");
  });

  it("persists acceptance so it shows once, then passes live", () => {
    expect(requireLiveConsent({ sandboxActive: false }, env).ok).toBe(false);

    recordLiveConsent(env);

    expect(hasAcceptedLiveConsent(env)).toBe(true);
    expect(requireLiveConsent({ sandboxActive: false }, env).ok).toBe(true);
    // A fresh read (simulating a new session) still sees the persisted consent.
    expect(hasAcceptedLiveConsent(env)).toBe(true);
  });
});
