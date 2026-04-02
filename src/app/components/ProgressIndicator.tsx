import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";

import { COLORS } from "../theme.ts";
import { DeskPanel } from "./desk/DeskPanel.tsx";
import { OrbitalBoot } from "./effects/OrbitalBoot.tsx";

export function useOperationTimer(active: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => clearInterval(interval);
  }, [active]);

  return elapsedMs;
}

export const ProgressIndicator: React.FC<{
  label: string;
  status?: string;
}> = ({ label, status }) => {
  const elapsedMs = useOperationTimer(true);
  const panelWidth = Math.max(88, Math.min((process.stdout.columns ?? 120) - 6, 132));

  const elapsedLabel = useMemo(() => `${(elapsedMs / 1000).toFixed(1)}s`, [elapsedMs]);

  return (
    <Box flexGrow={1} justifyContent="center" alignItems="center">
      <Box width={panelWidth}>
        <DeskPanel eyebrow="Boot" title={label} subtitle={status} tone="brand">
          <OrbitalBoot
            compact
            title="General Liquidity orbital"
            subtitle="Initializing interlocks, rails, and live routing."
            intervalMs={220}
          />
          <Text color={COLORS.DIM}>elapsed {elapsedLabel}</Text>
        </DeskPanel>
      </Box>
    </Box>
  );
};

export const ScanProgress: React.FC<{ status?: string }> = ({ status }) => (
  <ProgressIndicator label="Scanning market" status={status ?? "Building shortlist and signal context."} />
);

export const OrderProgress: React.FC<{ status?: string }> = ({ status }) => (
  <ProgressIndicator label="Routing order" status={status ?? "Preparing execution rail."} />
);

export const StreamingProgress: React.FC<{ status?: string }> = ({ status }) => (
  <ProgressIndicator label="Live inference" status={status ?? "Streaming Gordon response."} />
);
