import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Pane } from "../design-system/Pane.js";

export interface RiskAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  currentValue: number;
  limitValue: number;
  unit: "%" | "$" | "positions" | "leverage";
  fixAction: {
    key: string; // single keystroke
    label: string;
    description: string;
  };
}

interface Props {
  alerts: RiskAlert[];
  onFix: (alertId: string) => void;
  onIgnore: (alertId: string) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: "cyan",
  warning: "yellow",
  critical: "red",
};

const SEVERITY_ICONS: Record<string, string> = {
  info: "i",
  warning: "⚠",
  critical: "✗",
};

export function ActionableRiskAlerts({ alerts, onFix, onIgnore }: Props) {
  useInput((input) => {
    const alert = alerts.find((a) => a.fixAction.key === input);
    if (alert) onFix(alert.id);
    else if (input === "i") alerts.forEach((a) => onIgnore(a.id));
  });

  if (alerts.length === 0) {
    return (
      <Pane title="RISK CHECKS" color="green">
        <Text color="green">✓ All risk checks passed</Text>
      </Pane>
    );
  }

  return (
    <Pane title="RISK ALERTS" color="yellow">
      <Box flexDirection="column">
        {alerts.map((alert) => {
          const color = SEVERITY_COLORS[alert.severity];
          const icon = SEVERITY_ICONS[alert.severity];
          const pct = (alert.currentValue / alert.limitValue) * 100;
          return (
            <Box key={alert.id} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={color} bold>{icon} </Text>
                <Text bold>{alert.message}</Text>
              </Box>
              <Box>
                <Text dimColor>  Current: </Text>
                <Text color={color}>
                  {alert.currentValue.toFixed(2)}{alert.unit}
                </Text>
                <Text dimColor> / Limit: </Text>
                <Text>{alert.limitValue.toFixed(2)}{alert.unit}</Text>
                <Text dimColor> ({pct.toFixed(0)}%)</Text>
              </Box>
              <Box>
                <Text color="cyanBright" bold>  [{alert.fixAction.key}]</Text>
                <Text> {alert.fixAction.label}</Text>
                <Text dimColor> — {alert.fixAction.description}</Text>
              </Box>
            </Box>
          );
        })}
        <Text dimColor>[i] ignore all</Text>
      </Box>
    </Pane>
  );
}
