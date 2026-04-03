import React from "react";
import { Box, Text } from "ink";

/**
 * RiskRenderer -- Risk checks display
 * Phase 10: Position size, daily loss, drawdown, leverage checks with status icons
 */

interface RiskCheck {
  label: string;
  current: number;
  limit: number;
  unit: string;
  ok: boolean;
}

interface RiskData {
  positionSize: RiskCheck;
  dailyLoss: RiskCheck;
  drawdown: RiskCheck;
  leverage: RiskCheck;
  extra?: RiskCheck[];
}

interface Props {
  data: RiskData;
}

function RiskRow({ check }: { check: RiskCheck }) {
  const pct = check.limit > 0 ? (check.current / check.limit) * 100 : 0;
  const barWidth = 20;
  const filled = Math.min(barWidth, Math.max(1, Math.round((pct / 100) * barWidth)));
  const barColor = check.ok ? (pct > 75 ? "yellow" : "green") : "red";
  const icon = check.ok ? "\u2713" : "\u2717";
  const iconColor = check.ok ? "green" : "red";

  return (
    <Box>
      <Text color={iconColor}>{icon}</Text>
      <Text> </Text>
      <Box width={16}>
        <Text bold>{check.label}</Text>
      </Box>
      <Box width={12} justifyContent="flex-end">
        <Text>
          {formatVal(check.current, check.unit)}/{formatVal(check.limit, check.unit)}
        </Text>
      </Box>
      <Text> </Text>
      <Text color={barColor}>
        {"\u2588".repeat(filled)}
        {"\u2591".repeat(Math.max(0, barWidth - filled))}
      </Text>
      <Text dimColor> {pct.toFixed(0)}%</Text>
    </Box>
  );
}

function formatVal(n: number, unit: string): string {
  if (unit === "%") return `${n.toFixed(1)}%`;
  if (unit === "x") return `${n.toFixed(1)}x`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

export function RiskRenderer({ data }: Props) {
  const checks = [data.positionSize, data.dailyLoss, data.drawdown, data.leverage];
  if (data.extra) checks.push(...data.extra);

  const allOk = checks.every((c) => c.ok);

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      <Box marginBottom={1}>
        <Text bold color={allOk ? "green" : "red"}>
          {allOk ? "\u2713 ALL CHECKS PASSED" : "\u26A0 RISK LIMIT BREACHED"}
        </Text>
      </Box>

      {checks.map((check, i) => (
        <RiskRow key={i} check={check} />
      ))}
    </Box>
  );
}
