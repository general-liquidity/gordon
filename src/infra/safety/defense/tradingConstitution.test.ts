import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkConstitution,
  passesConstitution,
  recordConstitutionHalt,
  activeConstitutionHalt,
  resetConstitutionHalt,
  reloadConstitutionHaltState,
  CONSTITUTION_HALT_PATH_ENV,
} from "./tradingConstitution.ts";

const tempDir = mkdtempSync(join(tmpdir(), "gordon-halt-"));
const haltFile = join(tempDir, "constitution-halt.json");

function cleanParams() {
  return {
    positionSizePct: 2,
    riskPerTradePct: 1,
    currentDrawdownPct: 0,
    dailyLossPct: 0,
    openPositionCount: 1,
    tradesThisHour: 0,
    tradesThisDay: 0,
    consecutiveLosses: 0,
    hasStopLoss: true,
  };
}

beforeEach(() => {
  process.env[CONSTITUTION_HALT_PATH_ENV] = haltFile;
  rmSync(haltFile, { force: true });
  reloadConstitutionHaltState();
});

afterEach(() => {
  rmSync(haltFile, { force: true });
  delete process.env[CONSTITUTION_HALT_PATH_ENV];
  // With no path env under bun test, persistence is off → clears halt state.
  reloadConstitutionHaltState();
});

describe("constitution halt recording", () => {
  it("blocks on the calibrated 50th daily trade, not the 49th", () => {
    expect(passesConstitution({ ...cleanParams(), tradesThisDay: 49 }).passes).toBe(true);

    const atLimit = passesConstitution({ ...cleanParams(), tradesThisDay: 50 });
    expect(atLimit.passes).toBe(false);
    expect(atLimit.violations).toContainEqual(
      expect.objectContaining({ rule: "MAX_TRADES_PER_DAY", limit: 50, actual: 50 }),
    );
  });

  it("ignores warning/block severities", () => {
    recordConstitutionHalt({
      rule: "MAX_POSITION_SIZE_PCT",
      limit: 5,
      actual: 6,
      severity: "warning",
      message: "warn",
    });
    recordConstitutionHalt({
      rule: "MAX_RISK_PER_TRADE_PCT",
      limit: 2,
      actual: 3,
      severity: "block",
      message: "block",
    });
    expect(activeConstitutionHalt()).toBeNull();
    expect(existsSync(haltFile)).toBe(false);
  });

  it("passesConstitution trips and persists a halt on halt-severity violations", () => {
    const result = passesConstitution({ ...cleanParams(), dailyLossPct: 3 });
    expect(result.passes).toBe(false);
    expect(result.worstSeverity).toBe("halt");

    const halt = activeConstitutionHalt();
    expect(halt).not.toBeNull();
    expect(halt!.rule).toBe("MAX_DAILY_LOSS_PCT");
    expect(existsSync(haltFile)).toBe(true);
  });

  it("emergency-severity violations also trip the halt", () => {
    passesConstitution({ ...cleanParams(), currentDrawdownPct: 16 });
    expect(activeConstitutionHalt()!.rule).toBe("EMERGENCY_LIQUIDATION_PCT");
  });
});

describe("halt persistence across restart", () => {
  it("a recorded halt survives a simulated restart and gates clean trades", () => {
    passesConstitution({ ...cleanParams(), dailyLossPct: 3 });

    // Simulated restart: reload state from disk.
    reloadConstitutionHaltState();

    const halt = activeConstitutionHalt();
    expect(halt).not.toBeNull();
    expect(halt!.rule).toBe("MAX_DAILY_LOSS_PCT");

    // A perfectly clean trade is still blocked — no auto-resume.
    const violations = checkConstitution(cleanParams());
    expect(violations.some((v) => v.rule === "HALT_REQUIRES_MANUAL_RESET")).toBe(true);
    expect(passesConstitution(cleanParams()).passes).toBe(false);
  });

  it("fails closed when the halt file is unreadable", () => {
    writeFileSync(haltFile, "{ not valid json");
    reloadConstitutionHaltState();
    const halt = activeConstitutionHalt();
    expect(halt).not.toBeNull();
    expect(halt!.rule).toBe("HALT_STATE_UNREADABLE");
  });
});

describe("halt reset", () => {
  it("requires a rationale of at least 10 characters", () => {
    passesConstitution({ ...cleanParams(), dailyLossPct: 3 });

    const refused = resetConstitutionHalt("short");
    expect(refused.ok).toBe(false);
    expect(activeConstitutionHalt()).not.toBeNull();

    // Still halted after restart, too.
    reloadConstitutionHaltState();
    expect(activeConstitutionHalt()).not.toBeNull();
  });

  it("clears the halt with a valid rationale and records it on disk", () => {
    passesConstitution({ ...cleanParams(), dailyLossPct: 3 });

    const result = resetConstitutionHalt("Daily loss reviewed with operator; resuming.");
    expect(result.ok).toBe(true);
    expect(activeConstitutionHalt()).toBeNull();

    const persisted = JSON.parse(readFileSync(haltFile, "utf8")) as {
      halt: unknown;
      lastReset?: { rule: string; rationale: string };
    };
    expect(persisted.halt).toBeNull();
    expect(persisted.lastReset!.rule).toBe("MAX_DAILY_LOSS_PCT");
    expect(persisted.lastReset!.rationale).toContain("Daily loss reviewed");

    // Clears after restart as well, and clean trades pass again.
    reloadConstitutionHaltState();
    expect(activeConstitutionHalt()).toBeNull();
    expect(passesConstitution(cleanParams()).passes).toBe(true);
  });
});
