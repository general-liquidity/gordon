import type { SessionRuntime } from "../../runtime/session/SessionRuntime.ts";
import type { SlashCommand } from "../../app/slashCommands.ts";
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
} from "../../app/commands/index.ts";

// ============================================================================
// Tool Command Router
// ============================================================================

export async function routeToolCommand(
  command: SlashCommand,
  args: string,
  _runtime: SessionRuntime,
): Promise<string | object | null> {
  const argsArray = args.split(/\s+/).filter(Boolean);

  switch (command.name) {
    case "mcp": return handleMCPCommand(argsArray);
    case "config": return handleConfigCommand(args);
    case "exchange": return handleExchangeCommand(args);
    case "broker": return handleBrokerCommand(args);
    case "stocks": return handleStocksCommand(args);
    case "strategy":
    case "gen": return handleStrategyCommand(args);
    case "workflow": return handleWorkflowCommand(args, {} as never);
    case "export": return handleExportCommand(args, {} as never);
    case "keyring": return handleKeyringCommand(args);
    case "telemetry": return handleTelemetryCommand(args);
    case "context": return handleContextCommand(args);
    default:
      // No explicit handler — return null to signal fallback to agent
      return null;
  }
}
