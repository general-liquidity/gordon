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
 *   3. listAcpMcpToolsets discovers and instruments request-scoped toolsets
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
import { validatePluginCommand } from "../ai/mcp/marketplace/installer.ts";
import { withToolsMetrics } from "../agents/tools/wrappers/withMetrics.ts";
import type { ToolsetsInput } from "@mastra/core/agent";
import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { flagEnv } from "../config/flagResolver.ts";

const logger = createModuleLogger("acp-mcp-spinup");
export const ACP_FORWARDED_STDIO_MCP_FLAG_ENV = "GORDON_ACP_ALLOW_STDIO_MCP";

export function isForwardedStdioMcpEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  const value = env[ACP_FORWARDED_STDIO_MCP_FLAG_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/**
 * Guard against SSRF on ACP-peer-forwarded HTTP/SSE MCP server URLs.
 * Literal addresses are checked here; hostname resolution is checked again in
 * the connector that performs the actual network connection below.
 */
export function isSafeForwardedUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return false;
  }

  if (isIP(host) !== 0 && !isPublicNetworkAddress(host)) return false;

  return true;
}

/** True only for a globally routable literal address. */
export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    // Globally routable unicast occupies 2000::/3. Reject documentation and
    // ORCHID prefixes inside that range as well. IPv4-mapped, unspecified,
    // loopback, ULA, link-local and multicast addresses all fall outside it.
    const first = Number.parseInt(normalized.split(":", 1)[0] ?? "", 16);
    if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return false;
    if (normalized.startsWith("2001:db8:") || normalized.startsWith("2001:10:")) return false;
    return true;
  }
  return false;
}

/**
 * Resolver used by the actual connector. Checking inside this callback avoids
 * the check-then-connect race of a separate DNS preflight, and mixed
 * public/private responses are refused in full.
 */
export function createPublicOnlyLookup(resolver: typeof dnsLookup = dnsLookup): LookupFunction {
  return ((hostname, options, callback) => {
    resolver(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 4);
        return;
      }
      if (
        addresses.length === 0 ||
        addresses.some(({ address }) => !isPublicNetworkAddress(address))
      ) {
        const refusal = Object.assign(
          new Error(`ACP-forwarded MCP hostname ${hostname} resolved to a non-public address`),
          { code: "EACCES" },
        );
        callback(refusal, "", 4);
        return;
      }
      if (options.all) {
        (callback as unknown as (error: null, result: typeof addresses) => void)(null, addresses);
        return;
      }
      const selected = addresses[0]!;
      callback(null, selected.address, selected.family);
    });
  }) as LookupFunction;
}

interface GuardedTransport {
  fetch: NonNullable<Extract<MastraMCPServerDefinition, { url: URL }>["fetch"]>;
  close: () => Promise<void>;
}

const guardedTransports = new WeakMap<object, GuardedTransport>();
const sessionTransports = new Map<string, GuardedTransport[]>();

function createGuardedForwardedFetch(headers: Record<string, string>): GuardedTransport {
  // Lazy creation matters for rejected/inspected definitions: an idle Undici
  // Agent owns timers even before its first request and would keep short-lived
  // CLI/test processes alive.
  let agent: Agent | null = null;
  const getAgent = (): Agent => {
    agent ??= new Agent({ connect: { lookup: createPublicOnlyLookup() } });
    return agent;
  };
  const guardedFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (!isSafeForwardedUrl(url.href)) {
      throw new Error(`ACP-forwarded MCP request refused unsafe URL: ${url.href}`);
    }
    const mergedHeaders = new Headers(init?.headers);
    for (const [name, value] of Object.entries(headers)) mergedHeaders.set(name, value);
    const response = await undiciFetch(url, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      headers: mergedHeaders,
      dispatcher: getAgent(),
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error(
        `ACP-forwarded MCP redirect refused (${response.status} to ${response.headers.get("location") ?? "unknown"})`,
      );
    }
    return response as unknown as Response;
  };
  return {
    fetch: guardedFetch,
    close: async () => {
      if (!agent) return;
      const active = agent;
      agent = null;
      await active.close();
    },
  };
}

// One MCPClient per ACP sessionId; tracked so closeAcpMcpClient knows
// what to tear down.
const sessionClients = new Map<string, MCPClient>();

/**
 * Translate an ACP McpServer union member to Mastra's expected shape.
 * Returns `null` when the server's transport isn't supported (e.g.
 * `acp` type — UNSTABLE per the SDK spec).
 */
export function acpServerToMastraDefinition(
  server: McpServer,
  env: NodeJS.ProcessEnv = flagEnv(),
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
  const identity = `${peek.type ?? "stdio"}:${peek.url ?? peek.command ?? "server"}`;
  const name =
    peek.name ?? `acp-fwd-${createHash("sha256").update(identity).digest("hex").slice(0, 8)}`;
  const transport = peek.type;

  // HTTP / SSE — URL-based remote MCP servers
  if (transport === "http" || transport === "sse") {
    if (!peek.url) return null;
    if (!isSafeForwardedUrl(peek.url)) {
      console.warn(
        `[acp-mcp-spinup] Skipping ACP-forwarded MCP server "${name}": unsafe URL "${peek.url}" (scheme or host blocked)`,
      );
      return null;
    }
    const headers: Record<string, string> = {};
    for (const h of peek.headers ?? []) headers[h.name] = h.value;
    const guarded = createGuardedForwardedFetch(headers);
    const def = {
      url: new URL(peek.url),
      fetch: guarded.fetch,
    } as MastraMCPServerDefinition;
    guardedTransports.set(def, guarded);
    return {
      name,
      def,
    };
  }

  // Stdio — command + args
  // (The discriminator field is missing on stdio variant per ACP spec;
  // we detect by presence of `command` when transport is absent.)
  if (peek.command) {
    // A package runner such as npx/bunx can execute arbitrary code from its
    // arguments. Protocol input is not consent to grant process-spawn
    // authority, so HTTP/SSE remains the default and stdio requires opt-in.
    if (!isForwardedStdioMcpEnabled(env)) {
      console.warn(
        `[acp-mcp-spinup] Skipping ACP-forwarded stdio MCP server "${name}": ` +
          `${ACP_FORWARDED_STDIO_MCP_FLAG_ENV}=1 is required`,
      );
      return null;
    }
    const cmdError = validatePluginCommand(peek.command, peek.args);
    if (cmdError) {
      console.warn(`[acp-mcp-spinup] Skipping ACP-forwarded MCP server "${name}": ${cmdError}`);
      return null;
    }
    const childEnv: Record<string, string> = {};
    for (const e of peek.env ?? []) childEnv[e.name] = e.value;
    return {
      name,
      def: {
        command: peek.command,
        ...(peek.args ? { args: peek.args } : {}),
        ...(Object.keys(childEnv).length > 0 ? { env: childEnv } : {}),
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
    if (Object.hasOwn(definitions, translated.name)) {
      throw new Error(`Duplicate ACP-forwarded MCP server name: ${translated.name}`);
    }
    definitions[translated.name] = translated.def;
  }

  if (Object.keys(definitions).length === 0) {
    logger.debug("No eligible ACP-forwarded MCP servers — skipping client creation", {
      sessionId,
      total: servers.length,
    });
    return null;
  }

  const client = new MCPClient({
    id: `acp-${sessionId}`,
    servers: definitions,
  });
  sessionTransports.set(
    sessionId,
    Object.values(definitions).flatMap((definition) => {
      const transport = guardedTransports.get(definition as object);
      return transport ? [transport] : [];
    }),
  );
  sessionClients.set(sessionId, client);
  logger.info("ACP MCP client created", {
    sessionId,
    serverCount: Object.keys(definitions).length,
  });
  return client;
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
  if (client) {
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
  const transports = sessionTransports.get(sessionId) ?? [];
  await Promise.all(transports.map((transport) => transport.close().catch(() => undefined)));
  sessionTransports.delete(sessionId);
}

/**
 * List the raw tools surfaced by a session's MCPClient for diagnostics.
 * Prompt execution uses `listAcpMcpToolsets`, which preserves server grouping
 * and applies Gordon's runtime wrappers before exposing them to the agent.
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

/** Apply Gordon's sanitizer, lifecycle hooks, metrics, and permission gate to
 * every editor-forwarded tool before Mastra can execute it. */
export function instrumentAcpMcpToolsets(toolsets: ToolsetsInput): ToolsetsInput {
  const instrumented: ToolsetsInput = {};
  for (const [serverName, tools] of Object.entries(toolsets)) {
    const normalized: Record<string, { id: string; execute?: unknown }> = {};
    for (const [toolName, tool] of Object.entries(tools)) {
      const candidate = tool as { id?: string; execute?: unknown };
      const clone = Object.create(Object.getPrototypeOf(tool));
      Object.assign(clone, tool, { id: candidate.id ?? toolName });
      normalized[toolName] = clone;
    }
    instrumented[serverName] = withToolsMetrics(normalized) as unknown as ToolsetsInput[string];
  }
  return instrumented;
}

/** Discover the current session's forwarded tools for this prompt. Discovery
 * failures refuse the turn; silently dropping a peer-requested toolset would
 * make the advertised ACP capability false and could change agent behavior. */
export async function listAcpMcpToolsets(sessionId: string): Promise<ToolsetsInput> {
  const client = sessionClients.get(sessionId);
  if (!client) return {};
  const { toolsets, errors } = await client.listToolsetsWithErrors();
  if (Object.keys(errors).length > 0) {
    const detail = Object.entries(errors)
      .map(([server, error]) => `${server}: ${error}`)
      .join("; ");
    throw new Error(`ACP-forwarded MCP tool discovery failed: ${detail}`);
  }
  return instrumentAcpMcpToolsets(toolsets);
}
