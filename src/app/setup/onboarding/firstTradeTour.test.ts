import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previousGordonHome = process.env.GORDON_HOME;
const testHome = join(tmpdir(), `gordon-first-trade-tour-${process.pid}`);
process.env.GORDON_HOME = testHome;

const versionReset = await import("./versionReset.ts");
const firstTradeTour = await import("./firstTradeTour.ts");

const stateFile = join(testHome, "onboarding-state.json");

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

describe("firstTradeTour", () => {
  test("shows only when setup is hidden and the tour is not done", () => {
    const fresh = versionReset.loadOnboardingState();

    expect(firstTradeTour.shouldShowFirstTradeTour(fresh, false)).toBe(true);
    expect(firstTradeTour.shouldShowFirstTradeTour(fresh, true)).toBe(false);
    expect(
      firstTradeTour.shouldShowFirstTradeTour({ ...fresh, firstTradeTourDone: true }, false),
    ).toBe(false);
  });

  test("markFirstTradeTourDone persists and round-trips", () => {
    firstTradeTour.markFirstTradeTourDone();

    expect(versionReset.loadOnboardingState().firstTradeTourDone).toBe(true);
    expect(JSON.parse(readFileSync(stateFile, "utf-8")).firstTradeTourDone).toBe(true);
  });

  test("legacy state files default the tour flag to false", () => {
    writeFileSync(stateFile, JSON.stringify({ completedOnce: true, hintShowCounts: {} }), "utf-8");

    expect(versionReset.loadOnboardingState().firstTradeTourDone).toBe(false);
  });

  test("incrementSessionCount returns the persisted count", () => {
    expect(versionReset.incrementSessionCount()).toBe(1);
    expect(versionReset.incrementSessionCount()).toBe(2);
    expect(versionReset.loadOnboardingState().sessionCount).toBe(2);
    expect(existsSync(stateFile)).toBe(true);
  });
});
