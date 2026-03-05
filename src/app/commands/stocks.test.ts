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
});

