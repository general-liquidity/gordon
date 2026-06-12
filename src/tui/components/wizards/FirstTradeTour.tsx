import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import type { PermissionMode } from "../../state/types.ts";
import { buildApprovalOptions, type ApprovalRequest } from "../dialogs/ApprovalDialog.tsx";

interface FirstTradeTourProps {
  permissionMode: PermissionMode;
  onDone: () => void;
}

export const TOUR_MOCK_STANDARD: ApprovalRequest = {
  id: "tour-demo-standard",
  shortId: "a3f",
  toolName: "execute_plan",
  permissionScope: "trading:execute",
  riskClass: "medium",
  sideEffectLevel: "order placement",
  riskReasons: [
    "Position size 2.1% of equity — inside your 3% limit",
    "Paper venue — no real capital at risk",
  ],
};

export const TOUR_MOCK_CRITICAL: ApprovalRequest = {
  id: "tour-demo-critical",
  shortId: "9c2",
  toolName: "execute_plan",
  permissionScope: "trading:execute",
  riskClass: "critical",
  sideEffectLevel: "live order — real capital",
  riskReasons: [
    "Order size 12% of equity — exceeds your 3% limit",
    "No stop-loss attached to the plan",
  ],
  counterOffer: { symbol: "BTC", side: "buy", originalQuantity: 0.5, adjustedQuantity: 0.12 },
};

export function FirstTradeTour({ permissionMode, onDone }: FirstTradeTourProps): React.JSX.Element {
  const [screen, setScreen] = useState<0 | 1>(0);
  const [preview, setPreview] = useState<"standard" | "critical">("standard");

  useInput((input, key) => {
    if (key.escape) {
      onDone();
      return;
    }
    if (screen === 1 && key.tab) {
      setPreview((current) => current === "standard" ? "critical" : "standard");
      return;
    }
    if (key.return) {
      if (screen === 0) setScreen(1);
      else onDone();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyanBright" paddingX={2} paddingY={1}>
      {screen === 0 ? <TourIntro permissionMode={permissionMode} /> : <TourApproval preview={preview} />}
    </Box>
  );
}

function TourIntro({ permissionMode }: { permissionMode: PermissionMode }): React.JSX.Element {
  return (
    <>
      <Text bold>FIRST TRADE - how Gordon works                       1/2</Text>
      <Text> </Text>
      <Text>Every trade follows the same loop. You stay in control</Text>
      <Text>at every step:</Text>
      <Text> </Text>
      <Text> 1  /scan trending      find what's moving</Text>
      <Text> 2  /plan BTC           Gordon drafts entry, stop, size</Text>
      <Text> 3  approve             you say yes (or no) in a dialog</Text>
      <Text> 4  Gordon executes     and tracks the position</Text>
      <Text> </Text>
      <Text>{modeLine(permissionMode)}</Text>
      <Text> </Text>
      <Text dimColor>[Enter] Next  ·  [Esc] Skip - won't show again</Text>
    </>
  );
}

function TourApproval({ preview }: { preview: "standard" | "critical" }): React.JSX.Element {
  const critical = preview === "critical";
  return (
    <>
      <Text bold>FIRST TRADE - approvals are your guardrail           2/2</Text>
      <Text> </Text>
      <Text>Before money moves, Gordon stops and asks. This is a</Text>
      <Text>preview - nothing below is real:</Text>
      <Text> </Text>
      <Text dimColor>{critical ? "-- PREVIEW: a critical approval ---------------------" : "-- PREVIEW: a routine approval ----------------------"}</Text>
      <ApprovalPreview approval={critical ? TOUR_MOCK_CRITICAL : TOUR_MOCK_STANDARD} critical={critical} />
      <Text> </Text>
      <Text dimColor>
        {critical ? "[Tab] Back to the routine variant" : "[Tab] See the critical variant"}
      </Text>
      <Text dimColor>[Enter] Start trading  ·  [Esc] Skip - won't show again</Text>
    </>
  );
}

function ApprovalPreview({ approval, critical }: { approval: ApprovalRequest; critical: boolean }): React.JSX.Element {
  const options = buildApprovalOptions(approval, { critical });
  return (
    <Box flexDirection="column" borderStyle={critical ? "double" : undefined} borderColor={critical ? "red" : undefined} paddingX={critical ? 1 : 0}>
      <Text color={critical ? "red" : "yellow"} bold>
        {critical ? `CRITICAL  APPROVAL [${approval.shortId}]` : `⚠ APPROVAL [${approval.shortId}]`}
      </Text>
      <Text>  Gordon wants to use `{approval.toolName}`</Text>
      <Text>  Scope: {approval.permissionScope} · Risk: {approval.riskClass.toUpperCase()}</Text>
      <Text>  Why this needs approval:</Text>
      {(approval.riskReasons ?? []).map((reason) => (
        <Text key={reason}>    • {reason}</Text>
      ))}
      {critical && <Text color="red">  ⚠ CRITICAL - This action may be irreversible.</Text>}
      {options.map((option, index) => (
        <Text key={option.value}>    {index === 0 ? "❯ " : "  "}{option.label}</Text>
      ))}
      {critical && <Text dimColor>  (real dialogs add a 3s hold before confirm)</Text>}
    </Box>
  );
}

function modeLine(mode: PermissionMode): string {
  switch (mode) {
    case "paper":
      return "You're in paper mode - fills are simulated until you run /live.";
    case "ask":
      return "You're in ask mode - every trade waits for your approval.";
    case "auto":
      return "You're in auto mode - trades execute without a dialog. Run /ask to approve each one.";
    case "strict":
    case "observe":
    case "plan":
      return `You're in ${mode} mode - execution is blocked. Run /modes to see all modes.`;
  }
}
