import { describe, expect, test } from "bun:test";
import {
  DARK_THEME,
  DARK_DALTONIZED_THEME,
  type GordonTheme,
} from "../themes/themes.ts";
import {
  buildTopBorder,
  embedTitleInBorder,
  panelToneColor,
  type PanelTone,
} from "./TitledBox.tsx";

describe("buildTopBorder", () => {
  test("produces a line of exactly `width` chars with round joins", () => {
    const line = buildTopBorder({ width: 30, title: "RISK", style: "round" });
    expect([...line].length).toBe(30);
    expect(line.startsWith("╭")).toBe(true);
    expect(line.endsWith("╮")).toBe(true);
    expect(line).toContain(" RISK ");
  });

  test("embeds the title with a horizontal lead on start-align", () => {
    const line = buildTopBorder({ width: 30, title: "ORDER PREVIEW", align: "start" });
    // ╭─ ORDER PREVIEW ...
    expect(line.startsWith("╭─ ORDER PREVIEW ")).toBe(true);
  });

  test("respects each border style's glyph set", () => {
    expect(buildTopBorder({ width: 12, title: "X", style: "single" })).toContain("┌");
    expect(buildTopBorder({ width: 12, title: "X", style: "double" })).toContain("╔");
    expect(buildTopBorder({ width: 12, title: "X", style: "bold" })).toContain("┏");
    const classic = buildTopBorder({ width: 12, title: "X", style: "classic" });
    expect(classic.startsWith("+")).toBe(true);
    expect(classic.endsWith("+")).toBe(true);
  });

  test("no-title yields a solid rule of the right width", () => {
    const line = buildTopBorder({ width: 10, style: "round" });
    expect(line).toBe("╭────────╮");
    expect([...line].length).toBe(10);
  });

  test("center align keeps the title roughly centered", () => {
    const width = 40;
    const line = buildTopBorder({ width, title: "MID", align: "center" });
    const idx = line.indexOf(" MID ");
    // Center of the label near the center of the inner run.
    const labelCenter = idx + " MID ".length / 2;
    expect(Math.abs(labelCenter - width / 2)).toBeLessThanOrEqual(2);
    expect([...line].length).toBe(width);
  });
});

describe("embedTitleInBorder", () => {
  test("returns exactly innerWidth chars even when the title overflows", () => {
    const mid = embedTitleInBorder(10, "A VERY LONG PANEL TITLE", "start", 0, "─");
    expect([...mid].length).toBe(10);
    expect(mid).toContain("…");
  });

  test("end align places the title toward the right corner", () => {
    const mid = embedTitleInBorder(20, "END", "end", 0, "─");
    expect([...mid].length).toBe(20);
    // Trailing lead is one horizontal glyph after the label.
    expect(mid.endsWith(" END ─")).toBe(true);
  });

  test("offset pushes the title further from the leading corner", () => {
    const a = embedTitleInBorder(24, "T", "start", 0, "─");
    const b = embedTitleInBorder(24, "T", "start", 3, "─");
    expect(b.indexOf(" T ")).toBe(a.indexOf(" T ") + 3);
  });
});

describe("panelToneColor", () => {
  test("maps tones to theme tokens", () => {
    const expected: Record<PanelTone, keyof GordonTheme> = {
      brand: "uiBrand",
      warning: "riskWarning",
      danger: "riskDanger",
      success: "riskSafe",
      muted: "uiMuted",
      info: "uiInfo",
    };
    for (const theme of [DARK_THEME, DARK_DALTONIZED_THEME]) {
      for (const tone of Object.keys(expected) as PanelTone[]) {
        expect(panelToneColor(tone, theme)).toBe(theme[expected[tone]]);
      }
    }
  });
});
