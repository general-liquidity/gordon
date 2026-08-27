import { describe, expect, test } from "bun:test";
import {
  formatAge,
  renderBootStaticRows,
  visibleLength,
  type BootStaticInfo,
} from "./bootComposition.ts";

const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (value: string) => value.replace(ANSI, "");

function fixture(overrides: Partial<BootStaticInfo> = {}): BootStaticInfo {
  return {
    version: "0.9.0",
    model: "claude-sonnet-4-6",
    effort: "high",
    permissionMode: "ask",
    threadDisplay: "thr_01HZXK24M9QW",
    cwd: "/very/long/path/to/gordon-cli-alpha",
    fetchGuard: {
      installed: true,
      enabled: true,
      mode: "warn",
      warnViolations: 0,
      recentViolations: [],
    },
    fsGuard: {
      installed: true,
      enabled: true,
      mode: "warn",
      warnViolations: 0,
      recentViolations: [],
    },
    trippedSwitches: [],
    radar: { running: true, producerCount: 21, lastCardAgeMs: 4 * 60 * 1000 },
    ...overrides,
  };
}

describe("renderBootStaticRows", () => {
  test("wraps the rows in a bordered box titled session", () => {
    const rows = renderBootStaticRows(fixture(), 100);
    expect(rows).toHaveLength(9); // top border + 7 rows + bottom border
    expect(stripAnsi(rows[0]!)).toMatch(/^┌─ session ─+┐$/);
    expect(stripAnsi(rows[8]!)).toMatch(/^└─+┘$/);
    for (const row of rows.slice(1, 8)) {
      expect(stripAnsi(row)).toMatch(/^│.*│$/);
    }
    // Box edges align: every line has the same visible width.
    const widths = new Set(rows.map(visibleLength));
    expect(widths.size).toBe(1);
  });

  test("renders padded labels and wide-mode hints", () => {
    const rows = renderBootStaticRows(fixture(), 100);
    expect(stripAnsi(rows[1]!)).toContain("  model     claude-sonnet-4-6 high");
    expect(stripAnsi(rows[1]!)).toContain("/model to change");
    expect(stripAnsi(rows[2]!)).toContain("  mode      ask");
    expect(stripAnsi(rows[2]!)).toContain("/auto to change");
  });

  test("drops hints at narrow widths before truncating values", () => {
    const rows = renderBootStaticRows(fixture(), 65);
    expect(stripAnsi(rows[1]!)).not.toContain("/model to change");
    expect(stripAnsi(rows[2]!)).not.toContain("/auto to change");
    expect(visibleLength(rows[1]!)).toBeLessThanOrEqual(64);
  });

  test("renders paper mode with loud badge and live-exit hint", () => {
    const rows = renderBootStaticRows(fixture({ permissionMode: "paper" }), 100);
    expect(rows.join("\n")).toContain("\x1b[1m\x1b[33m[PAPER]");
    expect(stripAnsi(rows[2]!)).toContain("paper [PAPER]");
    expect(stripAnsi(rows[2]!)).toContain("/live to exit");
  });

  test("renders firm and scoped kill-switch summaries", () => {
    const firm = renderBootStaticRows(
      fixture({
        trippedSwitches: [{ key: { scope: "firm" }, reason: "test halt rationale", trippedAt: 1 }],
      }),
      100,
    );
    expect(stripAnsi(firm[6]!)).toContain("HALTED: firm — test halt rationale");

    const scoped = renderBootStaticRows(
      fixture({
        trippedSwitches: [
          { key: { scope: "venue", id: "binance" }, reason: "venue offline", trippedAt: 1 },
          { key: { scope: "strategy", id: "s1" }, reason: "bad fills", trippedAt: 2 },
        ],
      }),
      100,
    );
    expect(stripAnsi(scoped[6]!)).toContain("tripped: venue:binance, strategy:s1");
  });

  test("renders guard failure states", () => {
    const rows = renderBootStaticRows(
      fixture({
        fetchGuard: {
          installed: false,
          enabled: true,
          mode: "warn",
          warnViolations: 0,
          recentViolations: [],
        },
        fsGuard: {
          installed: true,
          enabled: false,
          mode: "warn",
          warnViolations: 0,
          recentViolations: [],
        },
      }),
      100,
    );
    const guardRow = stripAnsi(rows[5]!);
    expect(guardRow).toContain("fetch ✗ NOT INSTALLED");
    expect(guardRow).toContain("fs ✗ off");
  });

  test("renders radar off, warming, and aged variants", () => {
    expect(
      stripAnsi(
        renderBootStaticRows(
          fixture({
            radar: { running: false, producerCount: 0, lastCardAgeMs: null },
          }),
          120,
        )[7]!,
      ),
    ).toContain("off — set GORDON_PROACTIVE_AUTO_START=1 or /radar start");
    expect(
      stripAnsi(
        renderBootStaticRows(
          fixture({
            radar: { running: true, producerCount: 21, lastCardAgeMs: null },
          }),
          100,
        )[7]!,
      ),
    ).toContain("21 producers · warming up");
    expect(
      stripAnsi(
        renderBootStaticRows(
          fixture({
            radar: { running: true, producerCount: 21, lastCardAgeMs: 2 * 60 * 60 * 1000 },
          }),
          100,
        )[7]!,
      ),
    ).toContain("21 producers · last card 2h ago");
  });

  test("keeps every output row within the terminal budget", () => {
    const info = fixture({
      model: "claude-sonnet-4-6-with-a-very-long-suffix",
      cwd: "/this/is/a/very/long/path/that/should/be/left/truncated/for/the/static/boot/panel",
      trippedSwitches: [
        {
          key: { scope: "firm" },
          reason: "a very long halt rationale that must not overflow the terminal",
          trippedAt: 1,
        },
      ],
      radar: { running: false, producerCount: 0, lastCardAgeMs: null },
    });
    for (const width of [50, 60, 80, 120]) {
      for (const row of renderBootStaticRows(info, width)) {
        expect(visibleLength(row)).toBeLessThanOrEqual(width - 1);
      }
    }
  });
});

describe("formatAge", () => {
  test("formats second, minute, hour, and day boundaries", () => {
    expect(formatAge(59_000)).toBe("59s");
    expect(formatAge(60_000)).toBe("1m");
    expect(formatAge(59 * 60_000)).toBe("59m");
    expect(formatAge(60 * 60_000)).toBe("1h");
    expect(formatAge(24 * 60 * 60_000)).toBe("1d");
  });
});
