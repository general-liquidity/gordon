import { describe, expect, test } from "bun:test";
import { handleBrokerCommand } from "./broker.ts";

describe("broker command routing", () => {
  test("shows help text", async () => {
    const message = await handleBrokerCommand("help");
    expect(message).toContain("Broker Management Commands:");
    expect(message).toContain("/broker add <type>");
  });

  test("handles unknown subcommand", async () => {
    const message = await handleBrokerCommand("unknown-cmd");
    expect(message).toContain("Error: Unknown subcommand");
  });

  test("requires broker type for add", async () => {
    const message = await handleBrokerCommand("add");
    expect(message).toContain("Usage: /broker add <type>");
  });

  test("rejects unsupported broker types", async () => {
    const message = await handleBrokerCommand("add unsupported-broker");
    expect(message).toContain("Error: Unsupported broker type");
    expect(message).toContain("alpaca");
    expect(message).toContain("tastytrade");
    expect(message).toContain("ibkr");
  });
});
