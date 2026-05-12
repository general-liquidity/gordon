import { describe, expect, it } from "bun:test";
import {
  getResolvedConfigWriteScope,
  mergeConfigRecords,
  normalizeWorkspaceConfigPayload,
} from "./config.ts";

describe("config layering helpers", () => {
  it("deep merges nested objects and replaces arrays", () => {
    const merged = mergeConfigRecords(
      {
        preferences: {
          topNCoins: 50,
          defaultTimeframes: ["1h", "4h"],
        },
        permissionMode: "ask",
      },
      {
        preferences: {
          topNCoins: 20,
          defaultTimeframes: ["15m"],
        },
      },
    );

    expect(merged).toEqual({
      preferences: {
        topNCoins: 20,
        defaultTimeframes: ["15m"],
      },
      permissionMode: "ask",
    });
  });

  it("normalizes legacy workspace payloads with inline overrides", () => {
    const payload = normalizeWorkspaceConfigPayload({
      profile: "swing",
      preferences: {
        topNCoins: 15,
      },
    });

    expect(payload).toEqual({
      profile: "swing",
      overrides: {
        preferences: {
          topNCoins: 15,
        },
      },
    });
  });

  it("normalizes explicit workspace payloads with overrides block", () => {
    const payload = normalizeWorkspaceConfigPayload({
      profile: "intraday",
      overrides: {
        permissionMode: "ask",
      },
    });

    expect(payload).toEqual({
      profile: "intraday",
      overrides: {
        permissionMode: "ask",
      },
    });
  });

  it("writes to the highest-precedence active config layer", () => {
    expect(getResolvedConfigWriteScope({
      activeProfile: null,
      sources: ["global"],
      globalPath: "global.json",
      workspacePath: ".gordonrc",
      profilePath: null,
    })).toBe("global");

    expect(getResolvedConfigWriteScope({
      activeProfile: "swing",
      sources: ["global", "profile"],
      globalPath: "global.json",
      workspacePath: ".gordonrc",
      profilePath: "profiles/swing.json",
    })).toBe("profile");

    expect(getResolvedConfigWriteScope({
      activeProfile: "workspace-profile",
      sources: ["global", "profile", "workspace"],
      globalPath: "global.json",
      workspacePath: ".gordonrc",
      profilePath: "profiles/workspace-profile.json",
    })).toBe("workspace");
  });
});
