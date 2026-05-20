import { describe, it, expect } from "bun:test";
import {
  linkGoalToMandate,
  detectMandateDrift,
  mandateLinkToPayload,
  isGoalMandateLinkEnabled,
  GOAL_MANDATE_LINK_FLAG_ENV,
} from "./goalMandateLink.ts";

describe("isGoalMandateLinkEnabled", () => {
  it("respects the flag", () => {
    expect(isGoalMandateLinkEnabled({})).toBe(false);
    expect(isGoalMandateLinkEnabled({ [GOAL_MANDATE_LINK_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("linkGoalToMandate — validation", () => {
  it("rejects empty path", () => {
    expect(() =>
      linkGoalToMandate({ mandateContent: "{}", mandatePath: "" }),
    ).toThrow();
  });

  it("rejects invalid ISO timestamp", () => {
    expect(() =>
      linkGoalToMandate({
        mandateContent: "{}",
        mandatePath: "/x/mandate.json",
        snapshotAt: "not-a-date",
      }),
    ).toThrow();
  });
});

describe("linkGoalToMandate — hashing", () => {
  it("identical content → identical sha256", () => {
    const a = linkGoalToMandate({ mandateContent: "abc", mandatePath: "/x/m.json" });
    const b = linkGoalToMandate({ mandateContent: "abc", mandatePath: "/y/m.json" });
    expect(a.sha256).toBe(b.sha256);
  });

  it("different content → different sha256", () => {
    const a = linkGoalToMandate({ mandateContent: "abc", mandatePath: "/x/m.json" });
    const b = linkGoalToMandate({ mandateContent: "abd", mandatePath: "/x/m.json" });
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("known SHA-256 vector — empty string → standard digest", () => {
    const r = linkGoalToMandate({ mandateContent: "", mandatePath: "/x/m.json" });
    // SHA-256("") canonical = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(r.sha256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(r.byteLength).toBe(0);
  });

  it("byte length matches UTF-8 byte count", () => {
    const r = linkGoalToMandate({ mandateContent: "héllo", mandatePath: "/x/m.json" });
    // 'h' 'é' (2 bytes) 'l' 'l' 'o' = 6 bytes
    expect(r.byteLength).toBe(6);
  });
});

describe("linkGoalToMandate — defaults", () => {
  it("snapshotAt defaults to now (parses as a valid ISO)", () => {
    const r = linkGoalToMandate({ mandateContent: "{}", mandatePath: "/x/m.json" });
    expect(Number.isNaN(Date.parse(r.snapshotAt))).toBe(false);
  });

  it("explicit snapshotAt is preserved", () => {
    const ts = "2026-01-01T00:00:00.000Z";
    const r = linkGoalToMandate({
      mandateContent: "{}",
      mandatePath: "/x/m.json",
      snapshotAt: ts,
    });
    expect(r.snapshotAt).toBe(ts);
  });
});

describe("detectMandateDrift", () => {
  function mkLink(path: string, sha: string) {
    return { path, sha256: sha, snapshotAt: "2026-01-01T00:00:00.000Z", byteLength: 0 };
  }

  it("identical link → no drift", () => {
    const a = mkLink("/x/m.json", "aa");
    const r = detectMandateDrift(a, a);
    expect(r.drifted).toBe(false);
    expect(r.pathMatches).toBe(true);
    expect(r.contentMatches).toBe(true);
  });

  it("content differs → drift detected", () => {
    const a = mkLink("/x/m.json", "aa");
    const b = mkLink("/x/m.json", "bb");
    const r = detectMandateDrift(a, b);
    expect(r.drifted).toBe(true);
    expect(r.contentMatches).toBe(false);
  });

  it("path differs → drift detected", () => {
    const a = mkLink("/x/m.json", "aa");
    const b = mkLink("/y/m.json", "aa");
    const r = detectMandateDrift(a, b);
    expect(r.drifted).toBe(true);
    expect(r.pathMatches).toBe(false);
  });
});

describe("mandateLinkToPayload", () => {
  it("emits stable shape", () => {
    const r = linkGoalToMandate({ mandateContent: "abc", mandatePath: "/x/m.json" });
    const p = mandateLinkToPayload(r) as { kind: string; path: string; sha256: string };
    expect(p.kind).toBe("goal_mandate_link.computed");
    expect(p.path).toBe("/x/m.json");
    expect(p.sha256).toBe(r.sha256);
  });
});
