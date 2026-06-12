import type { GordonTheme } from "../themes/themes.ts";
import { useTheme } from "../themes/ThemeProvider.tsx";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type SignalSide = "buy" | "sell" | "long" | "short" | "neutral";

export function getRiskColor(level: RiskLevel, theme: GordonTheme): string {
  switch (level) {
    case "low":
      return theme.riskSafe;
    case "medium":
      return theme.riskWarning;
    case "high":
      return theme.riskDanger;
    case "critical":
      return theme.riskCritical;
  }
}

export function getMoneyColor(value: number, theme: GordonTheme): string | undefined {
  if (!Number.isFinite(value) || value === 0) return undefined;
  return value > 0 ? theme.moneyProfit : theme.moneyLoss;
}

export function getSignalColor(side: SignalSide, theme: GordonTheme): string {
  switch (side) {
    case "buy":
    case "long":
      return theme.signalBuy;
    case "sell":
    case "short":
      return theme.signalSell;
    case "neutral":
      return theme.signalNeutral;
  }
}

export function getAgentColor(agent: string, theme: GordonTheme): string {
  switch (agent.toLowerCase()) {
    case "gordon":
      return theme.agentGordon;
    case "scanner":
      return theme.agentScanner;
    case "analyst":
    case "researcher":
      return theme.agentAnalyst;
    case "planner":
      return theme.agentPlanner;
    case "executor":
      return theme.agentExecutor;
    case "monitor":
      return theme.agentMonitor;
    case "teacher":
      return theme.agentTeacher;
    case "backtester":
      return theme.agentBacktester;
    case "critic":
      return theme.agentCritic;
    case "auditor":
      return theme.agentAuditor;
    default:
      return theme.uiMuted;
  }
}

export function useRiskColor(level: RiskLevel): string {
  return getRiskColor(level, useTheme());
}

export function useMoneyColor(value: number): string | undefined {
  return getMoneyColor(value, useTheme());
}

export function useSignalColor(side: SignalSide): string {
  return getSignalColor(side, useTheme());
}

export function useAgentColor(agent: string): string {
  return getAgentColor(agent, useTheme());
}
