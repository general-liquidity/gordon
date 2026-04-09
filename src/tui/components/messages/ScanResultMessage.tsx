import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// Scan results: opportunities found, ranked by confidence
export function ScanResultMessage({ message }: { message: Message }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="cyanBright">{"\u25C8"} </Text>
        <Text bold color="cyanBright">SCAN</Text>
        {message.agent && <Text dimColor> {"\u00b7"} {message.agent}</Text>}
      </Box>
      <Box paddingLeft={2} flexDirection="column">
        {message.content.split("\n").map((line, i) => {
          // Highlight confidence levels and bias direction
          const isBullish = /bullish|long|buy/i.test(line);
          const isBearish = /bearish|short|sell/i.test(line);
          const isHighConf = /[89]\d%|100%/i.test(line);
          return (
            <Text
              key={i}
              color={isBullish ? "green" : isBearish ? "red" : undefined}
              bold={isHighConf}
            >
              {line}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
