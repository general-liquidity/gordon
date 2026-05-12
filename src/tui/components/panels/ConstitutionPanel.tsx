import React from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

// ============================================================================
// ConstitutionPanel — Trading constitution compliance detail view
//
// Shows all 10 constitution layers with pass/fail per rule.
// Displays which rules blocked a trade and why.
// ============================================================================

export interface ConstitutionCheckResult {
  layer: string;
  rules: Array<{
    name: string;
    passed: boolean;
    value?: string;
    limit?: string;
    reason?: string;
  }>;
}

interface Props {
  results: ConstitutionCheckResult[];
  blockedCount: number;
  passedCount: number;
  onClose: () => void;
}

export function ConstitutionPanel({ results, blockedCount, passedCount, onClose }: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  const totalRules = blockedCount + passedCount;
  const allPassed = blockedCount === 0;

  return (
    <Pane title="TRADING CONSTITUTION" color={allPassed ? "green" : "red"}>
      {/* Summary */}
      <Box>
        <Text color={allPassed ? "green" : "red"} bold>
          {allPassed ? "\u2713" : "\u2717"} {passedCount}/{totalRules} rules passed
        </Text>
        {blockedCount > 0 && (
          <Text color="red"> {"\u00b7"} {blockedCount} blocked</Text>
        )}
      </Box>
      <Text> </Text>

      {/* Per-layer breakdown */}
      {results.map((layer, i) => {
        const layerFails = layer.rules.filter((r) => !r.passed);
        const layerColor = layerFails.length > 0 ? "red" : "green";
        const layerIcon = layerFails.length > 0 ? "\u2717" : "\u2713";

        return (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={layerColor} bold>{layerIcon} {layer.layer.toUpperCase()}</Text>
              <Text dimColor> ({layer.rules.length} rules)</Text>
            </Box>

            {/* Only show failed rules (or all if few) */}
            {(layerFails.length > 0 ? layerFails : layer.rules.slice(0, 3)).map((rule, j) => (
              <Box key={j} paddingLeft={2}>
                <Text color={rule.passed ? "green" : "red"}>
                  {rule.passed ? "\u2713" : "\u2717"}
                </Text>
                <Text dimColor={rule.passed}> {rule.name}</Text>
                {rule.value && rule.limit && (
                  <Text dimColor> ({rule.value} / {rule.limit})</Text>
                )}
                {!rule.passed && rule.reason && (
                  <Text color="red"> {"\u2014"} {rule.reason}</Text>
                )}
              </Box>
            ))}
            {layerFails.length === 0 && layer.rules.length > 3 && (
              <Box paddingLeft={2}>
                <Text dimColor>  +{layer.rules.length - 3} more (all passing)</Text>
              </Box>
            )}
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}
