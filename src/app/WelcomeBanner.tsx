import React, { useMemo, useState, useEffect } from "react";
import { Box, Text } from "ink";
import { COLORS } from "./theme.ts";

// Import version from package.json
import packageJson from "../../package.json";

// Gordon Gekko quotes
const GEKKO_QUOTES = [
  "The most valuable commodity I know of is information.",
  "Greed, for lack of a better word, is good.",
  "Money never sleeps.",
  "I don't throw darts at a board. I bet on sure things.",
  "What's worth doing is worth doing for money.",
] as const;

// ASCII art banner (Tilde style with $ for trading theme)
const ASCII_BANNER = `
e$$~~\\                        \\$$$
d$$$      e$$~-_  $$$-~\\  e$$~\\$$$  e$$~-_  $$$-~$$e
$$$$ __  d$$$   i $$$    d$$$  $$$ d$$$   i $$$  $$$
$$$$   | $$$$   | $$$    $$$$  $$$ $$$$   | $$$  $$$
Y$$$   | Y$$$   | $$$    Y$$$  $$$ Y$$$   | $$$  $$$
 "$$__/   "$$_-~  $$$     "$$_/$$$  "$$_-~  $$$  $$$
`.trim();

// Feature bullets
const FEATURES = [
  "AI-powered market analysis",
  "Support/resistance detection",
  "Risk-managed trade plans",
  "Human-in-the-loop execution",
] as const;

// Create 3D composite: main text with shadow offset down-right by 1
const create3DComposite = (lines: string[]): { main: string; shadow: string }[] => {
  const maxLen = Math.max(...lines.map((l) => l.length)) + 1; // +1 for shadow offset
  const result: { main: string; shadow: string }[] = [];

  // Pad all lines to same length
  const paddedLines = lines.map((l) => l.padEnd(maxLen, " "));

  // First line: just main text with leading space (shadow offset)
  result.push({
    main: " " + paddedLines[0],
    shadow: " ".repeat(maxLen + 1),
  });

  // Middle lines: composite main text with shadow from previous line
  for (let i = 1; i < paddedLines.length; i++) {
    const mainLine = " " + paddedLines[i];
    // Shadow is previous line shifted right by 1
    const shadowLine = " " + paddedLines[i - 1];
    result.push({ main: mainLine, shadow: shadowLine });
  }

  // Last row: just shadow from last line
  result.push({
    main: " ".repeat(maxLen + 1),
    shadow: " " + paddedLines[paddedLines.length - 1],
  });

  return result;
};

// Render a single character with appropriate color (main or shadow)
const Char3D: React.FC<{
  mainChar: string;
  shadowChar: string;
  isGlitch: boolean;
  flickerState: string;
}> = ({ mainChar, shadowChar, isGlitch, flickerState }) => {
  const isMainVisible = mainChar !== " ";
  const isShadowVisible = shadowChar !== " ";

  // Main character takes precedence
  if (isMainVisible) {
    const isDollar = mainChar === "$";
    let color: string = isDollar ? COLORS.GREEN : COLORS.WHITE;

    if (flickerState === "dim") {
      color = COLORS.MUTED;
    } else if (flickerState === "bright") {
      color = isDollar ? COLORS.HIGHLIGHT : COLORS.WHITE;
    }

    const displayChar = isGlitch && isDollar && Math.random() > 0.7 ? "¤" : mainChar;
    return <Text color={color}>{displayChar}</Text>;
  }

  // Show shadow if no main character
  if (isShadowVisible) {
    return <Text color={COLORS.MUTED}>░</Text>;
  }

  // Empty space
  return <Text> </Text>;
};

// Render a line with 3D effect
const Line3D: React.FC<{
  main: string;
  shadow: string;
  isGlitch: boolean;
  flickerState: string;
}> = ({ main, shadow, isGlitch, flickerState }) => {
  const chars: React.ReactNode[] = [];
  const len = Math.max(main.length, shadow.length);

  for (let i = 0; i < len; i++) {
    chars.push(
      <Char3D
        key={i}
        mainChar={main[i] || " "}
        shadowChar={shadow[i] || " "}
        isGlitch={isGlitch}
        flickerState={flickerState}
      />
    );
  }

  return <Text>{chars}</Text>;
};

// Flicker animation component for the ASCII banner with 3D effect
const FlickeringBanner: React.FC = () => {
  const [flickerState, setFlickerState] = useState<"normal" | "dim" | "bright">("normal");
  const [glitchLine, setGlitchLine] = useState<number | null>(null);

  useEffect(() => {
    // Random flicker effect
    const flickerInterval = setInterval(() => {
      const rand = Math.random();
      if (rand < 0.05) {
        setFlickerState("dim");
        setTimeout(() => setFlickerState("normal"), 50);
      } else if (rand < 0.08) {
        setFlickerState("bright");
        setTimeout(() => setFlickerState("normal"), 30);
      }
    }, 150);

    // Random line glitch effect
    const glitchInterval = setInterval(() => {
      if (Math.random() < 0.1) {
        const lineIndex = Math.floor(Math.random() * 6);
        setGlitchLine(lineIndex);
        setTimeout(() => setGlitchLine(null), 80);
      }
    }, 300);

    return () => {
      clearInterval(flickerInterval);
      clearInterval(glitchInterval);
    };
  }, []);

  const lines = ASCII_BANNER.split("\n");
  const compositeLines = create3DComposite(lines);

  return (
    <Box flexDirection="column">
      {compositeLines.map((line, i) => (
        <Line3D
          key={`banner-line-${i}`}
          main={line.main}
          shadow={line.shadow}
          isGlitch={glitchLine === i || glitchLine === i - 1}
          flickerState={flickerState}
        />
      ))}
    </Box>
  );
};

export const WelcomeBanner: React.FC = () => {
  // Select random quote on mount
  const randomQuote = useMemo(() => {
    const index = Math.floor(Math.random() * GEKKO_QUOTES.length);
    return GEKKO_QUOTES[index];
  }, []);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* ASCII Art Banner with flicker animation */}
      <FlickeringBanner />

      {/* Tagline */}
      <Box marginTop={1}>
        <Text color={COLORS.WHITE} bold>
          Claude Code for Vibe Trading
        </Text>
      </Box>

      {/* Version */}
      <Box>
        <Text color={COLORS.DIM}>v{packageJson.version}</Text>
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
          <Box key={`feature-${i}`}>
            <Text color={COLORS.DIM}>  - </Text>
            <Text color={COLORS.WHITE}>{feature}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default WelcomeBanner;
