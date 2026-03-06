import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";

import { COLORS } from "./theme.ts";
import { collectDoctorReport, formatDoctorReport, type DoctorReport } from "./setup-runtime.ts";

interface DoctorPanelProps {
  onComplete: () => void;
}

export function DoctorPanel({ onComplete }: DoctorPanelProps): React.ReactElement {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void collectDoctorReport()
      .then((nextReport) => {
        if (mounted) setReport(nextReport);
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useInput((input, key) => {
    if (report && (input || key.return || key.escape)) {
      onComplete();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text color={COLORS.ACCENT} bold>
          Gordon Doctor
        </Text>
      </Box>

      {!report && !error && (
        <Text color={COLORS.DIM}>Collecting configuration and provider diagnostics...</Text>
      )}

      {error && (
        <Box borderStyle="single" borderColor="red" paddingX={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {report && (
        <>
          <Text>{formatDoctorReport(report)}</Text>
          <Box marginTop={1}>
            <Text color={COLORS.DIM}>Press any key to return.</Text>
          </Box>
        </>
      )}
    </Box>
  );
}

export default DoctorPanel;
