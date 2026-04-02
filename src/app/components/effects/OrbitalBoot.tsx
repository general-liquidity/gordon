import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { COLORS } from "../../theme.ts";

const ORBITAL_FRAMES = [
  [
    "           .-====-.           ",
    "       .-==*######*==-..      ",
    "     .-==##*-    -*##==-..    ",
    "    :=*##-   GORDON   -##*=:  ",
    "    :=*##-  liquidity  -##*=: ",
    "     .-==##*-    -*##==-..    ",
    "       .-==*######*==-..      ",
    "           '-====-'           ",
  ],
  [
    "           .-====-.           ",
    "      ..-==*######*==-..      ",
    "    ..-==##*-    -*##==-..    ",
    "   :=*##-   GORDON   -##*=:   ",
    "   :=*##- execution  -##*=:   ",
    "    ..-==##*-    -*##==-..    ",
    "      ..-==*######*==-..      ",
    "           '-====-'           ",
  ],
  [
    "           .-====-.           ",
    "      ..-==*######*==-..      ",
    "    ..-==##*-    -*##==-..    ",
    "   :=*##-   GORDON   -##*=:   ",
    "   :=*##-  risk map   -##*=:  ",
    "    ..-==##*-    -*##==-..    ",
    "      ..-==*######*==-..      ",
    "           '-====-'           ",
  ],
  [
    "           .-====-.           ",
    "      ..-==*######*==-..      ",
    "    ..-==##*-    -*##==-..    ",
    "   :=*##-   GORDON   -##*=:   ",
    "   :=*##- market tape -##*=:  ",
    "    ..-==##*-    -*##==-..    ",
    "      ..-==*######*==-..      ",
    "           '-====-'           ",
  ],
];

interface OrbitalBootProps {
  compact?: boolean;
  title?: string;
  subtitle?: string;
  intervalMs?: number;
}

export function OrbitalBoot({
  compact = false,
  title = "Orbital boot",
  subtitle = "Initializing the Gordon trading stack.",
  intervalMs = 280,
}: OrbitalBootProps): React.ReactElement {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % ORBITAL_FRAMES.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  const frame = useMemo(() => {
    const selectedFrame = ORBITAL_FRAMES[frameIndex] ?? ORBITAL_FRAMES[0] ?? [];
    if (!compact) {
      return selectedFrame;
    }
    return selectedFrame.map((line) => line.slice(4, Math.max(4, line.length - 4)));
  }, [compact, frameIndex]);

  return (
    <Box flexDirection="column">
      <Text color={COLORS.BRASS} bold>{title}</Text>
      {frame.map((line, index) => (
        <Text
          key={`${frameIndex}-${index}`}
          color={index === 3 || index === 4 ? COLORS.MONEY : COLORS.BRASS}
        >
          {line}
        </Text>
      ))}
      <Text color={COLORS.DIM}>{subtitle}</Text>
    </Box>
  );
}

export default OrbitalBoot;
