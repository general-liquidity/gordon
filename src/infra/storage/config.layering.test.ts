import { describe, expect, it } from "bun:test";
import {
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
        mode: "SAFE",
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
      mode: "SAFE",
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
        mode: "SAFE",
      },
    });

    expect(payload).toEqual({
      profile: "intraday",
      overrides: {
        mode: "SAFE",
      },
    });
  });
});
