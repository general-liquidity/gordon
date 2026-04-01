/**
 * Trade Confirmation Component
 * Uses ink-ui ConfirmInput for trade approval
 */

import React from "react";
import { Box, Text } from "ink";
import { Badge } from "@inkjs/ui";
import { ConfirmationPrompt } from "./PromptPrimitives.tsx";
import { COLORS } from "../theme.ts";
import { DeskPanel } from "./desk/DeskPanel.tsx";
import { TicketCard } from "./desk/TicketCard.tsx";

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
  const actionTone = trade.action === "BUY" ? "success" : "danger";

  // Action label for screen readers - complements border color
  const actionLabel = trade.action === "BUY" ? "[BUY]" : "[SELL]";

  return (
    <Box marginX={1}>
      <DeskPanel
        eyebrow="Execution Ticket"
        title="Confirm trade"
        subtitle="Review the order ticket before Gordon routes it to the broker."
        tone={actionTone}
      >
        <Box flexDirection="column" gap={1}>
          <Box gap={2}>
            <Badge color={actionColor}>
              {trade.action === "BUY" ? "BUY Order" : "SELL Order"}
            </Badge>
            <Text color={COLORS.DIM}>{actionLabel}</Text>
          </Box>

          <TicketCard
            eyebrow="Order Ticket"
            title={`${trade.action} ${trade.symbol}`}
            subtitle={`Approve ${trade.action.toLowerCase()} execution for ${trade.quantity} units at $${trade.price.toFixed(2)}.`}
            tone={actionTone}
          >
            <Box flexDirection="column">
              <Text color={COLORS.DIM}>Quantity: <Text color={COLORS.WHITE}>{trade.quantity}</Text></Text>
              <Text color={COLORS.DIM}>Price: <Text color={COLORS.HIGHLIGHT}>${trade.price.toFixed(2)}</Text></Text>
              <Text color={COLORS.DIM}>Total: <Text color={COLORS.WHITE}>${trade.total.toFixed(2)}</Text></Text>
              {trade.stopLoss && (
                <Text color={COLORS.DIM}>Stop Loss: <Text color={COLORS.RED}>${trade.stopLoss.toFixed(2)}</Text></Text>
              )}
              {trade.takeProfit && (
                <Text color={COLORS.DIM}>Take Profit: <Text color={COLORS.GREEN}>${trade.takeProfit.toFixed(2)}</Text></Text>
              )}
            </Box>
          </TicketCard>

          <ConfirmationPrompt
            title={`${actionLabel} ${trade.symbol}`}
            description={`Approve ${trade.action.toLowerCase()} execution for ${trade.quantity} units at $${trade.price.toFixed(2)}.`}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        </Box>
      </DeskPanel>
    </Box>
  );
};

export default TradeConfirmation;
