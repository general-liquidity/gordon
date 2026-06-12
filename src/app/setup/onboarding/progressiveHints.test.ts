import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HintContext } from "./progressiveHints.ts";

const previousGordonHome = process.env.GORDON_HOME;
const testHome = join(tmpdir(), `gordon-progressive-hints-${process.pid}`);
process.env.GORDON_HOME = testHome;

const versionReset = await import("./versionReset.ts");
const progressiveHints = await import("./progressiveHints.ts");

beforeEach(() => {
  process.env.GORDON_HOME = testHome;
  rmSync(testHome, { recursive: true, force: true });
  mkdirSync(testHome, { recursive: true });
});

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
  if (previousGordonHome === undefined) delete process.env.GORDON_HOME;
  else process.env.GORDON_HOME = previousGordonHome;
});

function context(sessionCount: number): HintContext {
  return {
    sessionCount,
    onboardingComplete: true,
    hasExchange: true,
    hasBroker: true,
    hasGordonMd: true,
    permissionMode: "ask",
  };
}

describe("progressive radar hint", () => {
  test("is ordered after slash commands and before keybindings", () => {
    const ids = progressiveHints.HINTS.map((hint) => hint.id);
    const radar = progressiveHints.HINTS.find((hint) => hint.id === "radar_cards");

    expect(radar?.maxShows).toBe(3);
    expect(ids.indexOf("radar_cards")).toBe(ids.indexOf("slash_commands") + 1);
    expect(ids.indexOf("radar_cards")).toBeLessThan(ids.indexOf("keybindings"));
  });

  test("is eligible only on sessions 2 through 12", () => {
    const radar = progressiveHints.HINTS.find((hint) => hint.id === "radar_cards");

    expect(radar?.condition?.(context(1))).toBe(false);
    expect(radar?.condition?.(context(2))).toBe(true);
    expect(radar?.condition?.(context(12))).toBe(true);
    expect(radar?.condition?.(context(13))).toBe(false);
  });

  test("respects first-eligible ordering and max show count", () => {
    const slashContext = context(2);

    progressiveHints.recordHintShown("permission_mode");
    progressiveHints.recordHintShown("permission_mode");
    progressiveHints.recordHintShown("permission_mode");

    expect(progressiveHints.getNextHint(slashContext)?.id).toBe("slash_commands");
    progressiveHints.recordHintShown("slash_commands");
    progressiveHints.recordHintShown("slash_commands");
    progressiveHints.recordHintShown("slash_commands");

    expect(progressiveHints.getNextHint(slashContext)?.id).toBe("radar_cards");
    progressiveHints.recordHintShown("radar_cards");
    progressiveHints.recordHintShown("radar_cards");
    progressiveHints.recordHintShown("radar_cards");

    expect(progressiveHints.getNextHint(slashContext)?.id).not.toBe("radar_cards");
  });

  test("incrementSessionCount returns the new session count", () => {
    expect(versionReset.incrementSessionCount()).toBe(1);
    expect(versionReset.incrementSessionCount()).toBe(2);
  });
});
