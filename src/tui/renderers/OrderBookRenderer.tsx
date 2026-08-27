import { Box, Text } from "../ink-custom";
import { fmtNum } from "../components/charts/DataTable.tsx";

/**
 * OrderBookRenderer -- Bid/ask depth view
 * Phase 10: Asks (red, reversed) + spread line + bids (green)
 */

interface Level {
  price: number;
  size: number;
}

interface OrderBookData {
  bids: Level[];
  asks: Level[];
  spread: number;
  midPrice: number;
}

interface Props {
  data: OrderBookData;
}

export function OrderBookRenderer({ data }: Props) {
  // Show up to 8 levels each side
  // Asks reversed so lowest ask is nearest the spread line
  const asks = data.asks.slice(0, 8).reverse();
  const bids = data.bids.slice(0, 8);

  // Find max size for bar scaling
  const allSizes = [...asks, ...bids].map((l) => l.size);
  const maxSize = Math.max(...allSizes, 1);
  const barWidth = 20;

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      {/* Asks (red, reversed -- lowest ask at bottom) */}
      {asks.map((level, i) => (
        <Box key={`ask-${i}`}>
          <Box width={12} justifyContent="flex-end">
            <Text color="red">{fmtNum(level.price)}</Text>
          </Box>
          <Text> </Text>
          <Box width={10} justifyContent="flex-end">
            <Text dimColor>{fmtNum(level.size)}</Text>
          </Box>
          <Text> </Text>
          <Text color="red">{sizeBar(level.size, maxSize, barWidth)}</Text>
        </Box>
      ))}

      {/* Spread line */}
      <Box marginY={0}>
        <Box width={12} justifyContent="flex-end">
          <Text bold color="yellow">
            {fmtNum(data.midPrice)}
          </Text>
        </Box>
        <Text> </Text>
        <Text dimColor>spread {fmtNum(data.spread)}</Text>
      </Box>

      {/* Bids (green -- highest bid at top) */}
      {bids.map((level, i) => (
        <Box key={`bid-${i}`}>
          <Box width={12} justifyContent="flex-end">
            <Text color="green">{fmtNum(level.price)}</Text>
          </Box>
          <Text> </Text>
          <Box width={10} justifyContent="flex-end">
            <Text dimColor>{fmtNum(level.size)}</Text>
          </Box>
          <Text> </Text>
          <Text color="green">{sizeBar(level.size, maxSize, barWidth)}</Text>
        </Box>
      ))}
    </Box>
  );
}

function sizeBar(size: number, maxSize: number, width: number): string {
  const filled = Math.max(1, Math.round((size / maxSize) * width));
  return "\u2588".repeat(filled);
}
