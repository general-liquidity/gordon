import { describe, expect, test } from "bun:test";
import { SLASH_COMMANDS } from "../../app/slash/slashCommands.ts";
import { routeToolCommand } from "./toolHandlers.ts";

describe("routeToolCommand", () => {
  test("routes stocks buy/sell through the agent stack", async () => {
    const command = SLASH_COMMANDS.find((entry) => entry.name === "stocks");
    expect(command).toBeDefined();

    expect(await routeToolCommand(command!, "buy AAPL 5", {} as never)).toBeNull();
    expect(await routeToolCommand(command!, "sell MSFT 2", {} as never)).toBeNull();
    expect(await routeToolCommand(command!, "quote AAPL", {} as never)).toBeTypeOf("string");
  });
});
