import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";

import { DeskPanel } from "./components/desk/DeskPanel.tsx";
import { TicketCard } from "./components/desk/TicketCard.tsx";
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
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <DeskPanel
        eyebrow="Diagnostics"
        title="Gordon Doctor"
        subtitle="Configuration, venue, provider, and runtime health for the current desk."
        tone={error ? "danger" : report ? "info" : "brand"}
      >
        {!report && !error && (
          <TicketCard
            eyebrow="Scan"
            title="Collecting desk diagnostics"
            subtitle="Checking providers, configuration, and local runtime state."
            tone="info"
            actions={["Return when ready: Any key"]}
          />
        )}

        {error && (
          <TicketCard
            eyebrow="Failure"
            title="Doctor scan failed"
            subtitle={error}
            tone="danger"
            actions={["Return: Any key"]}
          />
        )}

        {report && (
          <Box flexDirection="column" gap={1}>
            <TicketCard
              eyebrow="Report"
              title="Desk health snapshot"
              subtitle="Review the current environment before returning to the main desk."
              tone="info"
              actions={["Return: Any key"]}
            >
              <Text>{formatDoctorReport(report)}</Text>
            </TicketCard>
            <Text color={COLORS.DIM}>Press any key to return.</Text>
          </Box>
        )}
      </DeskPanel>
    </Box>
  );
}

export default DoctorPanel;
