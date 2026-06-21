import { describe, expect, test } from "bun:test";

import {
  PERMISSION_PROFILES,
  PERMISSION_PROFILE_CHAIN,
  isSafetyCritical,
  resolveProfileAutoAllowTools,
  resolveProfileScopes,
  type PermissionProfileName,
} from "./profiles.ts";

describe("permission profiles (documentation data table)", () => {
  test("the non-negotiable invariant: no profile auto-allows a safety-critical deny-list tool", () => {
    for (const name of PERMISSION_PROFILE_CHAIN) {
      const autoAllowed = resolveProfileAutoAllowTools(name);
      for (const tool of autoAllowed) {
        expect(
          isSafetyCritical(tool),
          `profile "${name}" auto-allows safety-critical tool "${tool}"`,
        ).toBe(false);
      }
    }
  });

  test("live_trading's venue order / transfer tools match the deny-list", () => {
    // The venue-level order and fund-movement tools must be deny-listed. The
    // `execute_plan` / `cancel` surface tools are confirmation-gated wrappers
    // (rationale-required) that delegate into these — `cancel` itself is not a
    // literal deny-list pattern (the deny-list names `cancel_order`/`cancel_all`),
    // so it is excluded from this match assertion. What matters is the invariant
    // tested above: none of these are ever auto-allowed by any profile.
    const denyListed = PERMISSION_PROFILES.live_trading.alwaysConfirmTools.filter(
      (t) => t !== "execute_plan" && t !== "cancel",
    );
    expect(denyListed.length).toBeGreaterThan(0);
    for (const tool of denyListed) {
      expect(isSafetyCritical(tool), `"${tool}" should match the deny-list`).toBe(true);
    }
  });

  test("execute_plan IS deny-listed; the cancel surface wrapper is confirmation-gated", () => {
    expect(isSafetyCritical("execute_plan")).toBe(true);
    // `cancel` is a rationale-required surface wrapper, not a literal deny-list
    // pattern — documented so the distinction can't silently regress.
    expect(isSafetyCritical("cancel")).toBe(false);
  });

  test("inheritance chain resolves cumulatively: live ⊇ paper ⊇ read_only", () => {
    const readOnly = new Set(resolveProfileScopes("read_only"));
    const paper = new Set(resolveProfileScopes("paper_trading"));
    const live = new Set(resolveProfileScopes("live_trading"));

    for (const s of readOnly) expect(paper.has(s)).toBe(true);
    for (const s of paper) expect(live.has(s)).toBe(true);

    expect(paper.has("papertrade.execute")).toBe(true);
    expect(live.has("livetrade.execute")).toBe(true);
    // read_only must not carry any execution scope.
    expect(readOnly.has("papertrade.execute")).toBe(false);
    expect(readOnly.has("livetrade.execute")).toBe(false);
  });

  test("live_trading adds no auto-allowed tools — it grants scope, not a bypass", () => {
    expect(PERMISSION_PROFILES.live_trading.autoAllowTools).toEqual([]);
  });

  test("profile registry and chain are consistent", () => {
    const chain: PermissionProfileName[] = ["read_only", "paper_trading", "live_trading"];
    expect([...PERMISSION_PROFILE_CHAIN]).toEqual(chain);
    for (const name of chain) {
      expect(PERMISSION_PROFILES[name].name).toBe(name);
    }
    expect(PERMISSION_PROFILES.read_only.inheritsFrom).toBeUndefined();
    expect(PERMISSION_PROFILES.paper_trading.inheritsFrom).toBe("read_only");
    expect(PERMISSION_PROFILES.live_trading.inheritsFrom).toBe("paper_trading");
  });
});
