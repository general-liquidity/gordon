import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GordonConfigSchema } from "../../../types/index.ts";
import { getBuiltInAgentRailListings, syncAgentRailMcpPlugins } from "./index.ts";
import { createAgentRailsRegistry } from "./registry.ts";
import { pluginInstaller } from "../../ai/mcp/marketplace/installer.ts";
import { setDatabasePathForTesting } from "../../storage/database.ts";

const ORIGINAL_ENV = { ...process.env };
const RAIL_ENV_KEYS = [
  "HELIUS_API_KEY",
  "SOLANA_RPC_URL",
  "MOONPAY_API_KEY",
  "MOONPAY_SECRET_KEY",
  "MOONPAY_WIDGET_URL",
  "POLYGON_X402_PRIVATE_KEY",
  "POLYGON_X402_RECIPIENT",
  "POLYGON_X402_CHAIN_ID",
] as const;

let tempPluginsDir = "";

function resetRailEnv(): void {
  for (const key of RAIL_ENV_KEYS) {
    delete process.env[key];
  }
}

beforeEach(() => {
  resetRailEnv();
  tempPluginsDir = mkdtempSync(join(tmpdir(), "gordon-plugin-installer-"));
  pluginInstaller.resetForTesting(tempPluginsDir);
  setDatabasePathForTesting(join(tempPluginsDir, "gordon.db"));
});

afterEach(async () => {
  resetRailEnv();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  await pluginInstaller.initialize();
  for (const pluginId of ["helius", "moonpay"]) {
    const installed = pluginInstaller.getPlugin(pluginId);
    if (installed) {
      await pluginInstaller.uninstall(pluginId);
    }
  }
  pluginInstaller.resetForTesting();
  setDatabasePathForTesting(null);
  if (tempPluginsDir) {
    try {
      rmSync(tempPluginsDir, { recursive: true, force: true });
    } catch {
      // Windows can hold a transient lock on recently touched temp dirs.
    }
    tempPluginsDir = "";
  }
});

describe("createAgentRailsRegistry", () => {
  test("uses explicit config providers when present", () => {
    const config = GordonConfigSchema.parse({
      agentRails: {
        walletProviders: [{
          id: "moonpay-main",
          type: "moonpay",
          authMode: "hybrid",
          enabled: true,
          isDefault: true,
          mcpServerId: "moonpay",
        }],
        chainProviders: [{
          id: "helius-main",
          type: "helius",
          authMode: "hybrid",
          enabled: true,
          isDefault: true,
          network: "solana",
          mcpServerId: "helius",
        }],
        paymentProviders: [{
          id: "polygon-main",
          type: "polygon",
          authMode: "native",
          enabled: true,
          isDefault: true,
          network: "polygon",
          recipient: "0xabc",
        }],
      },
    });

    const registry = createAgentRailsRegistry(config);
    expect(registry.activeWalletProvider?.config.id).toBe("moonpay-main");
    expect(registry.activeChainProvider?.config.id).toBe("helius-main");
    expect(registry.activePaymentProvider?.config.id).toBe("polygon-main");
    expect(registry.getStatuses()).toHaveLength(3);
  });

  test("infers providers from env when config is empty", () => {
    process.env.HELIUS_API_KEY = "helius-test";
    process.env.MOONPAY_API_KEY = "moonpay-test";
    process.env.POLYGON_X402_RECIPIENT = "0xrecipient";

    const config = GordonConfigSchema.parse({});
    const registry = createAgentRailsRegistry(config);

    expect(registry.activeChainProvider?.id).toBe("helius");
    expect(registry.activeWalletProvider?.id).toBe("moonpay");
    expect(registry.activePaymentProvider?.id).toBe("polygon");
  });
});

describe("built-in agent rail listings", () => {
  test("exposes built-in MCP rail listings", () => {
    const listings = getBuiltInAgentRailListings();
    const ids = listings.map((listing) => listing.id);
    expect(ids).toContain("helius");
    expect(ids).toContain("moonpay");
  });

  test("sync installs built-in MCP plugins for hybrid providers", async () => {
    const config = GordonConfigSchema.parse({
      agentRails: {
        walletProviders: [{
          id: "moonpay-main",
          type: "moonpay",
          authMode: "hybrid",
          enabled: true,
          isDefault: true,
          mcpServerId: "moonpay",
        }],
        chainProviders: [{
          id: "helius-main",
          type: "helius",
          authMode: "hybrid",
          enabled: true,
          isDefault: true,
          network: "solana",
          mcpServerId: "helius",
        }],
      },
    });

    await syncAgentRailMcpPlugins(config);
    await pluginInstaller.initialize();

    expect(pluginInstaller.getPlugin("helius")?.enabled).toBe(true);
    expect(pluginInstaller.getPlugin("moonpay")?.enabled).toBe(true);
  });
});
