import { describe, expect, it } from "bun:test";

import {
  getActionById,
  getActionBySlashName,
  getActionByToolName,
  getCanonicalActions,
} from "./registry.ts";
import { buildGeneratedPrompt, getGeneratedSlashCommands } from "./surfaces.ts";

describe("canonical action registry", () => {
  it("exposes preview-order as a generated slash command", () => {
    const commands = getGeneratedSlashCommands();
    const preview = commands.find((command) => command.name === "preview-order");

    expect(preview).toBeDefined();
    expect(preview?.usage).toContain("/preview-order");
  });

  it("resolves action lookups consistently across id, slash, and tool", () => {
    const byId = getActionById("trading.preview_market_order");
    const bySlash = getActionBySlashName("preview-order");
    const byTool = getActionByToolName("preview_market_order");

    expect(byId?.id).toBe("trading.preview_market_order");
    expect(bySlash?.id).toBe("trading.preview_market_order");
    expect(byTool?.id).toBe("trading.preview_market_order");
  });

  it("builds prompt text from the canonical action", () => {
    const prompt = buildGeneratedPrompt("preview-order", "BTC buy 100 quote");
    expect(prompt).toContain("Preview a market order");
    expect(prompt).toContain("BTC buy 100 quote");
  });

  it("keeps a non-empty canonical action catalog", () => {
    expect(getCanonicalActions().length).toBeGreaterThan(0);
  });
});
