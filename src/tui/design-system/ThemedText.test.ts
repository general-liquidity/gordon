import { describe, expect, test } from "bun:test";
import {
  DARK_DALTONIZED_THEME,
  DARK_THEME,
  LIGHT_THEME,
  type GordonTheme,
} from "../themes/themes.ts";
import { toneColor, type TextTone } from "./ThemedText.tsx";

describe("toneColor", () => {
  test("maps text tones to theme tokens", () => {
    const expected: Record<Exclude<TextTone, "muted">, keyof GordonTheme> = {
      brand: "uiBrand",
      success: "riskSafe",
      error: "variantError",
      warning: "riskWarning",
      info: "uiInfo",
    };

    for (const theme of [DARK_THEME, LIGHT_THEME, DARK_DALTONIZED_THEME]) {
      for (const tone of Object.keys(expected) as Array<Exclude<TextTone, "muted">>) {
        expect(toneColor(tone, theme)).toEqual({ color: theme[expected[tone]] });
      }
    }
  });

  test("muted uses terminal dimming", () => {
    expect(toneColor("muted", DARK_THEME)).toEqual({ dimColor: true });
  });

  test("daltonized success follows riskSafe", () => {
    expect(toneColor("success", DARK_DALTONIZED_THEME).color).toBe(DARK_DALTONIZED_THEME.riskSafe);
  });
});
