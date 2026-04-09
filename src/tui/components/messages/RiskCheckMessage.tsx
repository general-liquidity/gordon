import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../MessageBubble.js";

// Risk classifier result: 11 dimensions, pass/fail with score
export function RiskCheckMessage({ message }: { message: Message }) {
  const isPassing = message.content.includes("PASS") || message.content.includes("approved") || message.content.includes("pass");
  const icon = isPassing ? "\u2713" : "\u2717";
  const color = isPassing ? "green" : "red";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={color}>{icon} </Text>
        <Text bold color={color}>RISK CHECK</Text>
      </Box>
      <Box paddingLeft={2} flexDirection="column">
        {message.content.split("\n").map((line, i) => {
          // Color individual dimension results
          const isPass = line.includes("\u2713") || line.includes("pass") || line.includes("ok");
          const isFail = line.includes("\u2717") || line.includes("fail") || line.includes("block");
          return (
            <Text key={i} color={isFail ? "red" : isPass ? "green" : undefined} dimColor={!isFail && !isPass}>
              {line}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
