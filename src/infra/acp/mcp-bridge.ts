/**
 * MCP-server forwarding — captures editor-forwarded MCP server configs
 * from the ACP `newSession` / `loadSession` requests so Gordon-side
 * tools can consume them.
 *
 * Per the ACP spec, the editor advertises its configured MCP servers
 * via the `mcpServers` field on session-creation requests. Each server
 * can be:
 *
 *   - http       { type: "http", url, headers?, name }
 *   - sse        { type: "sse",  url, headers?, name }
 *   - acp        { type: "acp",  command, args?, env?, name }   (UNSTABLE)
 *   - stdio      { command, args?, env?, name }
 *
 * The server converts the captured configs into a per-session Mastra MCP
 * client. Its toolsets are discovered for each prompt and passed to the agent
 * through Mastra's request-scoped `toolsets` option, after Gordon wraps every
 * tool with the same sanitizer, lifecycle, metrics, and permission boundary as
 * built-in tools.
 */

import type { McpServer } from "@agentclientprotocol/sdk";

interface SessionMcpState {
  servers: McpServer[];
}

const sessions = new Map<string, SessionMcpState>();

/**
 * Store the editor-forwarded MCP server list for a session.
 *
 * Called from server.ts inside newSession / loadSession handlers. Pass
 * the `mcpServers` field from the request (may be undefined when the
 * editor doesn't forward any).
 */
export function captureSessionMcpServers(
  sessionId: string,
  mcpServers: McpServer[] | undefined,
): void {
  if (!mcpServers || mcpServers.length === 0) {
    sessions.delete(sessionId);
    return;
  }
  sessions.set(sessionId, { servers: [...mcpServers] });
}

/**
 * Look up the MCP servers the editor forwarded for this session.
 * Returns empty array when none were forwarded.
 */
export function getSessionMcpServers(sessionId: string): McpServer[] {
  return sessions.get(sessionId)?.servers ?? [];
}

/**
 * Drop session state on session close.
 */
export function dropSessionMcpServers(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * Summarize forwarded MCP servers for logging / diagnostics. Returns a
 * compact human-readable list. Never leaks credentials (only names +
 * transports + url-hosts).
 */
export function summarizeSessionMcpServers(sessionId: string): string {
  const servers = getSessionMcpServers(sessionId);
  if (servers.length === 0) return "(none)";
  return servers
    .map((s) => {
      // The McpServer union has stdio as the only variant without a `type`
      // discriminator field — TS can't narrow on its absence, so we read
      // the field via a shared cast and switch on it (or fall through).
      const peek = s as { type?: string; name?: string; url?: string; command?: string };
      const name = peek.name ?? "(unnamed)";
      const transport = peek.type;
      if (transport === "http" || transport === "sse") {
        try {
          const host = peek.url ? new URL(peek.url).host : "(no-url)";
          return `${name}@${transport}:${host}`;
        } catch {
          return `${name}@${transport}`;
        }
      }
      if (transport === "acp") {
        return `${name}@acp:${peek.command ?? "(no-cmd)"}`;
      }
      return `${name}@stdio:${peek.command ?? "(no-cmd)"}`;
    })
    .join(", ");
}
