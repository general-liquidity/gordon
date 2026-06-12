import { describe, expect, test } from "bun:test";
import {
  FULL_LOGO_MIN_COLUMNS,
  GORDON_LOGO,
  LOGO_WIDTH,
  renderBanner,
} from "./banner.ts";

const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (value: string) => value.replace(ANSI, "");

describe("renderBanner", () => {
  test("exports logo art with exact visible width", () => {
    expect(GORDON_LOGO).toHaveLength(6);
    for (const line of GORDON_LOGO) {
      expect(stripAnsi(line).length).toBe(LOGO_WIDTH);
    }
  });

  test("renders the full teal logo and tagline at wide widths", () => {
    const lines = renderBanner({ columns: 80, version: "0.9.0" });
    expect(lines).toHaveLength(7);
    for (const line of lines) {
      expect(line).toContain("38;2;52;238;176");
      expect(line.endsWith("\x1b[0m")).toBe(true);
    }
    expect(stripAnsi(lines[6]!)).toContain("v0.9.0");
  });

  test("renders compact wordmark below the full-logo threshold", () => {
    const lines = renderBanner({ columns: FULL_LOGO_MIN_COLUMNS - 1, version: "0.9.1" });
    expect(lines).toHaveLength(2);
    expect(stripAnsi(lines.join("\n"))).toContain("≫ GORDON");
    expect(stripAnsi(lines.join("\n"))).toContain("v0.9.1");
    expect(stripAnsi(lines.join("\n"))).not.toContain("██");
  });

  test("uses the full logo at the boundary and returns empty for non-positive columns", () => {
    expect(renderBanner({ columns: FULL_LOGO_MIN_COLUMNS, version: "1.0" })).toHaveLength(7);
    expect(renderBanner({ columns: 0, version: "1.0" })).toEqual([]);
  });

  test("truncates compact tagline instead of wrapping", () => {
    const lines = renderBanner({ columns: 20, version: "2.0" });
    expect(lines).toHaveLength(2);
    expect(stripAnsi(lines[1]!).length).toBeLessThanOrEqual(19);
    expect(stripAnsi(lines[1]!)).toContain("…");
  });
});
