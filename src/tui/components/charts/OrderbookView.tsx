import React from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

// ============================================================================
// OrderbookView — Depth-of-book visualization
//
// Bids (green) on left, asks (red) on right, spread in center.
// Bar width proportional to cumulative depth.
// ============================================================================

export interface OrderbookLevel {
  price: number;
  quantity: number;
  cumulative: number;
}

interface Props {
  symbol: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  spread: number;
  spreadPercent: number;
  onClose: () => void;
}

function depthBar(ratio: number, width: number, char = "\u2588"): string {
  const filled = Math.round(ratio * width);
  return char.repeat(Math.max(0, filled));
}

function fmtPrice(n: number): string {
  if (n >= 10000) return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(4);
}

function fmtQty(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

export function OrderbookView({ symbol, bids, asks, spread, spreadPercent, onClose }: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  const maxCumBid = bids.length > 0 ? Math.max(...bids.map((l) => l.cumulative)) : 1;
  const maxCumAsk = asks.length > 0 ? Math.max(...asks.map((l) => l.cumulative)) : 1;
  const barWidth = 20;
  const rows = Math.max(bids.length, asks.length, 1);

  return (
    <Pane title={`ORDERBOOK ${symbol}`}>
      {/* Header */}
      <Box>
        <Box width={12}><Text bold dimColor>QTY</Text></Box>
        <Box width={barWidth + 2}><Text bold dimColor>BIDS</Text></Box>
        <Box width={12} justifyContent="flex-end"><Text bold dimColor>PRICE</Text></Box>
        <Box width={4}><Text> </Text></Box>
        <Box width={12}><Text bold dimColor>PRICE</Text></Box>
        <Box width={barWidth + 2}><Text bold dimColor>ASKS</Text></Box>
        <Box width={12} justifyContent="flex-end"><Text bold dimColor>QTY</Text></Box>
      </Box>

      {/* Depth rows */}
      {Array.from({ length: Math.min(rows, 15) }, (_, i) => {
        const bid = bids[i];
        const ask = asks[i];
        return (
          <Box key={i}>
            {/* Bid side */}
            <Box width={12}>
              <Text dimColor>{bid ? fmtQty(bid.quantity) : ""}</Text>
            </Box>
            <Box width={barWidth + 2} justifyContent="flex-end">
              <Text color="green">
                {bid ? depthBar(bid.cumulative / maxCumBid, barWidth) : ""}
              </Text>
            </Box>
            <Box width={12} justifyContent="flex-end">
              <Text color="green">{bid ? fmtPrice(bid.price) : ""}</Text>
            </Box>

            {/* Spread gap */}
            <Box width={4} justifyContent="center">
              {i === 0 ? <Text dimColor>{"\u2502"}</Text> : <Text> </Text>}
            </Box>

            {/* Ask side */}
            <Box width={12}>
              <Text color="red">{ask ? fmtPrice(ask.price) : ""}</Text>
            </Box>
            <Box width={barWidth + 2}>
              <Text color="red">
                {ask ? depthBar(ask.cumulative / maxCumAsk, barWidth) : ""}
              </Text>
            </Box>
            <Box width={12} justifyContent="flex-end">
              <Text dimColor>{ask ? fmtQty(ask.quantity) : ""}</Text>
            </Box>
          </Box>
        );
      })}

      {/* Spread line */}
      <Text> </Text>
      <Box>
        <Text dimColor>Spread: </Text>
        <Text color={spreadPercent < 0.05 ? "green" : spreadPercent < 0.2 ? "yellow" : "red"}>
          {fmtPrice(spread)} ({spreadPercent.toFixed(3)}%)
        </Text>
      </Box>

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}
