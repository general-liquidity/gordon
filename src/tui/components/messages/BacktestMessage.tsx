import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "../MessageBubble.js";

// Backtest results: Sharpe, PSR, win rate, drawdown summary
export const BacktestMessage = React.memo(function BacktestMessage({ message }: { message: Message }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="magenta">{"\u25C8"} </Text>
        <Text bold color="magenta">BACKTEST</Text>
        {message.agent && <Text dimColor> {"\u00b7"} {message.agent}</Text>}
      </Box>
      <Box paddingLeft={2} flexDirection="column" borderStyle="single" borderColor="gray" marginLeft={2}>
        {message.content.split("\n").map((line, i) => {
          // Highlight key metrics
          const isPositive = line.includes("+") || line.includes("profit");
          const isNegative = line.includes("-") || line.includes("loss") || line.includes("drawdown");
          return (
            <Text key={i} color={isNegative ? "red" : isPositive ? "green" : undefined}>
              {line}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
});
