/**
 * Expose Gordon as an MCP server (GORDON_MCP_EXPOSE_SERVER).
 *
 * Translates Gordon's existing Mastra tool registry into the Model Context
 * Protocol server format so external agents (Cursor, Warp.dev, Claude Code,
 * any MCP-aware host) can call Gordon's tools — market data, technical
 * analysis, news, scanners, riskClassifier (read), trade ledger (read),
 * etc.
 *
 * Design choices documented in CLAUDE.md / MEMORY.md:
 *
 * 1. Same-repo, not separate package. The wrapper has zero independent
 *    business logic — it's a thin projection of `instrumentedTools`.
 *    Putting it in a separate repo would either require Gordon to become
 *    a publishable library (architectural reshape) or vendor tool
 *    definitions (drift surface for safety-critical schemas). Single
 *    source of truth wins.
 *
 * 2. Domain-tool agents expose; coding-agent CLIs (Claude Code, Codex)
 *    consume. Verified from canonical docs: Claude Code's documented
 *    `claude mcp` subcommands are all client-side (`add`, `list`,
 *    `add-json`, `add-from-claude-desktop`); the OpenAI Codex docs/
 *    directory has no `mcp.md` at all. The asymmetry isn't accidental:
 *    coding tools (Read/Edit/Bash) are generic per-agent; domain tools
 *    (market data, riskClassifier) are share-worthy. Gordon is in the
 *    second category.
 *
 * 3. Default-deny on execution. The hard deny-list mirrors CLAUDE.md's
 *    safety-critical tool list — execute_plan, place_order, cancel_*,
 *    wallet_transfer, close_trade — none are exposed unless the operator
 *    explicitly sets GORDON_MCP_ALLOW_EXECUTION=1. Even when allowed,
 *    the tools still go through riskClassifier + trust-trajectory +
 *    Gordon's existing permission gates; the MCP wrapper doesn't bypass
 *    safety, it just exposes the entrypoint.
 *
 * Tool adapter shape transformations:
 *   - Mastra `inputSchema: z.object({ field: z.string() })`
 *     → MCP `inputSchema: { field: z.string() }` (object of fields, not
 *       wrapped in z.object — the MCP SDK wraps it internally)
 *   - Mastra `execute(input, execContext) → typedResult`
 *     → MCP handler `(input) → { content: [{ type: "text", text: JSON }] }`
 *       (typed result is JSON-stringified into the text field; structured
 *       returns via `content: [{ type: "resource", ... }]` are out of
 *       scope for this MVP)
 *
 * Verified against modelcontextprotocol.io/docs/develop/build-server
 * (TypeScript section) and the @modelcontextprotocol/sdk public API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGordonResources } from "./resources.ts";
import { registerGordonPrompts } from "./prompts.ts";
import { buildTaskAnnotations } from "./tasks.ts";
import { deriveToolHints } from "./hints.ts";
import type { ZodObject, ZodRawShape } from "zod";
import { evaluateGordonToolAccess } from "../../agents/tools/wrappers/withMetrics.ts";
import { getGordonContext, type MastraExecutionContext } from "../../agents/tools/types.ts";

export const MCP_EXPOSE_FLAG_ENV = "GORDON_MCP_EXPOSE_SERVER";
export const MCP_ALLOW_EXECUTION_ENV = "GORDON_MCP_ALLOW_EXECUTION";

export function isMcpExposeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[MCP_EXPOSE_FLAG_ENV] === "1" ||
    env[MCP_EXPOSE_FLAG_ENV] === "true"
  );
}

export function isMcpExecutionAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[MCP_ALLOW_EXECUTION_ENV] === "1" ||
    env[MCP_ALLOW_EXECUTION_ENV] === "true"
  );
}

/**
 * Hard deny-list — execution / state-mutating tools that must NEVER be
 * exposed without explicit GORDON_MCP_ALLOW_EXECUTION=1. Mirrors the
 * safety-critical tool list in CLAUDE.md.
 *
 * The Mastra trust-trajectory hook + riskClassifier still gate these
 * even when MCP execution is allowed — this list is a SECOND layer of
 * defense at the wire boundary, not the only one.
 */
export const EXECUTION_DENY_LIST: ReadonlySet<string> = new Set([
  "execute_plan",
  "execute_trade",
  "place_order",
  "cancel_order",
  "cancel_all_orders",
  "cancel_replace_order",
  "cancel_order_list",
  "approve_plan",
  "close_trade",
  "close_partial_position",
  "execute_with_algorithm",
  "set_trailing_stop",
  "update_trailing_stop",
  "wallet_transfer",
  "set_permission_mode",
  "cancel",
  "place_market_order",
  "place_limit_order",
  "place_bracket_order",
  "place_oco_order",
]);

// -------------------- structural tool types --------------------

/**
 * Minimal shape Gordon's Mastra tools satisfy. Kept structural so we don't
 * pull a hard dep on @mastra/core types — the wrapper only needs id,
 * description, inputSchema, and execute.
 */
export interface MastraLikeTool {
  id: string;
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  execute: (input: Record<string, unknown>, execContext?: unknown) => Promise<unknown>;
}

export type ToolRegistry = Record<string, MastraLikeTool>;

// -------------------- options --------------------

export interface ExposeServerOptions {
  /** Server name reported to clients. Defaults to "gordon". */
  name?: string;
  /** Server version reported to clients. Defaults to "0.0.0". */
  version?: string;
  /**
   * Optional execContext passed to each tool's `execute(input, execContext)`.
   * Most read-only tools work without it; tools touching `ctx.exchange` /
   * `ctx.config` need a real Gordon context — wire it from `serveCli.ts`.
   */
  execContext?: unknown;
  /**
   * Override the execution-allowed flag. Useful for tests; defaults to
   * `isMcpExecutionAllowed(process.env)`.
   */
  allowExecution?: boolean;
  /**
   * Additional tool IDs to skip beyond `EXECUTION_DENY_LIST`. Use for
   * per-deployment hiding (e.g. an operator-specific "don't expose
   * historical fills" preference).
   */
  extraDenyList?: ReadonlyArray<string>;
  /**
   * If set, only tools whose ID is in this list are exposed. Useful for
   * tight allow-lists; defaults to "expose everything not denied".
   */
  allowList?: ReadonlyArray<string>;
  /**
   * v2: register Gordon's read-only resources alongside tools. Defaults
   * to true. Operators can disable for minimal-surface deployments.
   */
  includeResources?: boolean;
  /**
   * v2: register Gordon's bundled skills as MCP prompts. Defaults to
   * true. Disable for minimal-surface deployments.
   */
  includePrompts?: boolean;
}

export interface ExposureSummary {
  exposed: string[];
  denied: { id: string; reason: string }[];
  /** v2: resource URIs registered alongside tools. */
  resources?: string[];
  /** v2: prompt names registered (one per bundled skill). */
  prompts?: number;
  /** v2: tools annotated with `execution.taskSupport`. */
  taskAnnotations?: { required: number; optional: number };
}

// -------------------- adapter --------------------

/**
 * Translate a Mastra tool's typed result into the MCP-required
 * `{ content: [{ type: "text", text: string }] }` shape. JSON-stringifies
 * structured results so the MCP client (model) sees the full envelope.
 *
 * Errors are caught and returned as a text error message rather than
 * thrown — MCP clients see a tool result with `isError: true` rather than
 * an aborted connection.
 */
async function invokeAndAdapt(
  tool: MastraLikeTool,
  input: Record<string, unknown>,
  execContext: unknown,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    const gordonContext = getGordonContext(execContext as MastraExecutionContext) ?? undefined;
    const access = await evaluateGordonToolAccess(tool.id, gordonContext);
    if (access.status !== "allowed") {
      const suffix = access.requestId
        ? ` Approval id: ${access.requestId}.`
        : "";
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `${access.reason ?? `Tool ${tool.id} ${access.status}.`}${suffix}`,
            runtimeStatus: access.status,
            toolId: tool.id,
            approvalRequestId: access.requestId,
          }, null, 2),
        }],
        isError: true,
      };
    }

    const result = await tool.execute(input, execContext);
    const text =
      typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);
    return { content: [{ type: "text", text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error invoking ${tool.id}: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Decide which tools to expose given the deny-list, allow-list, and
 * execution-allowed flag.
 */
export function filterExposableTools(
  registry: ToolRegistry,
  options: ExposeServerOptions = {},
): { exposable: MastraLikeTool[]; summary: ExposureSummary } {
  const allowExec = options.allowExecution ?? isMcpExecutionAllowed();
  const extraDeny = new Set(options.extraDenyList ?? []);
  const allowList = options.allowList ? new Set(options.allowList) : null;

  const exposable: MastraLikeTool[] = [];
  const denied: { id: string; reason: string }[] = [];

  for (const tool of Object.values(registry)) {
    if (allowList && !allowList.has(tool.id)) {
      denied.push({ id: tool.id, reason: "not in allowList" });
      continue;
    }
    if (extraDeny.has(tool.id)) {
      denied.push({ id: tool.id, reason: "extraDenyList" });
      continue;
    }
    if (EXECUTION_DENY_LIST.has(tool.id) && !allowExec) {
      denied.push({
        id: tool.id,
        reason: `execution-deny-list (set ${MCP_ALLOW_EXECUTION_ENV}=1 to allow)`,
      });
      continue;
    }
    exposable.push(tool);
  }

  return {
    exposable,
    summary: { exposed: exposable.map((t) => t.id), denied },
  };
}

// -------------------- server construction --------------------

/**
 * Build an MCP server that exposes the safe subset of Gordon's tools.
 * Does NOT start a transport — caller wires `StdioServerTransport` or
 * an HTTP transport via `connectStdio` / their own transport setup.
 *
 * Returns the server + the exposure summary so the caller can log which
 * tools landed on the wire and which were filtered out.
 */
export function buildGordonMcpServer(
  registry: ToolRegistry,
  options: ExposeServerOptions = {},
): { server: McpServer; summary: ExposureSummary } {
  const server = new McpServer({
    name: options.name ?? "gordon",
    version: options.version ?? "0.0.0",
  });

  const { exposable, summary } = filterExposableTools(registry, options);

  let requiredTaskCount = 0;
  let optionalTaskCount = 0;

  for (const tool of exposable) {
    const fieldShape = tool.inputSchema.shape;
    const taskAnnotations = buildTaskAnnotations(tool.id);
    if (taskAnnotations?.execution?.taskSupport === "required") requiredTaskCount++;
    if (taskAnnotations?.execution?.taskSupport === "optional") optionalTaskCount++;

    // The SDK's typed registerTool config doesn't yet expose the
    // `execution` field (v2025-11-25 spec is newer than the SDK types).
    // Cast through unknown so the field lands on the wire; the SDK
    // serializes unknown keys passthrough on the JSON-RPC envelope.
    const config: Record<string, unknown> = {
      description: tool.description,
      inputSchema: fieldShape as Record<string, never>,
      // Standard MCP behavioral hints — advisory to the consuming host's
      // approval UX (auto-approve reads, force-confirm destructive). Derived
      // from Gordon's existing safety signals (deny-list + tool-domain
      // shape); Gordon's own gates still fire regardless.
      annotations: deriveToolHints(tool.id),
    };
    if (taskAnnotations) {
      config.execution = taskAnnotations.execution;
    }
    server.registerTool(
      tool.id,
      config as Parameters<typeof server.registerTool>[1],
      async (input: Record<string, unknown>) =>
        invokeAndAdapt(tool, input, options.execContext),
    );
  }

  // v2: resources + prompts + task annotation accounting
  let resourceSummary: { count: number; resources: string[] } = { count: 0, resources: [] };
  let promptSummary: { count: number; prompts: Array<{ name: string }> } = { count: 0, prompts: [] };
  if (options.includeResources !== false) {
    resourceSummary = registerGordonResources(server);
  }
  if (options.includePrompts !== false) {
    promptSummary = registerGordonPrompts(server);
  }

  summary.resources = resourceSummary.resources;
  summary.prompts = promptSummary.count;
  summary.taskAnnotations = { required: requiredTaskCount, optional: optionalTaskCount };

  return { server, summary };
}

/**
 * Convenience: build the server + immediately attach a stdio transport.
 * The promise resolves once the server is connected and ready to serve.
 *
 * stderr-only logging convention is critical for stdio MCP servers —
 * stdout carries the JSON-RPC protocol, anything else written there
 * corrupts the connection. Use `console.error(...)` for diagnostics.
 */
export async function connectStdio(
  registry: ToolRegistry,
  options: ExposeServerOptions = {},
): Promise<{ server: McpServer; summary: ExposureSummary }> {
  const { server, summary } = buildGordonMcpServer(registry, options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, summary };
}
