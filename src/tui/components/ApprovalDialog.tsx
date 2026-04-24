import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "../ink-custom";
import { GordonSelect as Select } from "../design-system/GordonSelect.js";
import { Divider } from "./Divider.js";

// ============================================================================
// ApprovalDialog — Per-action approval (Claude Code permission dialog style)
//
// Standard (low/medium): Inline with dividers, no borders
// High: Bordered box with full details
// Critical: Bordered + 3-second countdown
// ============================================================================

export interface ApprovalRequest {
  id: string;
  shortId: string;
  toolName: string;
  permissionScope: string;
  riskClass: "low" | "medium" | "high" | "critical";
  sideEffectLevel: string;
  reason?: string;
}

interface Props {
  approval: ApprovalRequest;
  onDecision: (decision: "always" | "once" | "deny", approvalId: string) => void;
}

export function ApprovalDialog({ approval, onDecision }: Props) {
  if (approval.riskClass === "critical") {
    return <CriticalApproval approval={approval} onDecision={onDecision} />;
  }
  if (approval.riskClass === "high") {
    return <HighApproval approval={approval} onDecision={onDecision} />;
  }
  return <StandardApproval approval={approval} onDecision={onDecision} />;
}

// ── Standard (low/medium) — dividers, no borders ──

function StandardApproval({ approval, onDecision }: Props) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Divider />
      <Box paddingX={2} flexDirection="column">
        <Box>
          <Text color="yellow" bold>{"\u26A0"} APPROVAL [{approval.shortId}]</Text>
        </Box>
        <Text>  Gordon wants to use <Text bold color="cyanBright">`{approval.toolName}`</Text></Text>
        <Box>
          <Text dimColor>  Scope: {approval.permissionScope}</Text>
          <Text dimColor> {"\u00b7"} </Text>
          <Text color={approval.riskClass === "medium" ? "yellow" : "green"} bold>
            Risk: {approval.riskClass.toUpperCase()}
          </Text>
        </Box>
        <Text> </Text>
        <Box paddingLeft={2}>
          <Select
            options={[
              { label: "Allow this time", value: "once" },
              { label: "Always allow this tool", value: "always" },
              { label: "Deny", value: "deny" },
            ]}
            onChange={(v) => onDecision(v as "always" | "once" | "deny", approval.id)}
          />
        </Box>
      </Box>
      <Divider />
    </Box>
  );
}

// ── High risk — bordered box ──

function HighApproval({ approval, onDecision }: Props) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="red"
        paddingX={2}
        paddingY={1}
      >
        <Box>
          <Text color="red" bold>{"\u26A0"} HIGH RISK APPROVAL [{approval.shortId}]</Text>
        </Box>
        <Text> </Text>
        <Text>  Tool: <Text bold color="cyanBright">{approval.toolName}</Text></Text>
        <Text>  Scope: <Text dimColor>{approval.permissionScope}</Text></Text>
        <Text>  Effect: <Text color="yellow">{approval.sideEffectLevel}</Text></Text>
        {approval.reason && <Text dimColor>  {approval.reason}</Text>}
        <Text> </Text>
        <Text color="red">  This action has significant side effects. Review carefully.</Text>
        <Text> </Text>
        <Box paddingLeft={2}>
          <Select
            options={[
              { label: "Allow this time", value: "once" },
              { label: "Always allow this tool", value: "always" },
              { label: "Deny", value: "deny" },
            ]}
            onChange={(v) => onDecision(v as "always" | "once" | "deny", approval.id)}
          />
        </Box>
      </Box>
    </Box>
  );
}

// ── Critical — bordered + countdown ──

function CriticalApproval({ approval, onDecision }: Props) {
  const [countdown, setCountdown] = useState(3);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (countdown <= 0) { setUnlocked(true); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useInput((_, key) => {
    if (key.escape) onDecision("deny", approval.id);
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor="red"
        paddingX={2}
        paddingY={1}
      >
        <Box>
          <Text color="red" bold inverse>{" CRITICAL "}</Text>
          <Text color="red" bold> APPROVAL [{approval.shortId}]</Text>
        </Box>
        <Text> </Text>
        <Text>  Tool: <Text bold color="cyanBright">{approval.toolName}</Text></Text>
        <Text>  Scope: <Text dimColor>{approval.permissionScope}</Text></Text>
        <Text>  Effect: <Text color="red" bold>{approval.sideEffectLevel}</Text></Text>
        {approval.reason && <Text dimColor>  {approval.reason}</Text>}
        <Text> </Text>
        <Text color="red" bold>  {"\u26A0"} CRITICAL — This action may be irreversible.</Text>
        <Text> </Text>
        {!unlocked ? (
          <Text dimColor>  Confirm available in {countdown}s... (Esc to deny)</Text>
        ) : (
          <Box paddingLeft={2}>
            <Select
              options={[
                { label: "CONFIRM (CRITICAL)", value: "once" },
                { label: "DENY", value: "deny" },
              ]}
              onChange={(v) => onDecision(v as "once" | "deny", approval.id)}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
