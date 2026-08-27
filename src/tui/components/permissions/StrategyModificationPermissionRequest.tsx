import { Box, Text } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";
import { Divider } from "../layout/Divider.tsx";

// ============================================================================
// StrategyModificationPermissionRequest — Shows a field-level diff of strategy
// changes and asks for approval.
//
// High-risk: bordered box. Otherwise: dividers.
// from values: dimColor | → gray | to values: cyanBright
// ============================================================================

interface FieldChange {
  field: string;
  from: string;
  to: string;
}

interface Props {
  strategyName: string;
  changes: FieldChange[];
  onDecision: (d: "approve" | "deny") => void;
}

const OPTIONS = [
  { label: "Approve", value: "approve" },
  { label: "Deny", value: "deny" },
];

function ChangeList({ changes }: { changes: FieldChange[] }) {
  // Compute column widths for alignment
  const maxField = Math.max(...changes.map((c) => c.field.length));
  const maxFrom = Math.max(...changes.map((c) => c.from.length));

  return (
    <>
      {changes.map((change) => (
        <Box key={change.field} paddingLeft={2}>
          <Text dimColor>{change.field.padEnd(maxField + 2)}</Text>
          <Text dimColor>{change.from.padEnd(maxFrom + 2)}</Text>
          <Text color="gray">
            {"→"}
            {"  "}
          </Text>
          <Text color="cyanBright" bold>
            {change.to}
          </Text>
        </Box>
      ))}
    </>
  );
}

export function StrategyModificationPermissionRequest({
  strategyName,
  changes,
  onDecision,
}: Props) {
  const isHighRisk = changes.length > 3;

  const content = (
    <>
      <Text color="yellow" bold>
        {"⚠"} STRATEGY MODIFICATION REQUEST
      </Text>
      <Text> </Text>
      <Text>
        {"  "}Gordon wants to modify strategy:{" "}
        <Text bold color="cyanBright">
          {strategyName}
        </Text>
      </Text>
      <Text> </Text>
      <ChangeList changes={changes} />
      <Text> </Text>
      <Box paddingLeft={2}>
        <Select options={OPTIONS} onChange={(v) => onDecision(v as "approve" | "deny")} />
      </Box>
    </>
  );

  if (isHighRisk) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
          {content}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Divider />
      <Box paddingX={2} flexDirection="column">
        {content}
      </Box>
      <Divider />
    </Box>
  );
}
