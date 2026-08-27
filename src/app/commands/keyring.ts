/**
 * Keyring Commands
 * CLI commands for managing OS keyring secure key storage
 */

import { loadConfig, saveConfig } from "../../infra/storage/config/config.ts";
import { createKeyringProvider, KEYRING_SUPPORTED_KEYS } from "../../infra/storage/keyring.ts";

export interface KeyringCommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Main command handler for /keyring
 */
export async function handleKeyringCommand(args: string): Promise<KeyringCommandResult> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() || "status";
  const subArgs = parts.slice(1).join(" ");

  switch (subcommand) {
    case "status":
      return keyringStatus();
    case "enable":
      return keyringEnable();
    case "disable":
      return keyringDisable();
    case "store":
      return keyringStore(subArgs);
    case "clear":
      return keyringClear();
    default:
      return keyringStatus();
  }
}

/**
 * Show keyring availability and status
 */
export async function keyringStatus(): Promise<KeyringCommandResult> {
  const provider = createKeyringProvider();
  const available = await provider.isAvailable();
  const config = await loadConfig();
  const enabled = config.useKeyring ?? false;

  const lines: string[] = [
    `**Keyring Status**`,
    ``,
    `Platform backend: ${provider.platform}`,
    `Available: ${available ? "Yes" : "No"}`,
    `Enabled: ${enabled ? "Yes" : "No"}`,
  ];

  if (available && enabled) {
    const storedKeys = await provider.list();
    if (storedKeys.length > 0) {
      lines.push(``, `**Stored keys** (${storedKeys.length}):`);
      for (const key of storedKeys) {
        lines.push(`  - ${key}`);
      }
    } else {
      lines.push(``, `No keys stored in keyring yet.`);
    }
  } else if (!available) {
    lines.push(``, `Keyring is not available on this system.`, platformGuidance(provider.platform));
  } else {
    lines.push(``, `Use \`/keyring enable\` to start using the OS keyring for API keys.`);
  }

  return { success: true, message: lines.join("\n") };
}

/**
 * Enable keyring and migrate existing .env keys
 */
export async function keyringEnable(): Promise<KeyringCommandResult> {
  const provider = createKeyringProvider();
  const available = await provider.isAvailable();

  if (!available) {
    return {
      success: false,
      message: `Keyring is not available (${provider.platform}). ${platformGuidance(provider.platform)}`,
    };
  }

  const config = await loadConfig();
  config.useKeyring = true;
  await saveConfig(config);

  // Migrate existing process.env keys to keyring
  const migrated: string[] = [];
  for (const key of KEYRING_SUPPORTED_KEYS) {
    const value = process.env[key];
    if (value) {
      try {
        await provider.set(key, value);
        migrated.push(key);
      } catch {
        // Skip keys that fail to store
      }
    }
  }

  const lines = [`Keyring enabled.`];
  if (migrated.length > 0) {
    lines.push(
      `Migrated ${migrated.length} key(s) to ${provider.platform}:`,
      ...migrated.map((k) => `  - ${k}`),
      ``,
      `Your .env file is unchanged — keys are now loaded from keyring first.`,
    );
  } else {
    lines.push(`No existing keys found to migrate.`);
  }

  return { success: true, message: lines.join("\n") };
}

/**
 * Disable keyring (keys remain stored for later re-enable)
 */
export async function keyringDisable(): Promise<KeyringCommandResult> {
  const config = await loadConfig();
  config.useKeyring = false;
  await saveConfig(config);

  return {
    success: true,
    message:
      "Keyring disabled. Keys in .env will be used. Keyring entries are preserved — use `/keyring enable` to re-activate or `/keyring clear` to remove them.",
  };
}

/**
 * Store a specific key in the keyring
 */
export async function keyringStore(keyName: string): Promise<KeyringCommandResult> {
  if (!keyName) {
    return {
      success: false,
      message: `Specify a key name. Supported: ${KEYRING_SUPPORTED_KEYS.join(", ")}`,
    };
  }

  const upperKey = keyName.toUpperCase();
  if (!KEYRING_SUPPORTED_KEYS.includes(upperKey as any)) {
    return {
      success: false,
      message: `"${upperKey}" is not a supported key. Supported: ${KEYRING_SUPPORTED_KEYS.join(", ")}`,
    };
  }

  const value = process.env[upperKey];
  if (!value) {
    return {
      success: false,
      message: `${upperKey} is not set in the current environment. Set it in .env first, then run \`/keyring store ${upperKey}\`.`,
    };
  }

  const provider = createKeyringProvider();
  const available = await provider.isAvailable();
  if (!available) {
    return {
      success: false,
      message: `Keyring is not available (${provider.platform}).`,
    };
  }

  await provider.set(upperKey, value);

  return {
    success: true,
    message: `${upperKey} stored in ${provider.platform}.`,
  };
}

/**
 * Remove all Gordon keys from keyring
 */
export async function keyringClear(): Promise<KeyringCommandResult> {
  const provider = createKeyringProvider();
  const available = await provider.isAvailable();
  if (!available) {
    return {
      success: false,
      message: `Keyring is not available (${provider.platform}).`,
    };
  }

  const storedKeys = await provider.list();
  if (storedKeys.length === 0) {
    return { success: true, message: "No keys in keyring to clear." };
  }

  let cleared = 0;
  for (const key of storedKeys) {
    if (await provider.delete(key)) {
      cleared++;
    }
  }

  return {
    success: true,
    message: `Cleared ${cleared} key(s) from ${provider.platform}.`,
  };
}

function platformGuidance(platform: string): string {
  if (platform === "none") {
    switch (process.platform) {
      case "linux":
        return "Install `libsecret-tools` (Ubuntu/Debian) or `libsecret` (Fedora) to enable keyring support.";
      default:
        return "OS keyring is not supported on this platform.";
    }
  }
  return "";
}
