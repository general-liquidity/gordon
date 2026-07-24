import { describe, expect, test } from "bun:test";
import {
  DEFAULT_HARNESS_PROFILES,
  getHarnessSuffixForModel,
  isHarnessProfilesEnabled,
  resolveHarnessProfile,
  summarizeHarnessProfile,
  type HarnessProfile,
} from "./harnessProfile.ts";

describe("FW3 — harness profile registry", () => {
  describe("resolveHarnessProfile", () => {
    test("matches anthropic by provider string", () => {
      const profile = resolveHarnessProfile({ provider: "anthropic", model: "claude-sonnet-4-6" } as any);
      expect(profile?.provider).toBe("anthropic");
    });

    test("matches anthropic by claude in model id", () => {
      const profile = resolveHarnessProfile({ provider: "", model: "claude-haiku-4-5" } as any);
      expect(profile?.provider).toBe("anthropic");
    });

    test("matches openai by provider string", () => {
      const profile = resolveHarnessProfile({ provider: "openai", model: "gpt-5" } as any);
      expect(profile?.provider).toBe("openai");
    });

    test("matches google by gemini in model id", () => {
      const profile = resolveHarnessProfile({ provider: "", model: "gemini-2.5-pro" } as any);
      expect(profile?.provider).toBe("google");
    });

    test("matches xai when explicitly tagged", () => {
      const profile = resolveHarnessProfile({ provider: "xai", model: "grok-4.5" } as any);
      expect(profile?.provider).toBe("xai");
    });

    test("matches openai for openai-routed traffic", () => {
      const profile = resolveHarnessProfile({ provider: "openai", model: "anthropic/claude-sonnet" } as any);
      expect(profile?.provider).toBe("openai");
    });

    test("returns undefined for empty config", () => {
      expect(resolveHarnessProfile(undefined)).toBeUndefined();
      expect(resolveHarnessProfile({} as any)).toBeUndefined();
    });

    test("returns undefined for unknown provider", () => {
      expect(resolveHarnessProfile({ provider: "cohere", model: "command" } as any)).toBeUndefined();
    });

    test("accepts string model config", () => {
      const profile = resolveHarnessProfile("claude-opus" as any);
      expect(profile?.provider).toBe("anthropic");
    });

    test("falls back to id field when provider absent", () => {
      const profile = resolveHarnessProfile({ id: "openai/gpt-5" } as any);
      expect(profile?.provider).toBe("openai");
    });

    test("custom profiles override default registry", () => {
      const customProfile: HarnessProfile = {
        provider: "anthropic",
        matchers: ["x-custom"],
        suffix: "test",
        envOverride: "X_CUSTOM",
      };
      const profile = resolveHarnessProfile(
        { provider: "x-custom", model: "any" } as any,
        [customProfile],
      );
      expect(profile?.provider).toBe("anthropic");
    });
  });

  describe("getHarnessSuffixForModel", () => {
    test("returns empty string when no profile matches", () => {
      expect(getHarnessSuffixForModel({ provider: "cohere" } as any, {})).toBe("");
    });

    test("returns empty when matched profile has no env override", () => {
      const result = getHarnessSuffixForModel({ provider: "anthropic" } as any, {});
      expect(result).toBe("");
    });

    test("reads env override at call time", () => {
      const env = { GORDON_HARNESS_ANTHROPIC_SUFFIX: "## Claude-specific tuning\nthink step-by-step" };
      const result = getHarnessSuffixForModel({ provider: "anthropic" } as any, env);
      expect(result).toBe("## Claude-specific tuning\nthink step-by-step");
    });

    test("openai env override fires for openai provider", () => {
      const env = { GORDON_HARNESS_OPENAI_SUFFIX: "openai-tuning" };
      const result = getHarnessSuffixForModel({ provider: "openai" } as any, env);
      expect(result).toBe("openai-tuning");
    });

    test("returns empty string when env value is empty", () => {
      const env = { GORDON_HARNESS_ANTHROPIC_SUFFIX: "" };
      const result = getHarnessSuffixForModel({ provider: "anthropic" } as any, env);
      expect(result).toBe("");
    });
  });

  describe("isHarnessProfilesEnabled", () => {
    test("true for '1'", () => {
      expect(isHarnessProfilesEnabled({ GORDON_HARNESS_PROFILES: "1" })).toBe(true);
    });

    test("true for 'true'", () => {
      expect(isHarnessProfilesEnabled({ GORDON_HARNESS_PROFILES: "true" })).toBe(true);
    });

    test("true for 'yes'", () => {
      expect(isHarnessProfilesEnabled({ GORDON_HARNESS_PROFILES: "yes" })).toBe(true);
    });

    test("false when unset", () => {
      expect(isHarnessProfilesEnabled({})).toBe(false);
    });

    test("false for arbitrary string", () => {
      expect(isHarnessProfilesEnabled({ GORDON_HARNESS_PROFILES: "off" })).toBe(false);
    });

    test("case-insensitive", () => {
      expect(isHarnessProfilesEnabled({ GORDON_HARNESS_PROFILES: "TRUE" })).toBe(true);
    });
  });

  describe("DEFAULT_HARNESS_PROFILES", () => {
    test("contains all four canonical providers", () => {
      const providers = DEFAULT_HARNESS_PROFILES.map((p) => p.provider).sort();
      expect(providers).toEqual(["anthropic", "google", "openai", "xai"]);
    });

    test("all profiles ship with empty suffix", () => {
      for (const profile of DEFAULT_HARNESS_PROFILES) {
        expect(profile.suffix).toBe("");
      }
    });

    test("envOverride matches GORDON_HARNESS_<PROVIDER>_SUFFIX convention", () => {
      for (const profile of DEFAULT_HARNESS_PROFILES) {
        const expected = `GORDON_HARNESS_${profile.provider.toUpperCase()}_SUFFIX`;
        expect(profile.envOverride).toBe(expected);
      }
    });
  });

  describe("summarizeHarnessProfile", () => {
    test("describes 'no match' when undefined", () => {
      expect(summarizeHarnessProfile(undefined)).toBe("no harness profile matched");
    });

    test("describes profile + empty suffix", () => {
      const profile = DEFAULT_HARNESS_PROFILES.find((p) => p.provider === "anthropic")!;
      const summary = summarizeHarnessProfile(profile);
      expect(summary).toContain("anthropic");
      expect(summary).toContain("empty");
    });
  });
});
