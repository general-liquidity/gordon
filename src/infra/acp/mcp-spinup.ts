/**
 * Mastra MCP client spin-up from editor-forwarded MCP servers.
 *
 * V3.5 wires the editor-forwarded `mcpServers` (captured by mcp-bridge
 * at session-create) into a live Mastra MCPClient instance per ACP
 * session. Tools discovered through the forwarded servers become
 * available alongside Gordon's own MCP-consumed tools.
 *
 * Architecture:
 *
 *   1. captureSessionMcpServers stores the raw configs (already shipped)
 *   2. createAcpMcpClient (this module) builds a Mastra MCPClient with
 *      those configs translated to MastraMCPServerDefinition shape
 *   3. listAcpMcpTools returns the discovered tool metadata so callers
 *      can register them with their agent registries
 *   4. closeAcpMcpClient tears down the client at session-close
 *
 * Per-session isolation is intentional: editors may forward different
 * MCP server sets per session (e.g., a "research" session has GitHub
 * MCP, a "trading" session doesn't). Gordon's own globally-configured
 * MCP servers (via its marketplace catalog) are NOT affected by this
 * path — they continue to load from Gordon's own config.
 */

import type { McpServer } from "@agentclientprotocol/sdk";
import { MCPClient } from "@mastra/mcp";
import type { MastraMCPServerDefinition } from "@mastra/mcp";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("acp-mcp-spinup");

// One MCPClient per ACP sessionId; tracked so closeAcpMcpClient knows
// what to tear down.
const sessionClients = new Map<string, MCPClient>();

/**
 * Translate an ACP McpServer union member to Mastra's expected shape.
 * Returns `null` when the server's transport isn't supported (e.g.
 * `acp` type — UNSTABLE per the SDK spec).
 */
function acpServerToMastraDefinition(
  server: McpServer,
): { name: string; def: MastraMCPServerDefinition } | null {
  const peek = server as {
    type?: string;
    name?: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Array<{ name: string; value: string }>;
    headers?: Array<{ name: string; value: string }>;
  };
  const name = peek.name ?? `acp-fwd-${Math.random().toString(36).slice(2, 8)}`;
  const transport = peek.type;

  // HTTP / SSE — URL-based remote MCP servers
  if (transport === "http" || transport === "sse") {
    if (!peek.url) return null;
    const headers: Record<string, string> = {};
    for (const h of peek.headers ?? []) headers[h.name] = h.value;
    return {
      name,
      def: {
        url: new URL(peek.url),
        ...(Object.keys(headers).length > 0 ? { requestInit: { headers } } : {}),
      } as MastraMCPServerDefinition,
    };
  }

  // Stdio — command + args
  // (The discriminator field is missing on stdio variant per ACP spec;
  // we detect by presence of `command` when transport is absent.)
  if (peek.command) {
    const env: Record<string, string> = {};
    for (const e of peek.env ?? []) env[e.name] = e.value;
    return {
      name,
      def: {
        command: peek.command,
        ...(peek.args ? { args: peek.args } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      } as MastraMCPServerDefinition,
    };
  }

  // `acp` type or unrecognized — skip
  return null;
}

/**
 * Build a Mastra MCPClient instance for an ACP session given the list
 * of editor-forwarded servers. Returns null when no eligible servers
 * exist (empty list, or all skipped).
 */
export async function createAcpMcpClient(
  sessionId: string,
  servers: McpServer[],
): Promise<MCPClient | null> {
  if (servers.length === 0) return null;

  const definitions: Record<string, MastraMCPServerDefinition> = {};
  for (const server of servers) {
    const translated = acpServerToMastraDefinition(server);
    if (!translated) continue;
    definitions[translated.name] = translated.def;
  }

  if (Object.keys(definitions).length === 0) {
    logger.debug("No eligible ACP-forwarded MCP servers — skipping client creation", {
      sessionId,
      total: servers.length,
    });
    return null;
  }

  try {
    const client = new MCPClient({
      id: `acp-${sessionId}`,
      servers: definitions,
    });
    sessionClients.set(sessionId, client);
    logger.info("ACP MCP client created", {
      sessionId,
      serverCount: Object.keys(definitions).length,
    });
    return client;
  } catch (err) {
    logger.warn("ACP MCP client creation failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Get the live MCPClient for a session, if one exists.
 */
export function getAcpMcpClient(sessionId: string): MCPClient | null {
  return sessionClients.get(sessionId) ?? null;
}

/**
 * Tear down the session's MCPClient. Called from session-close (when
 * that path is wired) or session restart. Idempotent.
 */
export async function closeAcpMcpClient(sessionId: string): Promise<void> {
  const client = sessionClients.get(sessionId);
  if (!client) return;
  try {
    await client.disconnect();
  } catch (err) {
    logger.debug("ACP MCP client disconnect threw (non-fatal)", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  sessionClients.delete(sessionId);
}

/**
 * List the tools surfaced by a session's MCPClient. Returns empty
 * array when no client is set up or the discovery call fails.
 *
 * Used by the prompt handler to expose forwarded tools to the agent.
 * Full tool registration with Gordon's executor agent is a v3.6
 * follow-up (the agent's tool surface is currently static at
 * construction time; dynamic per-session tool registration requires
 * runtime changes to the Mastra agent wrapper).
 */
export async function listAcpMcpTools(sessionId: string): Promise<Record<string, unknown>> {
  const client = sessionClients.get(sessionId);
  if (!client) return {};
  try {
    return (await client.listTools()) ?? {};
  } catch (err) {
    logger.debug("listAcpMcpTools failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
