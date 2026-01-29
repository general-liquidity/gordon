import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { COLORS } from "./theme.ts";

// Gordon Gekko quotes
const GEKKO_QUOTES = [
  "The most valuable commodity I know of is information.",
  "Greed, for lack of a better word, is good.",
  "Money never sleeps.",
  "I don't throw darts at a board. I bet on sure things.",
  "What's worth doing is worth doing for money.",
] as const;

// ASCII art banner (block letters)
const ASCII_BANNER = `
 ██████╗  ██████╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗
██╔════╝ ██╔═══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║
██║  ███╗██║   ██║██████╔╝██║  ██║██║   ██║██╔██╗ ██║
██║   ██║██║   ██║██╔══██╗██║  ██║██║   ██║██║╚██╗██║
╚██████╔╝╚██████╔╝██║  ██║██████╔╝╚██████╔╝██║ ╚████║
 ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝
`.trim();

// Unicode fallback (simpler ASCII if terminal doesn't support box-drawing)
const UNICODE_FALLBACK = `
  ____  ___  ____  ____   ___  _   _
 / ___|/ _ \\|  _ \\|  _ \\ / _ \\| \\ | |
| |  _| | | | |_) | | | | | | |  \\| |
| |_| | |_| |  _ <| |_| | |_| | |\\  |
 \\____|\\___/|_| \\_\\____/ \\___/|_| \\_|
`.trim();

// Feature bullets
const FEATURES = [
  "AI-powered market analysis",
  "Support/resistance detection",
  "Risk-managed trade plans",
  "Human-in-the-loop execution",
] as const;

interface WelcomeBannerProps {
  useUnicodeFallback?: boolean;
}

export const WelcomeBanner: React.FC<WelcomeBannerProps> = ({
  useUnicodeFallback = false,
}) => {
  // Select random quote on mount
  const randomQuote = useMemo(() => {
    const index = Math.floor(Math.random() * GEKKO_QUOTES.length);
    return GEKKO_QUOTES[index];
  }, []);

  const banner = useUnicodeFallback ? UNICODE_FALLBACK : ASCII_BANNER;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* ASCII Art Banner */}
      <Box flexDirection="column">
        {banner.split("\n").map((line, i) => (
          <Text key={i} color={COLORS.TAN}>
            {line}
          </Text>
        ))}
      </Box>

      {/* Tagline */}
      <Box marginTop={1}>
        <Text color={COLORS.WHITE} bold>
          Claude Code for Vibe Trading
        </Text>
      </Box>

      {/* Version */}
      <Box>
        <Text color={COLORS.DIM}>v1.0.0</Text>
      </Box>

      {/* Gekko Quote */}
      <Box marginTop={1} paddingX={1}>
        <Text color={COLORS.TAN_DIM} italic>
          "{randomQuote}"
        </Text>
      </Box>

      {/* Feature bullets */}
      <Box flexDirection="column" marginTop={1}>
        {FEATURES.map((feature, i) => (
          <Box key={i}>
            <Text color={COLORS.DIM}>  - </Text>
            <Text color={COLORS.WHITE}>{feature}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default WelcomeBanner;
