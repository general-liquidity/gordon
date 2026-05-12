import React from "react";
import { Box, Text } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

export interface ExchangeOrder {
  exchange: string;
  endpoint: string;
  method: "POST" | "DELETE" | "PUT";
  payload: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit" | "stop" | "stop_limit";
    quantity: number;
    price?: number;
    stopPrice?: number;
    timeInForce?: "GTC" | "IOC" | "FOK";
  };
  estimatedFee: number;
  estimatedSlippage: number;
}

interface Props {
  order: ExchangeOrder;
}

export function DryRunPreview({ order }: Props) {
  const p = order.payload;
  const sideColor = p.side === "buy" ? "green" : "red";

  return (
    <Pane title="DRY RUN — ORDER PREVIEW" color="yellow">
      <Box flexDirection="column">
        <Box><Text dimColor>Exchange:    </Text><Text bold>{order.exchange}</Text></Box>
        <Box><Text dimColor>Endpoint:    </Text><Text>{order.method} {order.endpoint}</Text></Box>
        <Box marginTop={1}>
          <Text dimColor bold>REQUEST BODY</Text>
        </Box>
        <Box><Text dimColor>  symbol:       </Text><Text bold>{p.symbol}</Text></Box>
        <Box><Text dimColor>  side:         </Text><Text bold color={sideColor}>{p.side.toUpperCase()}</Text></Box>
        <Box><Text dimColor>  type:         </Text><Text bold>{p.type}</Text></Box>
        <Box><Text dimColor>  quantity:     </Text><Text bold>{p.quantity}</Text></Box>
        {p.price !== undefined && <Box><Text dimColor>  price:        </Text><Text bold>${p.price.toFixed(2)}</Text></Box>}
        {p.stopPrice !== undefined && <Box><Text dimColor>  stopPrice:    </Text><Text bold>${p.stopPrice.toFixed(2)}</Text></Box>}
        {p.timeInForce && <Box><Text dimColor>  timeInForce:  </Text><Text bold>{p.timeInForce}</Text></Box>}
        <Box marginTop={1}>
          <Text dimColor>Est. fee:     </Text><Text color="yellow">${order.estimatedFee.toFixed(2)}</Text>
        </Box>
        <Box>
          <Text dimColor>Est. slippage: </Text><Text color="yellow">${order.estimatedSlippage.toFixed(2)}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor italic>This is exactly what will be sent. No modifications.</Text>
        </Box>
      </Box>
    </Pane>
  );
}
