import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { FullscreenLayout } from "../layout/FullscreenLayout.tsx";
import type { PermissionMode } from "../../state/types.ts";
import {
  isKillSwitchesEnabled,
  listTrippedSwitches,
  type KillSwitchScope,
  type KillSwitchKey,
} from "../../../infra/safety/killSwitches.ts";
import { getRuntime } from "../../bridge/runtime.ts";
import type { RuntimeApprovalRequest } from "../../../runtime/contracts/types.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";

export interface SafetyDashboardViewProps {
  permissionMode: PermissionMode;
  onClose: () => void;
}

const SCOPES: KillSwitchScope[] = [
  "firm",
  "instrument",
  "venue",
  "account",
  "strategy",
  "trader",
  "client",
  "gateway",
];

interface SafetySnapshot {
  killSwitchEnabled: boolean;
  trips: Array<{ key: KillSwitchKey; reason: string; trippedAt: number }>;
  rules: ReturnType<NonNullable<ReturnType<typeof getRuntime>>["listApprovalRules"]>;
  recent: RuntimeApprovalRequest[];
}

export function summarizeApprovalVelocity(
  recent: RuntimeApprovalRequest[],
  nowMs: number,
): {
  approvedLastHour: number;
  deniedLastHour: number;
  autoApprovedLastHour: number;
} {
  const cutoff = nowMs - 60 * 60 * 1000;
  let approvedLastHour = 0;
  let deniedLastHour = 0;
  let autoApprovedLastHour = 0;
  for (const approval of recent) {
    const decidedAt = approval.decidedAt ? Date.parse(approval.decidedAt) : 0;
    if (!Number.isFinite(decidedAt) || decidedAt < cutoff) continue;
    if (approval.status === "approved") {
      approvedLastHour += 1;
      if (approval.decisionSource && approval.decisionSource !== "human") autoApprovedLastHour += 1;
    }
    if (approval.status === "denied") deniedLastHour += 1;
  }
  return { approvedLastHour, deniedLastHour, autoApprovedLastHour };
}

export function deriveKillSwitchRows(
  enabled: boolean,
  trips: Array<{ key: KillSwitchKey; reason: string }>,
): Array<{ scope: KillSwitchScope; status: "disabled" | "armed" | "tripped"; reason?: string }> {
  return SCOPES.map((scope) => {
    if (!enabled) return { scope, status: "disabled" as const };
    const trip = trips.find((entry) => entry.key.scope === scope);
    return trip
      ? { scope, status: "tripped" as const, reason: trip.reason }
      : { scope, status: "armed" as const };
  });
}

export function SafetyDashboardView({
  permissionMode,
  onClose,
}: SafetyDashboardViewProps): React.JSX.Element {
  const theme = useTheme();
  const [snapshot, setSnapshot] = useState<SafetySnapshot>(() => loadSnapshot());
  const refresh = useCallback(() => setSnapshot(loadSnapshot()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useInput((input, key) => {
    if (key.escape || input === "q") onClose();
    if (input === "r") refresh();
  });

  const rows = deriveKillSwitchRows(snapshot.killSwitchEnabled, snapshot.trips);
  const denied = snapshot.recent.filter((approval) => approval.status === "denied");
  const velocity = summarizeApprovalVelocity(snapshot.recent, Date.now());

  return (
    <FullscreenLayout
      header={<Header mode={permissionMode} />}
      content={
        <Box flexDirection="column">
          {!snapshot.killSwitchEnabled && (
            <Text color={theme.riskWarning} bold>
              ⚠ kill-switch engine DISABLED (GORDON_KILL_SWITCHES=0)
            </Text>
          )}
          <Text bold>
            KILL SWITCHES engine: {snapshot.killSwitchEnabled ? "enabled" : "disabled"}
          </Text>
          <Box flexDirection="column">
            {rows.map((row) => (
              <Text
                key={row.scope}
                color={
                  row.status === "tripped"
                    ? theme.riskDanger
                    : row.status === "disabled"
                      ? theme.riskWarning
                      : theme.riskSafe
                }
              >
                {"  "}
                {row.scope.padEnd(12)}{" "}
                {row.status === "tripped" ? `TRIPPED - ${row.reason}` : row.status}
              </Text>
            ))}
          </Box>
          <Divider />
          <Text bold>APPROVAL RULES ({snapshot.rules.length})</Text>
          {snapshot.rules.length === 0 ? (
            <Text dimColor> none</Text>
          ) : (
            snapshot.rules.map((rule, index) => (
              <Text key={`${rule.createdAt}-${index}`}>
                {"   "}
                {String(rule.decision).padEnd(6)}{" "}
                {(rule.toolName ?? rule.toolNamePattern ?? "<scope-wide>").padEnd(22)} {rule.scope}{" "}
                {rule.createdBy} {formatAge(rule.createdAt)}
              </Text>
            ))
          )}
          <Divider />
          <Text bold>RECENT DENIALS (last 50 decisions)</Text>
          {denied.length === 0 ? (
            <Text dimColor> none in the last 50 decisions</Text>
          ) : (
            denied.map((approval) => (
              <Text key={approval.id}>
                {"   "}
                {formatTime(approval.decidedAt ?? approval.requestedAt)}{" "}
                {approval.toolName.padEnd(18)} denied by {approval.decisionSource ?? "unknown"} -{" "}
                {approval.reason ?? "no reason"}
              </Text>
            ))
          )}
          <Divider />
          <Text bold>
            APPROVAL VELOCITY (1h) approved {velocity.approvedLastHour} · denied{" "}
            {velocity.deniedLastHour} · auto {velocity.autoApprovedLastHour}
          </Text>
        </Box>
      }
      statusBar={<Text dimColor>q close · r refresh</Text>}
      input={
        <Text dimColor>Read-only safety surface. Mutations stay in /killswitch and /rules.</Text>
      }
    />
  );
}

function loadSnapshot(): SafetySnapshot {
  const runtime = getRuntime();
  return {
    killSwitchEnabled: isKillSwitchesEnabled(),
    trips: listTrippedSwitches(),
    rules: runtime?.listApprovalRules() ?? [],
    recent: runtime?.getRecentApprovals(50) ?? [],
  };
}

function Header({ mode }: { mode: PermissionMode }): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold>
        SAFETY {mode} · {new Date().toLocaleTimeString()}
      </Text>
      <Text dimColor>{"─".repeat(72)}</Text>
    </Box>
  );
}

function Divider(): React.JSX.Element {
  return <Text dimColor>{"─".repeat(72)}</Text>;
}

function formatAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
