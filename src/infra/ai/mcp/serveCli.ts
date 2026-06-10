#!/usr/bin/env bun
/**
 * Gordon-as-MCP-server entry point.
 *
 * Run via:
 *   bun run src/infra/ai/mcp/serveCli.ts
 *
 * Wire into MCP-aware clients:
 *
 *   Claude Code:
 *     claude mcp add gordon -- bun run /path/to/gordon-cli-alpha/src/infra/ai/mcp/serveCli.ts
 *
 *   Cursor (~/.cursor/mcp.json):
 *     {
 *       "mcpServers": {
 *         "gordon": {
 *           "command": "bun",
 *           "args": ["run", "/path/to/gordon-cli-alpha/src/infra/ai/mcp/serveCli.ts"]
 *         }
 *       }
 *     }
 *
 *   Warp.dev: same JSON shape via Warp's MCP settings panel.
 *
 * Environment:
 *   GORDON_MCP_ALLOW_EXECUTION=1   — opt in to exposing execution + cancel
 *                                    + wallet-transfer tools. Default-deny.
 *                                    Read it twice before flipping this
 *                                    on for a remote client.
 *   GORDON_MCP_TOOL_ALLOWLIST=a,b  — comma-separated list of tool IDs to
 *                                    expose. Overrides the default
 *                                    "expose everything not denied" mode.
 *
 * stdio transport convention: anything written to stdout is interpreted
 * as JSON-RPC and corrupts the wire protocol. Diagnostics MUST go to
 * stderr. The startup banner uses `console.error` deliberately.
 */

import { installProductionGuards } from "../../safety/installProductionGuards.ts";
import { connectStdio, type ToolRegistry } from "./exposeServer.ts";
import {
  instrumentedTradingTools,
  instrumentedMarketTools,
  instrumentedMarketAnalysisTools,
  instrumentedIndicatorTools,
  instrumentedChartTools,
} from "../../agents/tooling/instrumentedTools.ts";
import { getMcpGordonExecContext } from "./mcpContext.ts";

function parseAllowList(): string[] | undefined {
  const raw = process.env.GORDON_MCP_TOOL_ALLOWLIST;
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.length > 0 ? ids : undefined;
}

async function main(): Promise<void> {
  installProductionGuards();
  // Compose the read-mostly exposed registry. The deny-list inside
  // exposeServer still gates execution tools even from this superset.
  // Adding more tool buckets here (e.g. newsTools, scannerTools) widens
  // the safe surface; the operator can always tighten with
  // GORDON_MCP_TOOL_ALLOWLIST.
  // Cast to the structural ToolRegistry shape. Mastra's per-tool Tool<I, O>
  // generics carry input/output type narrowing that doesn't unify across a
  // multi-tool registry — at the MCP wire boundary all tools share the
  // same {id, description, inputSchema, execute} runtime contract, so the
  // structural cast is correct and the exposeServer wrapper validates
  // shape via Zod at call time.
  const { execContext } = await getMcpGordonExecContext();
  const registry = {
    ...instrumentedTradingTools,
    ...instrumentedMarketTools,
    ...instrumentedMarketAnalysisTools,
    ...instrumentedIndicatorTools,
    ...instrumentedChartTools,
  } as unknown as ToolRegistry;

  const allowList = parseAllowList();

  const { summary } = await connectStdio(registry, {
    name: "gordon",
    version: "0.1.0",
    allowList,
    execContext,
  });

  console.error(
    `[gordon-mcp] running on stdio — exposed ${summary.exposed.length} tools, denied ${summary.denied.length}`,
  );
  if (summary.denied.length > 0) {
    console.error(
      `[gordon-mcp] denied tools: ${summary.denied
        .map((d) => `${d.id} (${d.reason})`)
        .join(", ")}`,
    );
  }
  if (allowList) {
    console.error(`[gordon-mcp] allowList active: ${allowList.join(", ")}`);
  }
}

main().catch((error) => {
  console.error("[gordon-mcp] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
