import { Box, Text } from "../../ink-custom";

// ============================================================================
// TrailingStopDisplay — Live position with updating trailing stop
//
// Shows current price, stop level, distance (% and $), trail amount,
// and a progress bar from stop to invalidation.
//
// ┌─ AAPL LONG trailing stop ─────────────────────┐
// │ price: $192.45   stop: $189.20   trail: $3.00  │
// │ distance: $3.25 (1.69%)                        │
// │ ████████████████░░░░ 69% from stop             │
// └────────────────────────────────────────────────┘
// ============================================================================

interface Props {
  symbol: string;
  currentPrice: number;
  stopLevel: number;
  trailAmount: number;
  /** "long" = stop below price; "short" = stop above price */
  side: "long" | "short";
}

const BAR_WIDTH = 24;

export function TrailingStopDisplay({ symbol, currentPrice, stopLevel, trailAmount, side }: Props) {
  // Distance from current price to stop level
  const distanceDollar = Math.abs(currentPrice - stopLevel);
  const distancePct = (distanceDollar / currentPrice) * 100;

  // Ratio: how much of the trail is "used" (1.0 = at stop, 0.0 = full distance)
  // For a long: price falls toward stop => ratio rises
  // For a short: price rises toward stop => ratio rises
  const maxDistance = trailAmount;
  const safeRatio = maxDistance > 0 ? Math.min(1, Math.max(0, distanceDollar / maxDistance)) : 0;

  // Color logic: far from stop = green, close = red
  const approaching = safeRatio < 0.35;
  const accentColor = approaching ? "red" : "green";
  const borderColor = approaching ? "yellow" : "gray";

  // Progress bar — filled portion = remaining distance (safe zone)
  const filledCount = Math.round(safeRatio * BAR_WIDTH);
  const emptyCount = BAR_WIDTH - filledCount;
  const filledBar = "\u2588".repeat(filledCount);
  const emptyBar = "\u2591".repeat(emptyCount);

  const sideLabel = side.toUpperCase();

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
      {/* Header */}
      <Box>
        <Text bold color={accentColor}>
          {symbol} {sideLabel}
        </Text>
        <Text dimColor> trailing stop</Text>
      </Box>

      {/* Price / Stop / Trail row */}
      <Box marginTop={1}>
        <Text>price: </Text>
        <Text bold>${currentPrice.toFixed(2)}</Text>
        <Text dimColor> stop: </Text>
        <Text bold color={accentColor}>
          ${stopLevel.toFixed(2)}
        </Text>
        <Text dimColor> trail: </Text>
        <Text>${trailAmount.toFixed(2)}</Text>
      </Box>

      {/* Distance row */}
      <Box>
        <Text>distance: </Text>
        <Text color={accentColor} bold>
          ${distanceDollar.toFixed(2)} ({distancePct.toFixed(2)}%)
        </Text>
      </Box>

      {/* Progress bar */}
      <Box marginTop={1}>
        <Text color={accentColor}>{filledBar}</Text>
        <Text dimColor>{emptyBar}</Text>
        <Text dimColor> {Math.round(safeRatio * 100)}% from stop</Text>
      </Box>
    </Box>
  );
}
