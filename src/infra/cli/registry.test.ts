import { describe, it, expect } from "bun:test";
import { CLI_REGISTRY, getCLI, formatCLIRegistryForPrompt } from "./registry.ts";

describe("CLI_REGISTRY", () => {
  it("has unique IDs", () => {
    const ids = CLI_REGISTRY.map((c) => c.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it("requires id / name / bin / docsUrl on every entry", () => {
    const missing: string[] = [];
    for (const c of CLI_REGISTRY) {
      if (!c.id) missing.push("missing id");
      if (!c.name) missing.push(`${c.id}: missing name`);
      if (!c.bin) missing.push(`${c.id}: missing bin`);
      if (!c.docsUrl) missing.push(`${c.id}: missing docsUrl`);
      if (!c.commands || c.commands.length === 0) missing.push(`${c.id}: empty commands`);
    }
    expect(missing).toEqual([]);
  });

  it("includes binance-cli — the official Binance CLI", () => {
    const cli = getCLI("binance-cli");
    expect(cli).toBeDefined();
    expect(cli?.bin).toBe("binance-cli");
    expect(cli?.npmPackage).toBe("@binance/binance-cli");
    expect(cli?.markets).toContain("crypto");
    // Sanity: has at least the spot / futures-usds / wallet entries.
    const cmds = cli?.commands.map((c) => c.command) ?? [];
    expect(cmds.some((c) => c.includes("spot"))).toBe(true);
    expect(cmds.some((c) => c.includes("futures-usds"))).toBe(true);
    expect(cmds.some((c) => c.includes("wallet"))).toBe(true);
  });

  it("formatCLIRegistryForPrompt mentions binance-cli for LLM injection", () => {
    const block = formatCLIRegistryForPrompt();
    expect(block).toContain("[GORDON_AVAILABLE_CLIS]");
    expect(block).toContain("binance-cli");
  });
});
