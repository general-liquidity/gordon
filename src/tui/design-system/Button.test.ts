import { describe, expect, test } from "bun:test";
import {
  DARK_DALTONIZED_THEME,
  DARK_THEME,
  type GordonTheme,
} from "../themes/themes.ts";
import { buttonVariantColor, type ButtonVariant } from "./Button.tsx";

describe("buttonVariantColor", () => {
  test("maps variants to theme tokens", () => {
    const expected: Record<ButtonVariant, keyof GordonTheme> = {
      primary: "uiBrand",
      success: "riskSafe",
      danger: "riskDanger",
      neutral: "uiMuted",
    };

    for (const theme of [DARK_THEME, DARK_DALTONIZED_THEME]) {
      for (const variant of Object.keys(expected) as ButtonVariant[]) {
        expect(buttonVariantColor(variant, theme)).toBe(theme[expected[variant]]);
      }
    }
  });

  test("daltonized danger follows riskDanger", () => {
    expect(buttonVariantColor("danger", DARK_DALTONIZED_THEME)).toBe("rgb(255,204,0)");
  });
});
