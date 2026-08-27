import { describe, expect, test } from "bun:test";
import { handleStocksCommand } from "./stocks.ts";

describe("stocks command routing", () => {
  test("shows help text", async () => {
    const message = await handleStocksCommand("help");
    expect(message).toContain("Stocks Commands:");
    expect(message).toContain("/stocks quote <symbol>");
  });

  test("handles unknown subcommand", async () => {
    const message = await handleStocksCommand("not-a-command");
    expect(message).toContain("Error: Unknown stocks subcommand");
  });

  test("blocks direct buy/sell execution", async () => {
    const message = await handleStocksCommand("buy AAPL 5");
    expect(message).toContain("Error:");
    expect(message).toContain("agent");
    expect(message).toContain("classify_trade_risk");
  });
});
