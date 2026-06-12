import { describe, expect, test } from "bun:test";
import {
  DARK_DALTONIZED_THEME,
  DARK_THEME,
  LIGHT_THEME,
  type GordonTheme,
} from "../themes/themes.ts";
import {
  getAgentColor,
  getMoneyColor,
  getRiskColor,
  getSignalColor,
  type RiskLevel,
  type SignalSide,
} from "./colorMap.ts";

describe("colorMap", () => {
  test("maps risk levels to theme risk tokens", () => {
    const expected: Record<RiskLevel, keyof GordonTheme> = {
      low: "riskSafe",
      medium: "riskWarning",
      high: "riskDanger",
      critical: "riskCritical",
    };

    for (const theme of [DARK_THEME, LIGHT_THEME, DARK_DALTONIZED_THEME]) {
      for (const level of Object.keys(expected) as RiskLevel[]) {
        expect(getRiskColor(level, theme)).toBe(theme[expected[level]]);
      }
    }
  });

  test("maps money direction to profit/loss and inherits neutral values", () => {
    expect(getMoneyColor(1, DARK_THEME)).toBe(DARK_THEME.moneyProfit);
    expect(getMoneyColor(-1, DARK_THEME)).toBe(DARK_THEME.moneyLoss);
    expect(getMoneyColor(0, DARK_THEME)).toBeUndefined();
    expect(getMoneyColor(Number.NaN, DARK_THEME)).toBeUndefined();
    expect(getMoneyColor(1, DARK_DALTONIZED_THEME)).toBe("rgb(51,153,255)");
    expect(getMoneyColor(-1, DARK_DALTONIZED_THEME)).toBe("rgb(255,204,0)");
  });

  test("maps signal sides to theme signal tokens", () => {
    const expected: Record<SignalSide, keyof GordonTheme> = {
      buy: "signalBuy",
      long: "signalBuy",
      sell: "signalSell",
      short: "signalSell",
      neutral: "signalNeutral",
    };

    for (const theme of [DARK_THEME, LIGHT_THEME, DARK_DALTONIZED_THEME]) {
      for (const side of Object.keys(expected) as SignalSide[]) {
        expect(getSignalColor(side, theme)).toBe(theme[expected[side]]);
      }
    }
  });

  test("maps agent names case-insensitively with researcher alias", () => {
    expect(getAgentColor("gordon", DARK_THEME)).toBe(DARK_THEME.agentGordon);
    expect(getAgentColor("SCANNER", DARK_THEME)).toBe(DARK_THEME.agentScanner);
    expect(getAgentColor("RESEARCHER", DARK_THEME)).toBe(DARK_THEME.agentAnalyst);
    expect(getAgentColor("unknown-agent", DARK_THEME)).toBe(DARK_THEME.uiMuted);
  });
});
