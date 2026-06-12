import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";
import { getRiskColor, getSignalColor } from "../../design-system/colorMap.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";
import { Divider } from "../layout/Divider.tsx";

// ============================================================================
// TradeExecutionPermissionRequest — Approval dialog for actual trade orders
//
// Critical: double-red border + 3s countdown
// High:     single-red border
// Medium/Low: dividers only
// ============================================================================

export interface TradeDetails {
  side: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  orderType: "market" | "limit" | "stop";
  price?: number;
  estimatedValue?: number;
  riskClass: "low" | "medium" | "high" | "critical";
}

interface Props {
  tradeDetails: TradeDetails;
  reason?: string;
  onDecision: (decision: "approve" | "deny" | "paper") => void;
}

export function TradeExecutionPermissionRequest({ tradeDetails, reason, onDecision }: Props) {
  if (tradeDetails.riskClass === "critical") {
    return <CriticalTrade tradeDetails={tradeDetails} reason={reason} onDecision={onDecision} />;
  }
  if (tradeDetails.riskClass === "high") {
    return <HighTrade tradeDetails={tradeDetails} reason={reason} onDecision={onDecision} />;
  }
  return <StandardTrade tradeDetails={tradeDetails} reason={reason} onDecision={onDecision} />;
}

function TradeBody({ tradeDetails, reason }: { tradeDetails: TradeDetails; reason?: string }) {
  const { side, symbol, quantity, orderType, price, estimatedValue, riskClass } = tradeDetails;
  const theme = useTheme();
  const priceStr = price != null ? ` @ $${price.toLocaleString()}` : ` @ ${orderType}`;
  const riskTone = getRiskColor(riskClass, theme);
  const sideColor = getSignalColor(side === "BUY" ? "buy" : "sell", theme);

  return (
    <>
      <Text>
        {"  "}Gordon wants to place:{" "}
        <Text bold color={sideColor}>
          {side} {quantity} {symbol}
        </Text>
        <Text dimColor>{priceStr}</Text>
      </Text>
      {estimatedValue != null && (
        <Text dimColor>{"  "}Estimated value: ~${estimatedValue.toLocaleString()}</Text>
      )}
      <Box>
        <Text dimColor>{"  "}Risk class: </Text>
        <Text color={riskTone} bold>
          {riskClass.toUpperCase()}
        </Text>
      </Box>
      {reason && <Text dimColor>{"  "}{reason}</Text>}
    </>
  );
}

const TRADE_OPTIONS = [
  { label: "Approve", value: "approve" },
  { label: "Deny", value: "deny" },
  { label: "Paper trade instead", value: "paper" },
] as const;

function StandardTrade({ tradeDetails, reason, onDecision }: Props) {
  const theme = useTheme();

  return (
    <Box flexDirection="column" marginTop={1}>
      <Divider />
      <Box paddingX={2} flexDirection="column">
        <Text color={theme.riskWarning} bold>
          {"⚠"} TRADE EXECUTION REQUEST
        </Text>
        <Text> </Text>
        <TradeBody tradeDetails={tradeDetails} reason={reason} />
        <Text> </Text>
        <Box paddingLeft={2}>
          <Select
            options={[...TRADE_OPTIONS]}
            onChange={(v) => onDecision(v as "approve" | "deny" | "paper")}
          />
        </Box>
      </Box>
      <Divider />
    </Box>
  );
}

function HighTrade({ tradeDetails, reason, onDecision }: Props) {
  const theme = useTheme();
  const riskTone = getRiskColor("high", theme);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={riskTone}
        paddingX={2}
        paddingY={1}
      >
        <Text color={riskTone} bold>
          {"⚠"} TRADE EXECUTION REQUEST
        </Text>
        <Text> </Text>
        <TradeBody tradeDetails={tradeDetails} reason={reason} />
        <Text> </Text>
        <Text color={riskTone}>{"  "}High risk trade — review carefully before approving.</Text>
        <Text> </Text>
        <Box paddingLeft={2}>
          <Select
            options={[...TRADE_OPTIONS]}
            onChange={(v) => onDecision(v as "approve" | "deny" | "paper")}
          />
        </Box>
      </Box>
    </Box>
  );
}

function CriticalTrade({ tradeDetails, reason, onDecision }: Props) {
  const [countdown, setCountdown] = useState(3);
  const [unlocked, setUnlocked] = useState(false);
  const theme = useTheme();
  const riskTone = getRiskColor("critical", theme);

  useEffect(() => {
    if (countdown <= 0) { setUnlocked(true); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useInput((_, key) => {
    if (key.escape) onDecision("deny");
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor={riskTone}
        paddingX={2}
        paddingY={1}
      >
        <Box>
          <Text color={riskTone} bold inverse>{" CRITICAL "}</Text>
          <Text color={riskTone} bold> TRADE EXECUTION REQUEST</Text>
        </Box>
        <Text> </Text>
        <TradeBody tradeDetails={tradeDetails} reason={reason} />
        <Text> </Text>
        <Text color={riskTone} bold>
          {"  "}{"⚠"} CRITICAL — This trade may be irreversible.
        </Text>
        <Text> </Text>
        {!unlocked ? (
          <Text dimColor>{"  "}Confirm available in {countdown}s... (Esc to deny)</Text>
        ) : (
          <Box paddingLeft={2}>
            <Select
              options={[...TRADE_OPTIONS]}
              onChange={(v) => onDecision(v as "approve" | "deny" | "paper")}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
