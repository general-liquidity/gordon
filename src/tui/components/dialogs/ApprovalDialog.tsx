import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";
import { Divider } from "../layout/Divider.tsx";

// ============================================================================
// ApprovalDialog — Per-action approval (Claude Code permission dialog style)
//
// Standard (low/medium): Inline with dividers, no borders
// High: Bordered box with full details
// Critical: Bordered + 3-second countdown
// ============================================================================

/** Risk-kernel size-adjusted alternative to the original order. */
export interface ApprovalCounterOffer {
  symbol: string;
  side: "buy" | "sell";
  originalQuantity: number;
  adjustedQuantity: number;
}

/** Risk-kernel verdict details threaded into the approval payload. */
export interface ApprovalRiskDetails {
  riskReasons: string[];
  counterOffer?: ApprovalCounterOffer;
}

export interface ApprovalRequest {
  id: string;
  shortId: string;
  toolName: string;
  permissionScope: string;
  riskClass: "low" | "medium" | "high" | "critical";
  sideEffectLevel: string;
  reason?: string;
  /** Plain-language reasons from the risk kernel (top 3, pre-truncated). */
  riskReasons?: string[];
  counterOffer?: ApprovalCounterOffer;
}

export type ApprovalDecision = "always" | "once" | "deny" | "modify";

interface Props {
  approval: ApprovalRequest;
  onDecision: (decision: ApprovalDecision, approvalId: string) => void;
}

const MAX_VISIBLE_REASONS = 3;

/**
 * Build the decision options for an approval. Counter-offer (when the risk
 * kernel computed a size that fits limits) is listed FIRST — it is the safe
 * default. Approving the original stays available because the request is
 * still in "pending" (not blocked) state. Critical approvals never offer
 * "always".
 */
export function buildApprovalOptions(
  approval: Pick<ApprovalRequest, "counterOffer">,
  opts: { critical?: boolean } = {},
): Array<{ label: string; value: ApprovalDecision }> {
  const options: Array<{ label: string; value: ApprovalDecision }> = [];
  if (approval.counterOffer) {
    options.push({
      label: `Reduce to ${approval.counterOffer.adjustedQuantity} ${approval.counterOffer.symbol} to fit your limits`,
      value: "modify",
    });
  }
  if (opts.critical) {
    options.push({ label: approval.counterOffer ? "CONFIRM ORIGINAL SIZE (CRITICAL)" : "CONFIRM (CRITICAL)", value: "once" });
    options.push({ label: "DENY", value: "deny" });
    return options;
  }
  options.push({
    label: approval.counterOffer ? "Allow original size this time" : "Allow this time",
    value: "once",
  });
  options.push({ label: "Always allow this tool", value: "always" });
  options.push({ label: "Deny", value: "deny" });
  return options;
}

/** "Why this needs approval" block — top reasons from the risk kernel. */
function RiskReasons({ reasons }: { reasons?: string[] }) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <>
      <Text color="yellow">  Why this needs approval:</Text>
      {reasons.slice(0, MAX_VISIBLE_REASONS).map((reason, i) => (
        <Text key={i} dimColor>    {"•"} {reason}</Text>
      ))}
    </>
  );
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
        <RiskReasons reasons={approval.riskReasons} />
        <Text> </Text>
        <Box paddingLeft={2}>
          <Select
            options={buildApprovalOptions(approval)}
            onChange={(v) => onDecision(v as ApprovalDecision, approval.id)}
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
        <RiskReasons reasons={approval.riskReasons} />
        <Text> </Text>
        <Text color="red">  This action has significant side effects. Review carefully.</Text>
        <Text> </Text>
        <Box paddingLeft={2}>
          <Select
            options={buildApprovalOptions(approval)}
            onChange={(v) => onDecision(v as ApprovalDecision, approval.id)}
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
        <RiskReasons reasons={approval.riskReasons} />
        <Text> </Text>
        <Text color="red" bold>  {"\u26A0"} CRITICAL — This action may be irreversible.</Text>
        <Text> </Text>
        {!unlocked ? (
          <Text dimColor>  Confirm available in {countdown}s... (Esc to deny)</Text>
        ) : (
          <Box paddingLeft={2}>
            <Select
              options={buildApprovalOptions(approval, { critical: true })}
              onChange={(v) => onDecision(v as ApprovalDecision, approval.id)}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
