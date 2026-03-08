import { describe, expect, it } from "bun:test";

import {
  SLASH_COMMANDS,
  formatCommandHelp,
  formatPaginatedCommandHelp,
  getSlashCommandSuggestions,
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
});
