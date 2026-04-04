// ============================================================================
// Gordon Themes — 6 built-in themes with 50+ semantic color tokens
//
// Every component uses theme tokens, never raw colors.
// The Money Rule: green/red reserved for financial direction only.
// ============================================================================

export interface GordonTheme {
  name: string;
  // Money
  moneyProfit: string; moneyLoss: string; moneyNeutral: string;
  // Risk
  riskSafe: string; riskWarning: string; riskDanger: string; riskCritical: string;
  // Signals
  signalBuy: string; signalSell: string; signalNeutral: string;
  // Agents
  agentGordon: string; agentScanner: string; agentAnalyst: string;
  agentPlanner: string; agentExecutor: string; agentMonitor: string;
  agentTeacher: string; agentBacktester: string; agentCritic: string; agentAuditor: string;
  // UI Chrome
  uiBrand: string; uiMuted: string; uiBorder: string; uiFocus: string; uiSelection: string;
  // Diff
  diffAdded: string; diffRemoved: string; diffAddedWord: string; diffRemovedWord: string;
  // Charts
  chartUp: string; chartDown: string; chartVolume: string; chartGrid: string;
  // Progress
  progressFill: string; progressEmpty: string; progressWarning: string; progressDanger: string;
  // Shimmer
  shimmerBase: string; shimmerHighlight: string;
  // Message variants
  variantFill: string; variantStop: string; variantAlert: string;
  variantStrategy: string; variantError: string; variantSystem: string; variantAdvisor: string;
}

const BASE_AGENTS = {
  agentGordon: "cyanBright", agentScanner: "cyan", agentAnalyst: "blue",
  agentPlanner: "magenta", agentExecutor: "yellow", agentMonitor: "green",
  agentTeacher: "blueBright", agentBacktester: "magentaBright", agentCritic: "red", agentAuditor: "gray",
};

export const DARK_THEME: GordonTheme = {
  name: "dark", ...BASE_AGENTS,
  moneyProfit: "green", moneyLoss: "red", moneyNeutral: "white",
  riskSafe: "green", riskWarning: "yellow", riskDanger: "red", riskCritical: "redBright",
  signalBuy: "greenBright", signalSell: "redBright", signalNeutral: "gray",
  uiBrand: "cyanBright", uiMuted: "gray", uiBorder: "gray", uiFocus: "cyanBright", uiSelection: "blueBright",
  diffAdded: "green", diffRemoved: "red", diffAddedWord: "greenBright", diffRemovedWord: "redBright",
  chartUp: "green", chartDown: "red", chartVolume: "cyan", chartGrid: "gray",
  progressFill: "cyanBright", progressEmpty: "gray", progressWarning: "yellow", progressDanger: "red",
  shimmerBase: "gray", shimmerHighlight: "cyanBright",
  variantFill: "green", variantStop: "red", variantAlert: "yellow",
  variantStrategy: "cyan", variantError: "redBright", variantSystem: "gray", variantAdvisor: "magenta",
};

export const LIGHT_THEME: GordonTheme = {
  ...DARK_THEME, name: "light",
  moneyNeutral: "black", uiBrand: "cyan", uiMuted: "gray", uiBorder: "gray",
  shimmerBase: "gray", shimmerHighlight: "cyan",
};

export const DARK_DALTONIZED_THEME: GordonTheme = {
  ...DARK_THEME, name: "dark-daltonized",
  moneyProfit: "blueBright", moneyLoss: "yellow",
  riskSafe: "blueBright", riskDanger: "yellow", riskCritical: "yellowBright",
  riskWarning: "magenta",
  signalBuy: "blueBright", signalSell: "yellowBright",
  diffAdded: "blueBright", diffRemoved: "yellow", diffAddedWord: "blueBright", diffRemovedWord: "yellowBright",
  chartUp: "blueBright", chartDown: "yellow",
  variantFill: "blueBright", variantStop: "yellow",
};

export const LIGHT_DALTONIZED_THEME: GordonTheme = {
  ...DARK_DALTONIZED_THEME, name: "light-daltonized",
  moneyNeutral: "black", uiBrand: "cyan",
};

export const DARK_HIGH_CONTRAST_THEME: GordonTheme = {
  ...DARK_THEME, name: "dark-high-contrast",
  moneyProfit: "greenBright", moneyLoss: "redBright", moneyNeutral: "whiteBright",
  signalBuy: "greenBright", signalSell: "redBright",
  uiBrand: "whiteBright", uiFocus: "whiteBright",
  diffAdded: "greenBright", diffRemoved: "redBright",
};

export const LIGHT_HIGH_CONTRAST_THEME: GordonTheme = {
  ...DARK_HIGH_CONTRAST_THEME, name: "light-high-contrast",
  moneyNeutral: "black", uiBrand: "black",
};

export const THEMES: Record<string, GordonTheme> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
  "dark-daltonized": DARK_DALTONIZED_THEME,
  "light-daltonized": LIGHT_DALTONIZED_THEME,
  "dark-high-contrast": DARK_HIGH_CONTRAST_THEME,
  "light-high-contrast": LIGHT_HIGH_CONTRAST_THEME,
};

export const THEME_NAMES = Object.keys(THEMES);
