import React from "react";
import { Box, Text } from "ink";
import type { Plan, PlanStatus } from "../types/index.ts";

// Color palette
const COLORS = {
  TAN: "#d4a27f",
  TAN_DIM: "#b8896a",
  WHITE: "#e8e4de",
  DIM: "#a39e93",
  GREEN: "#4ade80",
  RED: "#ef4444",
  YELLOW: "#facc15",
  BLUE: "#60a5fa",
} as const;

interface PlanDiffProps {
  plan: Plan;
}

// Status indicator component
const StatusBadge: React.FC<{ status: PlanStatus }> = ({ status }) => {
  const getStatusColor = (s: PlanStatus) => {
    switch (s) {
      case "DRAFT":
        return COLORS.YELLOW;
      case "APPROVED":
        return COLORS.BLUE;
      case "EXECUTING":
        return COLORS.GREEN;
      case "CLOSED":
        return COLORS.DIM;
      case "CANCELLED":
        return COLORS.RED;
    }
  };

  const getStatusIcon = (s: PlanStatus) => {
    switch (s) {
      case "DRAFT":
        return "◯";
      case "APPROVED":
        return "◉";
      case "EXECUTING":
        return "▶";
      case "CLOSED":
        return "✓";
      case "CANCELLED":
        return "✕";
    }
  };

  return (
    <Text color={getStatusColor(status)} bold>
      {getStatusIcon(status)} {status}
    </Text>
  );
};

// Format price with proper decimals
const formatPrice = (price: number): string => {
  if (price >= 1000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
};

// Calculate risk/reward ratio
const calculateRiskReward = (plan: Plan): string => {
  if (!plan.entry.price) return "N/A";

  const entryPrice = plan.entry.price;
  const stopPrice = plan.stopLoss.price;
  const firstTP = plan.takeProfit[0]?.price;

  if (!firstTP) return "N/A";

  const risk = Math.abs(entryPrice - stopPrice);
  const reward = Math.abs(firstTP - entryPrice);

  if (risk === 0) return "N/A";

  const ratio = reward / risk;
  return `1:${ratio.toFixed(2)}`;
};

export const PlanDiff: React.FC<PlanDiffProps> = ({ plan }) => {
  const riskReward = calculateRiskReward(plan);

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={COLORS.TAN}
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text color={COLORS.TAN} bold>
            TRADE PLAN
          </Text>
          <Text color={COLORS.DIM}> | </Text>
          <Text color={COLORS.WHITE} bold>
            {plan.symbol}
          </Text>
          <Text color={COLORS.DIM}> | </Text>
          <Text color={COLORS.GREEN}>{plan.direction.toUpperCase()}</Text>
        </Box>
        <StatusBadge status={plan.status} />
      </Box>

      {/* Divider */}
      <Box marginBottom={1}>
        <Text color={COLORS.TAN_DIM}>
          {"─".repeat(50)}
        </Text>
      </Box>

      {/* Entry Section */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Entry
        </Text>
        <Box paddingLeft={2}>
          <Text color={COLORS.DIM}>Type: </Text>
          <Text color={COLORS.WHITE}>{plan.entry.type.toUpperCase()}</Text>
        </Box>
        {plan.entry.price && (
          <Box paddingLeft={2}>
            <Text color={COLORS.DIM}>Price: </Text>
            <Text color={COLORS.WHITE}>{formatPrice(plan.entry.price)}</Text>
          </Box>
        )}
        <Box paddingLeft={2}>
          <Text color={COLORS.DIM}>Allocation: </Text>
          <Text color={COLORS.WHITE}>
            {plan.allocation.amount.toLocaleString()} {plan.allocation.currency}
          </Text>
          <Text color={COLORS.DIM}>
            {" "}
            ({(plan.allocation.percentOfPortfolio * 100).toFixed(1)}%)
          </Text>
        </Box>
      </Box>

      {/* DCA Section */}
      {plan.dca && plan.dca.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.TAN} bold>
            DCA Levels
          </Text>
          {plan.dca.map((level, i) => (
            <Box key={i} paddingLeft={2}>
              <Text color={COLORS.YELLOW}>DCA {i + 1}: </Text>
              <Text color={COLORS.WHITE}>{formatPrice(level.price)}</Text>
              <Text color={COLORS.DIM}>
                {" "}
                ({(level.percentOfAllocation * 100).toFixed(0)}% of allocation)
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Stop Loss */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Stop Loss
        </Text>
        <Box paddingLeft={2}>
          <Text color={COLORS.RED}>
            @ {formatPrice(plan.stopLoss.price)}
          </Text>
          {plan.entry.price && (
            <Text color={COLORS.DIM}>
              {" "}
              (
              {(
                ((plan.stopLoss.price - plan.entry.price) / plan.entry.price) *
                100
              ).toFixed(2)}
              %)
            </Text>
          )}
        </Box>
      </Box>

      {/* Take Profits */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color={COLORS.TAN} bold>
          Take Profits
        </Text>
        {plan.takeProfit.map((tp, i) => (
          <Box key={i} paddingLeft={2}>
            <Text color={COLORS.GREEN}>
              TP{i + 1}: {formatPrice(tp.price)}
            </Text>
            <Text color={COLORS.DIM}>
              {" "}
              (sell {(tp.percentToSell * 100).toFixed(0)}%)
            </Text>
            {plan.entry.price && (
              <Text color={COLORS.DIM}>
                {" "}
                [+
                {(
                  ((tp.price - plan.entry.price) / plan.entry.price) *
                  100
                ).toFixed(2)}
                %]
              </Text>
            )}
          </Box>
        ))}
      </Box>

      {/* Divider */}
      <Box marginBottom={1}>
        <Text color={COLORS.TAN_DIM}>
          {"─".repeat(50)}
        </Text>
      </Box>

      {/* Risk/Reward */}
      <Box marginBottom={1}>
        <Text color={COLORS.DIM}>Risk/Reward: </Text>
        <Text color={COLORS.WHITE} bold>
          {riskReward}
        </Text>
      </Box>

      {/* Reasoning */}
      <Box flexDirection="column">
        <Text color={COLORS.TAN} bold>
          Reasoning
        </Text>
        <Box paddingLeft={2}>
          <Text color={COLORS.DIM} wrap="wrap">
            {plan.reasoning}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

export default PlanDiff;
