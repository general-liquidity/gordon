import React from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";

// Exit flow — graceful exit with session save + position warnings
interface Props {
  openPositionCount: number;
  autonomousActive: boolean;
  onSaveAndExit: () => void;
  onExitWithoutSave: () => void;
  onCancel: () => void;
}

export function ExitFlow({ openPositionCount, autonomousActive, onSaveAndExit, onExitWithoutSave, onCancel }: Props) {
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  const warnings: string[] = [];
  if (openPositionCount > 0) warnings.push(`${openPositionCount} open position${openPositionCount !== 1 ? "s" : ""} — they will remain on the exchange`);
  if (autonomousActive) warnings.push("Autonomous loop is running — it will stop on exit");

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Exit Gordon?</Text>
      {warnings.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {warnings.map((w, i) => (
            <Text key={i} color="yellow">{"\u26A0"} {w}</Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Select
          options={[
            { label: "Save session and exit", value: "save" },
            { label: "Exit without saving", value: "exit" },
            { label: "Cancel — stay in Gordon", value: "cancel" },
          ]}
          onChange={(v) => {
            if (v === "save") onSaveAndExit();
            else if (v === "exit") onExitWithoutSave();
            else onCancel();
          }}
        />
      </Box>
    </Box>
  );
}
