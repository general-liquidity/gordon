// ============================================================================
// Gordon Themes — 6 built-in themes with RGB color values
//
// Claude Code pattern: exact RGB for consistent colors across terminals.
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
  uiBrand: string; uiMuted: string; uiBorder: string; uiFocus: string; uiSelection: string; uiInfo: string;
  // Diff
  diffAdded: string; diffRemoved: string; diffAddedWord: string; diffRemovedWord: string;
  diffAddedDimmed: string; diffRemovedDimmed: string;
  // Charts
  chartUp: string; chartDown: string; chartVolume: string; chartGrid: string;
  // Progress
  progressFill: string; progressEmpty: string; progressWarning: string; progressDanger: string;
  // Shimmer — per-accent pairs (Claude Code pattern)
  shimmerBase: string; shimmerHighlight: string;
  shimmerBrand: string; shimmerBrandHighlight: string;
  shimmerAgent: string; shimmerAgentHighlight: string;
  shimmerDanger: string; shimmerDangerHighlight: string;
  // Stall
  stallRed: string;
  // Message variants
  variantFill: string; variantStop: string; variantAlert: string;
  variantStrategy: string; variantError: string; variantSystem: string; variantAdvisor: string;
  // Message backgrounds
  userMessageBackground: string;
}

const DARK_AGENTS = {
  agentGordon: "rgb(52,238,176)", agentScanner: "rgb(40,200,150)", agentAnalyst: "rgb(80,140,255)",
  agentPlanner: "rgb(180,100,255)", agentExecutor: "rgb(255,200,50)", agentMonitor: "rgb(50,200,80)",
  agentTeacher: "rgb(100,160,255)", agentBacktester: "rgb(220,120,255)", agentCritic: "rgb(255,80,80)", agentAuditor: "rgb(150,150,150)",
};

const LIGHT_AGENTS = {
  agentGordon: "rgb(0,160,200)", agentScanner: "rgb(0,130,170)", agentAnalyst: "rgb(50,100,200)",
  agentPlanner: "rgb(140,60,200)", agentExecutor: "rgb(180,140,0)", agentMonitor: "rgb(30,150,50)",
  agentTeacher: "rgb(60,120,200)", agentBacktester: "rgb(170,80,200)", agentCritic: "rgb(200,40,40)", agentAuditor: "rgb(100,100,100)",
};

export const DARK_THEME: GordonTheme = {
  name: "dark", ...DARK_AGENTS,
  moneyProfit: "rgb(78,186,101)", moneyLoss: "rgb(255,107,128)", moneyNeutral: "rgb(255,255,255)",
  riskSafe: "rgb(78,186,101)", riskWarning: "rgb(255,193,7)", riskDanger: "rgb(255,107,128)", riskCritical: "rgb(255,60,80)",
  signalBuy: "rgb(100,220,120)", signalSell: "rgb(255,80,100)", signalNeutral: "rgb(150,150,150)",
  uiBrand: "rgb(52,238,176)", uiMuted: "rgb(150,150,150)", uiBorder: "rgb(100,100,100)", uiFocus: "rgb(52,238,176)", uiSelection: "rgb(80,200,160)", uiInfo: "rgb(0,180,220)",
  diffAdded: "rgb(78,186,101)", diffRemoved: "rgb(255,107,128)", diffAddedWord: "rgb(100,220,120)", diffRemovedWord: "rgb(255,80,100)",
  diffAddedDimmed: "rgb(40,80,50)", diffRemovedDimmed: "rgb(80,40,50)",
  chartUp: "rgb(78,186,101)", chartDown: "rgb(255,107,128)", chartVolume: "rgb(0,180,220)", chartGrid: "rgb(80,80,80)",
  progressFill: "rgb(52,238,176)", progressEmpty: "rgb(60,60,60)", progressWarning: "rgb(255,193,7)", progressDanger: "rgb(255,107,128)",
  shimmerBase: "rgb(100,100,100)", shimmerHighlight: "rgb(52,238,176)",
  shimmerBrand: "rgb(40,200,150)", shimmerBrandHighlight: "rgb(80,255,200)",
  shimmerAgent: "rgb(100,100,100)", shimmerAgentHighlight: "rgb(180,180,200)",
  shimmerDanger: "rgb(150,40,50)", shimmerDangerHighlight: "rgb(255,80,100)",
  stallRed: "rgb(171,43,63)",
  variantFill: "rgb(78,186,101)", variantStop: "rgb(255,107,128)", variantAlert: "rgb(255,193,7)",
  variantStrategy: "rgb(52,238,176)", variantError: "rgb(255,60,80)", variantSystem: "rgb(150,150,150)", variantAdvisor: "rgb(180,100,255)",
  userMessageBackground: "rgb(55,55,55)",
};

export const LIGHT_THEME: GordonTheme = {
  name: "light", ...LIGHT_AGENTS,
  moneyProfit: "rgb(44,122,57)", moneyLoss: "rgb(171,43,63)", moneyNeutral: "rgb(0,0,0)",
  riskSafe: "rgb(44,122,57)", riskWarning: "rgb(150,108,30)", riskDanger: "rgb(171,43,63)", riskCritical: "rgb(200,20,40)",
  signalBuy: "rgb(44,122,57)", signalSell: "rgb(171,43,63)", signalNeutral: "rgb(100,100,100)",
  uiBrand: "rgb(0,160,200)", uiMuted: "rgb(100,100,100)", uiBorder: "rgb(180,180,180)", uiFocus: "rgb(0,160,200)", uiSelection: "rgb(50,100,200)", uiInfo: "rgb(0,130,170)",
  diffAdded: "rgb(44,122,57)", diffRemoved: "rgb(171,43,63)", diffAddedWord: "rgb(60,160,80)", diffRemovedWord: "rgb(200,50,70)",
  diffAddedDimmed: "rgb(200,240,210)", diffRemovedDimmed: "rgb(240,210,210)",
  chartUp: "rgb(44,122,57)", chartDown: "rgb(171,43,63)", chartVolume: "rgb(0,130,170)", chartGrid: "rgb(200,200,200)",
  progressFill: "rgb(0,160,200)", progressEmpty: "rgb(220,220,220)", progressWarning: "rgb(150,108,30)", progressDanger: "rgb(171,43,63)",
  shimmerBase: "rgb(180,180,180)", shimmerHighlight: "rgb(0,160,200)",
  shimmerBrand: "rgb(0,130,170)", shimmerBrandHighlight: "rgb(0,200,240)",
  shimmerAgent: "rgb(180,180,180)", shimmerAgentHighlight: "rgb(100,100,120)",
  shimmerDanger: "rgb(200,150,150)", shimmerDangerHighlight: "rgb(171,43,63)",
  stallRed: "rgb(171,43,63)",
  variantFill: "rgb(44,122,57)", variantStop: "rgb(171,43,63)", variantAlert: "rgb(150,108,30)",
  variantStrategy: "rgb(0,130,170)", variantError: "rgb(200,20,40)", variantSystem: "rgb(100,100,100)", variantAdvisor: "rgb(140,60,200)",
  userMessageBackground: "rgb(240,240,240)",
};

export const DARK_DALTONIZED_THEME: GordonTheme = {
  ...DARK_THEME, name: "dark-daltonized",
  moneyProfit: "rgb(51,153,255)", moneyLoss: "rgb(255,204,0)",
  riskSafe: "rgb(51,153,255)", riskDanger: "rgb(255,204,0)", riskCritical: "rgb(255,230,50)",
  riskWarning: "rgb(200,100,255)",
  signalBuy: "rgb(51,153,255)", signalSell: "rgb(255,204,0)",
  diffAdded: "rgb(51,153,255)", diffRemoved: "rgb(255,204,0)", diffAddedWord: "rgb(80,180,255)", diffRemovedWord: "rgb(255,230,50)",
  diffAddedDimmed: "rgb(30,50,80)", diffRemovedDimmed: "rgb(80,70,30)",
  chartUp: "rgb(51,153,255)", chartDown: "rgb(255,204,0)",
  variantFill: "rgb(51,153,255)", variantStop: "rgb(255,204,0)",
};

export const LIGHT_DALTONIZED_THEME: GordonTheme = {
  ...LIGHT_THEME, name: "light-daltonized",
  moneyProfit: "rgb(0,102,153)", moneyLoss: "rgb(204,153,0)", moneyNeutral: "rgb(0,0,0)",
  riskSafe: "rgb(0,102,153)", riskDanger: "rgb(204,153,0)",
  signalBuy: "rgb(0,102,153)", signalSell: "rgb(204,153,0)",
  diffAdded: "rgb(0,102,153)", diffRemoved: "rgb(204,153,0)",
  diffAddedDimmed: "rgb(200,230,240)", diffRemovedDimmed: "rgb(240,230,200)",
  variantFill: "rgb(0,102,153)", variantStop: "rgb(204,153,0)",
};

export const DARK_HIGH_CONTRAST_THEME: GordonTheme = {
  ...DARK_THEME, name: "dark-high-contrast",
  moneyProfit: "rgb(100,255,120)", moneyLoss: "rgb(255,80,80)", moneyNeutral: "rgb(255,255,255)",
  signalBuy: "rgb(100,255,120)", signalSell: "rgb(255,80,80)",
  uiBrand: "rgb(255,255,255)", uiFocus: "rgb(255,255,255)",
  diffAdded: "rgb(100,255,120)", diffRemoved: "rgb(255,80,80)",
};

export const LIGHT_HIGH_CONTRAST_THEME: GordonTheme = {
  ...LIGHT_THEME, name: "light-high-contrast",
  moneyProfit: "rgb(0,100,0)", moneyLoss: "rgb(180,0,0)", moneyNeutral: "rgb(0,0,0)",
  uiBrand: "rgb(0,0,0)", uiFocus: "rgb(0,0,0)",
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
