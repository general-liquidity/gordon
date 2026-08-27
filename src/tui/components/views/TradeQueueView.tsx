import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { FullscreenLayout } from "../layout/FullscreenLayout.tsx";
import type { ApprovalDecision, ApprovalRequest } from "../dialogs/ApprovalDialog.tsx";
import type { PermissionMode } from "../../state/types.ts";
import { getPositionStore } from "../../../core/positions/store.ts";
import type { PositionRecord } from "../../../core/positions/types.ts";
import { getSuggestionStore } from "../../../infra/proactive/storage/suggestionStore.ts";
import type { ProactiveSuggestion } from "../../../infra/proactive/types.ts";
import { accountPctAtRisk, stopDistancePct } from "../status/positionRisk.ts";
import type { Position } from "../status/LivePositions.tsx";
import { useTheme } from "../../themes/ThemeProvider.tsx";

export interface TradeQueueViewProps {
  pendingApprovals: ApprovalRequest[];
  permissionMode: PermissionMode;
  onApprovalDecision: (decision: ApprovalDecision, id: string) => void;
  onRadarAction: (cmd: string) => void;
  onClose: () => void;
}

type Section = "approvals" | "positions" | "radar";

export function sortApprovalsByRisk(approvals: ApprovalRequest[]): ApprovalRequest[] {
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return approvals
    .map((approval, index) => ({ approval, index }))
    .sort((a, b) => rank[a.approval.riskClass] - rank[b.approval.riskClass] || a.index - b.index)
    .map((entry) => entry.approval);
}

export function TradeQueueView({
  pendingApprovals,
  permissionMode,
  onApprovalDecision,
  onRadarAction,
  onClose,
}: TradeQueueViewProps): React.JSX.Element {
  const theme = useTheme();
  const [section, setSection] = useState<Section>("approvals");
  const [cursor, setCursor] = useState(0);
  const [positions, setPositions] = useState<Position[]>([]);
  const [radar, setRadar] = useState<ProactiveSuggestion[]>([]);
  const approvals = useMemo(() => sortApprovalsByRisk(pendingApprovals), [pendingApprovals]);

  useEffect(() => {
    let disposed = false;
    void getPositionStore()
      .then((store) => store.getActive())
      .then((records) => {
        if (!disposed) setPositions(records.map(recordToPosition));
      })
      .catch(() => {});
    const refreshRadar = () => setRadar(getSuggestionStore().getRecent(20, { status: "pending" }));
    refreshRadar();
    const timer = setInterval(refreshRadar, 2_000);
    timer.unref?.();
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  const rows = section === "approvals" ? approvals : section === "positions" ? positions : radar;
  useInput((input, key) => {
    if (key.escape || input === "q") {
      onClose();
      return;
    }
    if (key.tab) {
      setSection((current) =>
        current === "approvals" ? "positions" : current === "positions" ? "radar" : "approvals",
      );
      setCursor(0);
      return;
    }
    if (key.upArrow) setCursor((value) => Math.max(0, value - 1));
    if (key.downArrow) setCursor((value) => Math.min(Math.max(0, rows.length - 1), value + 1));
    if (section === "approvals") {
      const approval = approvals[cursor];
      if (!approval) return;
      if (input === "y") onApprovalDecision("once", approval.id);
      if (input === "n") onApprovalDecision("deny", approval.id);
      if (input === "m" && approval.counterOffer) onApprovalDecision("modify", approval.id);
    }
    if (section === "radar") {
      const suggestion = radar[cursor];
      if (!suggestion) return;
      if (input === "a") onRadarAction(`/ack ${suggestion.id}`);
      if (input === "p") onRadarAction(`/pass ${suggestion.id}`);
      if (input === "d") onRadarAction(`/snooze ${suggestion.category} 60`);
    }
  });

  const totalPnl = positions.reduce((sum, position) => sum + position.pnl, 0);

  return (
    <FullscreenLayout
      header={<Header title="TRADE QUEUE" mode={permissionMode} />}
      content={
        <Box flexDirection="column">
          <SectionTitle
            active={section === "approvals"}
            label={`APPROVALS (${approvals.length})`}
            focusColor={theme.uiFocus}
          />
          {approvals.length === 0 ? (
            <Text dimColor> none pending</Text>
          ) : (
            approvals.map((approval, index) => (
              <ApprovalRow
                key={approval.id}
                approval={approval}
                focused={section === "approvals" && index === cursor}
                focusColor={theme.uiFocus}
              />
            ))
          )}
          <Divider />
          <SectionTitle
            active={section === "positions"}
            label={`POSITIONS (${positions.length})`}
            suffix={`P&L ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}`}
            focusColor={theme.uiFocus}
          />
          {positions.length === 0 ? (
            <Text dimColor> no open positions</Text>
          ) : (
            positions.map((position, index) => (
              <PositionRow
                key={position.id}
                position={position}
                focused={section === "positions" && index === cursor}
                focusColor={theme.uiFocus}
              />
            ))
          )}
          <Divider />
          <SectionTitle
            active={section === "radar"}
            label={`RADAR (${radar.length} pending)`}
            focusColor={theme.uiFocus}
          />
          {radar.length === 0 ? (
            <Text dimColor> no pending radar cards</Text>
          ) : (
            radar.map((suggestion, index) => (
              <RadarRow
                key={suggestion.id}
                suggestion={suggestion}
                focused={section === "radar" && index === cursor}
                focusColor={theme.uiFocus}
              />
            ))
          )}
        </Box>
      }
      statusBar={<Text dimColor>Tab section · ↑↓ select · q / Esc back to chat</Text>}
      input={
        <Text dimColor>
          Approvals: y approve once · n deny · m modify when offered. Radar: a ack · p pass · d mute
          60m.
        </Text>
      }
    />
  );
}

function Header({ title, mode }: { title: string; mode: PermissionMode }): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{title}</Text>
        <Text dimColor>
          {" "}
          {mode} · {new Date().toLocaleTimeString()}
        </Text>
      </Box>
      <Text dimColor>{"─".repeat(72)}</Text>
    </Box>
  );
}

function SectionTitle({
  label,
  active,
  suffix,
  focusColor,
}: {
  label: string;
  active: boolean;
  suffix?: string;
  focusColor: string;
}): React.JSX.Element {
  return (
    <Box>
      <Text color={active ? focusColor : undefined} bold>
        {active ? "▸ " : "  "}
        {label}
      </Text>
      {suffix && <Text dimColor> {suffix}</Text>}
    </Box>
  );
}

function ApprovalRow({
  approval,
  focused,
  focusColor,
}: {
  approval: ApprovalRequest;
  focused: boolean;
  focusColor: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color={focused ? focusColor : undefined}>
        {focused ? " ▸ " : "   "}
        {approval.riskClass.toUpperCase()} {approval.toolName} - {approval.permissionScope}
      </Text>
      {(approval.riskReasons ?? []).slice(0, 1).map((reason) => (
        <Text key={reason} dimColor>
          {" "}
          Why: {reason}
        </Text>
      ))}
      <Text dimColor>
        {" "}
        y approve once · n deny
        {approval.counterOffer
          ? ` · m reduce to ${approval.counterOffer.adjustedQuantity} ${approval.counterOffer.symbol}`
          : ""}
      </Text>
    </Box>
  );
}

function PositionRow({
  position,
  focused,
  focusColor,
}: {
  position: Position;
  focused: boolean;
  focusColor: string;
}): React.JSX.Element {
  const risk = stopDistancePct(position);
  const acct = accountPctAtRisk(position, null);
  return (
    <Text color={focused ? focusColor : undefined}>
      {focused ? " ▸ " : "   "}
      {position.symbol.padEnd(6)} {position.side.toUpperCase().padEnd(5)}{" "}
      {position.quantity.toFixed(4).padStart(8)} entry {position.entryPrice.toFixed(2).padStart(10)}{" "}
      last {position.lastPrice.toFixed(2).padStart(10)} pnl {position.pnl.toFixed(2).padStart(10)}{" "}
      risk {risk == null ? "NO STOP" : `${(risk * 100).toFixed(1)}%`} acct{" "}
      {acct == null ? "—" : `${(acct * 100).toFixed(1)}%`}
    </Text>
  );
}

function RadarRow({
  suggestion,
  focused,
  focusColor,
}: {
  suggestion: ProactiveSuggestion;
  focused: boolean;
  focusColor: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color={focused ? focusColor : undefined}>
        {focused ? " ▸ " : "   "}
        {suggestion.category.toUpperCase()} {suggestion.title}
      </Text>
      <Text dimColor> a ack · p pass · d mute category 60m</Text>
    </Box>
  );
}

function Divider(): React.JSX.Element {
  return <Text dimColor>{"─".repeat(72)}</Text>;
}

function recordToPosition(record: PositionRecord): Position {
  return {
    id: record.id,
    symbol: record.symbol,
    side: record.side,
    quantity: Number(record.quantity ?? 0),
    entryPrice: Number(record.entryPrice ?? 0),
    lastPrice: Number(record.currentPrice ?? record.entryPrice ?? 0),
    pnl: Number(record.unrealizedPnL ?? record.realizedPnL ?? 0),
    stopPrice: record.stopLoss,
    openedAt: record.createdAt,
  };
}
