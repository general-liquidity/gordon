import { describe, expect, it } from "bun:test";

import {
  SLASH_COMMANDS,
  formatCommandHelp,
  formatPaginatedCommandHelp,
  getSlashCommandSuggestions,
  getSlashCommandRuntimeDrift,
  isRuntimeHandledSlashCommand,
  parseHelpArg,
} from "./slashCommands.ts";

describe("slash command UX formatting", () => {
  it("formats default help around workflows instead of legacy categories", () => {
    const help = formatCommandHelp();

    expect(help).toContain("Core Workflows");
    expect(help).toContain("Discover");
    expect(help).toContain("Analyze");
    expect(help).not.toContain("Market Discovery");
    expect(help).not.toContain("[L2]");
  });

  it("parses legacy help terms into workflow topics", () => {
    expect(parseHelpArg("market")).toEqual({ mode: "all", category: "discover" });
    expect(parseHelpArg("analysis")).toEqual({ mode: "all", category: "analyze" });
    expect(parseHelpArg("strategy")).toEqual({ mode: "all", category: "run" });
  });

  it("formats workflow-specific help without exposing aliases by default", () => {
    const help = formatPaginatedCommandHelp("trade");

    expect(help).toContain("Trade Commands");
    expect(help).toContain("/preview-order");
    expect(help).not.toContain("(order-preview)");
  });

  it("sorts slash suggestions by workflow presentation order", () => {
    const suggestions = getSlashCommandSuggestions("/");

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.workflow).toBe("discover");
    expect(suggestions.find((command) => command.name === "analyze")?.workflow).toBe("analyze");
  });

  it("orders commands alphabetically within each workflow", () => {
    const tradeCommandNames = SLASH_COMMANDS
      .filter((command) => command.workflow === "trade")
      .map((command) => command.name);

    expect(tradeCommandNames).toEqual([...tradeCommandNames].sort((left, right) => left.localeCompare(right)));
  });

  it("normalizes all slash commands with workflow and audience metadata", () => {
    const scan = SLASH_COMMANDS.find((command) => command.name === "scan");
    const doctor = SLASH_COMMANDS.find((command) => command.name === "doctor");

    expect(scan?.workflow).toBe("discover");
    expect(doctor?.workflow).toBe("operate");
    expect(doctor?.audienceLabel).toBeDefined();
  });

  it("includes explicit workspace navigation commands", () => {
    const menu = SLASH_COMMANDS.find((command) => command.name === "menu");
    const chat = SLASH_COMMANDS.find((command) => command.name === "chat");

    expect(menu?.workflow).toBe("operate");
    expect(menu?.action).toBe("menu");
    expect(menu?.aliases).toContain("home");
    expect(chat?.workflow).toBe("operate");
    expect(chat?.target).toBe("chat");
  });

  it("includes CLI-native systematic workflows", () => {
    const systematic = SLASH_COMMANDS.find((command) => command.name === "systematic");
    const dataset = SLASH_COMMANDS.find((command) => command.name === "dataset");
    const runtime = SLASH_COMMANDS.find((command) => command.name === "runtime");

    expect(systematic?.workflow).toBe("run");
    expect(systematic?.target).toBe("backtester");
    expect(dataset?.workflow).toBe("run");
    expect(dataset?.aliases).toContain("datasets");
    expect(runtime?.workflow).toBe("run");
    expect(runtime?.target).toBe("monitor");
  });

  it("includes typed action-log workflow commands", () => {
    const actionLog = SLASH_COMMANDS.find((command) => command.name === "action-log");
    const bookmark = SLASH_COMMANDS.find((command) => command.name === "bookmark");
    const compactThread = SLASH_COMMANDS.find((command) => command.name === "compact-thread");

    expect(actionLog?.workflow).toBe("operate");
    expect(actionLog?.target).toBe("action-log");
    expect(bookmark?.aliases).toContain("pin");
    expect(compactThread?.target).toBe("compact-thread");
  });

  it("adds shorter pi-style aliases for session and log utilities", () => {
    const rename = SLASH_COMMANDS.find((command) => command.name === "rename-thread");
    const actionLog = SLASH_COMMANDS.find((command) => command.name === "action-log");
    const threadSummary = SLASH_COMMANDS.find((command) => command.name === "thread-summary");
    const compactThread = SLASH_COMMANDS.find((command) => command.name === "compact-thread");
    const runtimeState = SLASH_COMMANDS.find((command) => command.name === "runtime-state");
    const runtimeTranscript = SLASH_COMMANDS.find((command) => command.name === "runtime-transcript");

    expect(rename?.aliases).toContain("name");
    expect(actionLog?.aliases).toContain("log");
    expect(threadSummary?.aliases).toContain("summary");
    expect(compactThread?.aliases).toContain("compact");
    expect(runtimeState?.aliases).toContain("rs");
    expect(runtimeTranscript?.aliases).toContain("transcript");
  });

  it("has no deterministic slash-command drift between registry and runtime", () => {
    expect(getSlashCommandRuntimeDrift()).toEqual([]);
  });

  it("keeps built-in deterministic commands wired directly", () => {
    const telemetry = SLASH_COMMANDS.find((command) => command.name === "telemetry");
    const context = SLASH_COMMANDS.find((command) => command.name === "context");
    const portfolio = SLASH_COMMANDS.find((command) => command.name === "portfolio");
    const status = SLASH_COMMANDS.find((command) => command.name === "status");
    const keyring = SLASH_COMMANDS.find((command) => command.name === "keyring");
    const orders = SLASH_COMMANDS.find((command) => command.name === "orders");
    const positions = SLASH_COMMANDS.find((command) => command.name === "positions");

    expect(telemetry?.action).toBe("menu");
    expect(context?.action).toBe("menu");
    expect(portfolio?.action).toBe("menu");
    expect(status?.action).toBe("tool");
    expect(keyring?.action).toBe("tool");
    expect(orders?.action).toBe("tool");
    expect(positions?.action).toBe("tool");
    expect(telemetry && isRuntimeHandledSlashCommand(telemetry)).toBe(true);
    expect(context && isRuntimeHandledSlashCommand(context)).toBe(true);
    expect(portfolio && isRuntimeHandledSlashCommand(portfolio)).toBe(true);
    expect(status && isRuntimeHandledSlashCommand(status)).toBe(true);
    expect(keyring && isRuntimeHandledSlashCommand(keyring)).toBe(true);
    expect(orders && isRuntimeHandledSlashCommand(orders)).toBe(true);
    expect(positions && isRuntimeHandledSlashCommand(positions)).toBe(true);
  });

  it("relabels prompt-routed analysis shortcuts as agent commands", () => {
    const trending = SLASH_COMMANDS.find((command) => command.name === "trending");
    const volume = SLASH_COMMANDS.find((command) => command.name === "volume");
    const ta = SLASH_COMMANDS.find((command) => command.name === "ta");

    expect(trending?.action).toBe("agent");
    expect(volume?.action).toBe("agent");
    expect(ta?.action).toBe("agent");
  });

  it("adds a direct context diagnostics command with a short alias", () => {
    const context = SLASH_COMMANDS.find((command) => command.name === "context");

    expect(context?.aliases).toContain("cost");
    expect(context?.target).toBe("context");
    expect(context && isRuntimeHandledSlashCommand(context)).toBe(true);
  });

  it("wires runtime inspection commands directly", () => {
    const runtimeState = SLASH_COMMANDS.find((command) => command.name === "runtime-state");
    const runtimeTranscript = SLASH_COMMANDS.find((command) => command.name === "runtime-transcript");
    const runtimeScratchpad = SLASH_COMMANDS.find((command) => command.name === "runtime-scratchpad");
    const runtimeHandoffs = SLASH_COMMANDS.find((command) => command.name === "runtime-handoffs");
    const runtimeApprovals = SLASH_COMMANDS.find((command) => command.name === "runtime-approvals");
    const runtimeApprove = SLASH_COMMANDS.find((command) => command.name === "runtime-approve");
    const runtimeDeny = SLASH_COMMANDS.find((command) => command.name === "runtime-deny");
    const runtimeBridge = SLASH_COMMANDS.find((command) => command.name === "runtime-bridge");
    const runtimeHistory = SLASH_COMMANDS.find((command) => command.name === "runtime-history");

    expect(runtimeState?.target).toBe("runtime-state");
    expect(runtimeTranscript?.target).toBe("runtime-transcript");
    expect(runtimeScratchpad?.target).toBe("runtime-scratchpad");
    expect(runtimeHandoffs?.target).toBe("runtime-handoffs");
    expect(runtimeApprovals?.target).toBe("runtime-approvals");
    expect(runtimeApprove?.target).toBe("runtime-approve");
    expect(runtimeDeny?.target).toBe("runtime-deny");
    expect(runtimeBridge?.target).toBe("runtime-bridge");
    expect(runtimeHistory?.target).toBe("runtime-history");
    expect(runtimeState && isRuntimeHandledSlashCommand(runtimeState)).toBe(true);
    expect(runtimeTranscript && isRuntimeHandledSlashCommand(runtimeTranscript)).toBe(true);
    expect(runtimeScratchpad && isRuntimeHandledSlashCommand(runtimeScratchpad)).toBe(true);
    expect(runtimeHandoffs && isRuntimeHandledSlashCommand(runtimeHandoffs)).toBe(true);
    expect(runtimeApprovals && isRuntimeHandledSlashCommand(runtimeApprovals)).toBe(true);
    expect(runtimeApprove && isRuntimeHandledSlashCommand(runtimeApprove)).toBe(true);
    expect(runtimeDeny && isRuntimeHandledSlashCommand(runtimeDeny)).toBe(true);
    expect(runtimeBridge && isRuntimeHandledSlashCommand(runtimeBridge)).toBe(true);
    expect(runtimeHistory && isRuntimeHandledSlashCommand(runtimeHistory)).toBe(true);
  });
});
