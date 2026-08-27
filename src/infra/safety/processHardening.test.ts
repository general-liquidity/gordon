import { describe, test, expect, beforeEach } from "bun:test";
import {
  installProcessHardening,
  resetProcessHardeningForTesting,
  PROCESS_HARDENING_FLAG_ENV,
} from "./processHardening.ts";

describe("installProcessHardening", () => {
  beforeEach(() => {
    resetProcessHardeningForTesting();
  });

  test("runs without throwing on the default (safe subset) path", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(() => installProcessHardening(env)).not.toThrow();
  });

  test("is idempotent", () => {
    expect(() => {
      installProcessHardening({});
      installProcessHardening({});
    }).not.toThrow();
  });

  test("suppresses diagnostic report flags when process.report is present", () => {
    const report = (process as NodeJS.Process & { report?: Record<string, unknown> }).report;
    if (!report) {
      // Runtime without process.report — nothing to assert, guard the test.
      expect(true).toBe(true);
      return;
    }
    installProcessHardening({});
    if ("reportOnFatalError" in report) {
      expect(report.reportOnFatalError).toBe(false);
    }
    if ("reportOnSignal" in report) {
      expect(report.reportOnSignal).toBe(false);
    }
    if ("excludeEnv" in report) {
      expect(report.excludeEnv).toBe(true);
    }
  });

  test("does NOT touch NODE_OPTIONS unless the opt-in flag is set", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_OPTIONS: "--report-on-fatalerror --max-old-space-size=4096",
    };
    installProcessHardening(env);
    expect(env.NODE_OPTIONS).toBe("--report-on-fatalerror --max-old-space-size=4096");
  });

  test("strips --report-* flags from NODE_OPTIONS when opt-in flag is set", () => {
    const env: NodeJS.ProcessEnv = {
      [PROCESS_HARDENING_FLAG_ENV]: "1",
      NODE_OPTIONS: "--report-on-fatalerror --max-old-space-size=4096 --report-on-signal",
    };
    installProcessHardening(env);
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=4096");
  });

  test("deletes NODE_OPTIONS when only --report-* flags remain", () => {
    const env: NodeJS.ProcessEnv = {
      [PROCESS_HARDENING_FLAG_ENV]: "1",
      NODE_OPTIONS: "--report-on-fatalerror",
    };
    installProcessHardening(env);
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  test("does not mutate real env keys", () => {
    const env: NodeJS.ProcessEnv = {
      [PROCESS_HARDENING_FLAG_ENV]: "1",
      BINANCE_API_KEY: "secret-123",
      ANTHROPIC_API_KEY: "sk-ant-456",
    };
    installProcessHardening(env);
    expect(env.BINANCE_API_KEY).toBe("secret-123");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-456");
  });
});
