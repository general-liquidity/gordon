/**
 * Trade Confirmation Component
 * Uses ink-ui ConfirmInput for trade approval
 */

import React from "react";
import { Box, Text } from "ink";
import { ConfirmInput, Badge } from "@inkjs/ui";
import { COLORS } from "../theme.ts";

interface TradeDetails {
  action: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
  total: number;
  stopLoss?: number;
  takeProfit?: number;
}

interface TradeConfirmationProps {
  trade: TradeDetails;
  onConfirm: () => void;
  onCancel: () => void;
}

export const TradeConfirmation: React.FC<TradeConfirmationProps> = ({
  trade,
  onConfirm,
  onCancel,
}) => {
  const actionColor = trade.action === "BUY" ? "green" : "red";

  // Action label for screen readers - complements border color
  const actionLabel = trade.action === "BUY" ? "[BUY]" : "[SELL]";

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={trade.action === "BUY" ? COLORS.GREEN : COLORS.RED}
      paddingX={2}
      paddingY={1}
      marginX={1}
    >
      {/* Header - Badge includes action type text for accessibility */}
      <Box marginBottom={1} gap={2}>
        <Text color={COLORS.WHITE} bold>
          Confirm Trade
        </Text>
        <Badge color={actionColor}>
          {trade.action === "BUY" ? "BUY Order" : "SELL Order"}
        </Badge>
      </Box>

      {/* Trade Details */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color={COLORS.DIM}>Symbol: </Text>
          <Text color={COLORS.WHITE} bold>{trade.symbol}</Text>
        </Box>
        <Box>
          <Text color={COLORS.DIM}>Quantity: </Text>
          <Text color={COLORS.WHITE}>{trade.quantity}</Text>
        </Box>
        <Box>
          <Text color={COLORS.DIM}>Price: </Text>
          <Text color={COLORS.HIGHLIGHT}>${trade.price.toFixed(2)}</Text>
        </Box>
        <Box>
          <Text color={COLORS.DIM}>Total: </Text>
          <Text color={COLORS.WHITE} bold>${trade.total.toFixed(2)}</Text>
        </Box>
        {trade.stopLoss && (
          <Box>
            <Text color={COLORS.DIM}>Stop Loss: </Text>
            <Text color={COLORS.RED}>${trade.stopLoss.toFixed(2)}</Text>
          </Box>
        )}
        {trade.takeProfit && (
          <Box>
            <Text color={COLORS.DIM}>Take Profit: </Text>
            <Text color={COLORS.GREEN}>${trade.takeProfit.toFixed(2)}</Text>
          </Box>
        )}
      </Box>

      {/* Confirmation */}
      <Box marginTop={1}>
        <ConfirmInput
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </Box>
    </Box>
  );
};

export default TradeConfirmation;
