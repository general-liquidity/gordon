import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// ============================================================================
// BootScreen — Full ASCII art, centered, NO flicker
//
// The logo is memoized so it never re-renders.
// Only the "Press Enter" blink causes a re-render, and it's a single line.
// ============================================================================

interface Props {
  onReady: () => void;
}

// Memoized logo component — renders once, never updates
const LogoDisplay = React.memo(function LogoDisplay({ lines }: { lines: string[] }) {
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
});

export function BootScreen({ onReady }: Props) {
  const { stdout } = useStdout();
  const termW = stdout?.columns ?? 100;
  const [logoLines, setLogoLines] = useState<string[] | null>(null);
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    readFile(resolve(process.cwd(), "gordon-ascii.txt"), "utf8")
      .then((content) => {
        const raw = content.split("\n");
        const nonEmpty = raw.filter((l) => l.trim().length > 0);
        const minIndent = Math.min(
          ...nonEmpty.map((l) => l.match(/^(\s*)/)?.[1]?.length ?? 0)
        );
        const stripped = raw.map((l) => l.slice(minIndent));
        const blockW = Math.max(...stripped.map((l) => l.length));
        const blockPad = Math.max(0, Math.floor((termW - blockW) / 2));
        const padding = " ".repeat(blockPad);
        setLogoLines(stripped.map((line) => padding + line));
      })
      .catch(() => setLogoLines(["GORDON"]));
  }, [termW]);

  useEffect(() => {
    const interval = setInterval(() => setBlink((b) => !b), 800);
    return () => clearInterval(interval);
  }, []);

  useInput((_, key) => {
    if (key.return) {
      process.stdout.write("\x1B[2J\x1B[H");
      onReady();
    }
  });

  if (!logoLines) {
    return <Text>Loading...</Text>;
  }

  return (
    <Box flexDirection="column">
      <LogoDisplay lines={logoLines} />
      <Box justifyContent="center" marginTop={1}>
        <Text color={blink ? "cyanBright" : "gray"} bold={blink}>
          Press Enter to start
        </Text>
      </Box>
    </Box>
  );
}
