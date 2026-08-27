import type { SessionRuntime } from "../../runtime/session/SessionRuntime.ts";
import type { SlashCommand } from "../../app/slash/slashCommands.ts";
import {
  handleMCPCommand,
  handleConfigCommand,
  handleExchangeCommand,
  handleBrokerCommand,
  handleStocksCommand,
  handleStrategyCommand,
  handleWorkflowCommand,
  handleExportCommand,
  handleKeyringCommand,
  handleTelemetryCommand,
  handleContextCommand,
  handleCacheAuditCommand,
  handleKillSwitchCommand,
} from "../../app/commands/index.ts";
import { handlePermissionModeCommand } from "../../app/commands/permissionMode.ts";

// ============================================================================
// Tool Command Router
//
// Commands that return a non-null result here are handled DIRECTLY — no model
// call. Only return null if the command genuinely needs the agent's reasoning.
//
// Rule: config mutations (permission mode, exchange switch, key mgmt) are
// always direct. Market queries, analysis, planning → null → agent.
// ============================================================================

export async function routeToolCommand(
  command: SlashCommand,
  args: string,
  _runtime: SessionRuntime,
): Promise<string | object | null> {
  const argsArray = args.split(/\s+/).filter(Boolean);

  switch (command.name) {
    // ── Config mutations — NEVER go through the model ──────────────────────
    // Live-capable modes (auto/ask/live) accept an ARM token that acknowledges
    // the one-time live-trading consent gate.
    case "paper":
      return handlePermissionModeCommand("paper");
    case "live":
      return handlePermissionModeCommand("ask", { ackToken: args }); // exit paper → ask
    case "auto":
      return handlePermissionModeCommand("auto", { ackToken: args });
    case "ask":
      return handlePermissionModeCommand("ask", { ackToken: args });
    case "strict":
      return handlePermissionModeCommand("strict");
    case "observe":
      return handlePermissionModeCommand("observe");
    case "planmode":
      return handlePermissionModeCommand("plan");

    // ── Exchange / broker management — direct handlers ──────────────────────
    case "mcp":
      return handleMCPCommand(argsArray);
    case "config":
      return handleConfigCommand(args);
    case "exchange":
      return handleExchangeCommand(args);
    case "broker":
      return handleBrokerCommand(args);
    case "stocks": {
      const sub = args.trim().split(/\s+/)[0]?.toLowerCase();
      if (sub === "buy" || sub === "sell") return null;
      return handleStocksCommand(args);
    }
    case "keyring":
      return handleKeyringCommand(args);
    case "telemetry":
      return handleTelemetryCommand(args);
    case "killswitch":
      return (await handleKillSwitchCommand(args)).message;
    case "context":
      return handleContextCommand(args);
    case "cache-audit":
      return handleCacheAuditCommand(args);

    // ── Strategy / workflow — direct handlers (no LLM needed for CRUD) ─────
    case "strategy":
    case "gen":
      return handleStrategyCommand(args);
    case "workflow":
      return handleWorkflowCommand(args, {} as never);
    case "export":
      return handleExportCommand(args, {} as never);

    default:
      // No explicit handler — return null to signal fallback to agent
      return null;
  }
}
