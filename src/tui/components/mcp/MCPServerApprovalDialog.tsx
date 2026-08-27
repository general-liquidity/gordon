import { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// MCPServerApprovalDialog — Request user approval before connecting an MCP server
//
// Displayed as a bordered yellow box listing requested scopes.
// [Allow]  [Deny]
// ============================================================================

interface Props {
  serverName: string;
  serverUrl: string;
  requestedScopes: string[];
  onDecision: (approved: boolean) => void;
}

const SCOPE_ICONS: Record<string, string> = {
  "read:prices": "📊",
  "read:news": "📰",
  "write:orders": "⚠",
  "read:account": "👤",
  "write:account": "⚠",
};

function scopeLabel(scope: string): string {
  const parts = scope.split(":");
  const action = parts[0] ?? scope;
  const resource = parts[1] ?? "";
  if (action === "write") return `Write access to ${resource}`;
  if (action === "read") return `Read access to ${resource}`;
  return scope;
}

export function MCPServerApprovalDialog({
  serverName,
  serverUrl,
  requestedScopes,
  onDecision,
}: Props) {
  const [focus, setFocus] = useState<"allow" | "deny">("allow");

  useInput((input, key) => {
    if (key.escape || input === "d" || input === "D") {
      onDecision(false);
      return;
    }
    if (input === "a" || input === "A") {
      onDecision(true);
      return;
    }
    if (key.leftArrow || key.rightArrow || key.tab) {
      setFocus((f) => (f === "allow" ? "deny" : "allow"));
      return;
    }
    if (key.return) {
      onDecision(focus === "allow");
    }
  });

  const hasWriteScope = requestedScopes.some((s) => s.startsWith("write:"));

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} borderStyle="round" borderColor="yellow">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="yellow">
          ⚠ Allow MCP server to connect?
        </Text>
      </Box>

      {/* Server info */}
      <Box>
        <Text dimColor>{"Name:".padEnd(8)}</Text>
        <Text bold>{serverName}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>{"URL:".padEnd(8)}</Text>
        <Text dimColor>{serverUrl}</Text>
      </Box>

      {/* Requested scopes */}
      <Box marginBottom={1}>
        <Text bold>Requested permissions:</Text>
      </Box>
      {requestedScopes.length === 0 ? (
        <Box>
          <Text dimColor> (no specific scopes requested)</Text>
        </Box>
      ) : (
        requestedScopes.map((scope) => {
          const isWrite = scope.startsWith("write:");
          const icon = SCOPE_ICONS[scope] ?? (isWrite ? "⚠" : "●");
          return (
            <Box key={scope}>
              <Text color={isWrite ? "yellow" : "green"}> {icon} </Text>
              <Text color={isWrite ? "yellow" : undefined}>{scopeLabel(scope)}</Text>
              <Text dimColor>
                {"  ("}
                {scope}
                {")"}
              </Text>
            </Box>
          );
        })
      )}

      {hasWriteScope && (
        <Box marginTop={1}>
          <Text color="yellow"> This server requests write access. Proceed carefully.</Text>
        </Box>
      )}

      {/* Actions */}
      <Box marginTop={2} gap={3}>
        <Box>
          <Text
            color={focus === "allow" ? "green" : undefined}
            bold={focus === "allow"}
            inverse={focus === "allow"}
          >
            {focus === "allow" ? " Allow " : "[ Allow ]"}
          </Text>
        </Box>
        <Box>
          <Text
            color={focus === "deny" ? "red" : undefined}
            bold={focus === "deny"}
            inverse={focus === "deny"}
          >
            {focus === "deny" ? " Deny " : "[ Deny ]"}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>←→ select Enter confirm A allow D deny Esc deny</Text>
      </Box>
    </Box>
  );
}
