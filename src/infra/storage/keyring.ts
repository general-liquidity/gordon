/**
 * OS Keyring Provider
 * Cross-platform secure credential storage using OS-native keyring/credential managers.
 * Uses CLI commands (not native addons) for Bun compatibility.
 *
 * - macOS: Keychain via /usr/bin/security
 * - Windows: DPAPI via PowerShell, stored in ~/.gordon/keyring.json
 * - Linux: libsecret via secret-tool
 * - Fallback: NullKeyringProvider (isAvailable = false)
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { GORDON_DIR } from "./paths.ts";

const SERVICE_NAME = "gordon-cli";
const KEYRING_JSON_PATH = join(GORDON_DIR, "keyring.json");

// Keys we support storing in keyring
export const KEYRING_SUPPORTED_KEYS = [
  "OPENAI_API_KEY",
  "DEDALUS_API_KEY",
  "INCEPTION_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
  "SCHWAB_API_KEY",
  "SCHWAB_API_SECRET",
  "SCHWAB_ACCOUNT_ID",
  "TRADIER_API_KEY",
  "TRADIER_API_SECRET",
  "TRADIER_ACCOUNT_ID",
  "TRADESTATION_API_KEY",
  "TRADESTATION_API_SECRET",
  "TRADESTATION_ACCOUNT_ID",
  "TASTYTRADE_API_KEY",
  "TASTYTRADE_API_SECRET",
  "TASTYTRADE_ACCOUNT_ID",
  "TRADING212_API_KEY",
  "TRADING212_API_SECRET",
  "TRADING212_ACCOUNT_ID",
  "ETRADE_API_KEY",
  "ETRADE_API_SECRET",
  "ETRADE_ACCOUNT_ID",
  "IBKR_API_KEY",
  "IBKR_API_SECRET",
  "IBKR_ACCOUNT_ID",
  "ROBINHOOD_API_KEY",
  "ROBINHOOD_API_SECRET",
  "WEBULL_API_KEY",
  "WEBULL_API_SECRET",
  "WEBULL_ACCOUNT_ID",
  "BINANCE_API_KEY",
  "BINANCE_API_SECRET",
  "BINANCE_US_API_KEY",
  "BINANCE_US_API_SECRET",
  "COINBASE_API_KEY",
  "COINBASE_API_SECRET",
  "COINBASE_PASSPHRASE",
  "KRAKEN_API_KEY",
  "KRAKEN_API_SECRET",
  "BITFINEX_API_KEY",
  "BITFINEX_API_SECRET",
  "HYPERLIQUID_PRIVATE_KEY",
  "TINYFISH_API_KEY",
  "HELIUS_API_KEY",
  "MOONPAY_API_KEY",
  "MOONPAY_SECRET_KEY",
  "MOONPAY_WEBHOOK_API_KEY",
  "MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY",
  "POLYGON_X402_PRIVATE_KEY",
  "POLYGON_X402_RECIPIENT",
] as const;

export type KeyringKey = (typeof KEYRING_SUPPORTED_KEYS)[number];

export interface KeyringProvider {
  readonly platform: string;
  isAvailable(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Shared spawn helper
// ---------------------------------------------------------------------------

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCommand(
  cmd: string,
  args: string[],
  options?: { stdin?: string; timeout?: number }
): Promise<SpawnResult> {
  const timeout = options?.timeout ?? 5000;

  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: options?.stdin ? "pipe" : undefined,
    });

    if (options?.stdin && proc.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout)
    );

    const exitCode = await Promise.race([proc.exited, timeoutPromise]);
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  } catch (err) {
    return { stdout: "", stderr: String(err), exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// macOS — Keychain via /usr/bin/security
// ---------------------------------------------------------------------------

class DarwinKeyringProvider implements KeyringProvider {
  readonly platform = "macOS Keychain";

  async isAvailable(): Promise<boolean> {
    return existsSync("/usr/bin/security");
  }

  async get(key: string): Promise<string | null> {
    const result = await runCommand("/usr/bin/security", [
      "find-generic-password",
      "-s", SERVICE_NAME,
      "-a", key,
      "-w",
    ]);
    if (result.exitCode !== 0) return null;
    return result.stdout;
  }

  async set(key: string, value: string): Promise<void> {
    // -U updates if exists, adds if not
    const result = await runCommand("/usr/bin/security", [
      "add-generic-password",
      "-U",
      "-s", SERVICE_NAME,
      "-a", key,
      "-w", value,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to store key in Keychain: ${result.stderr}`);
    }
  }

  async delete(key: string): Promise<boolean> {
    const result = await runCommand("/usr/bin/security", [
      "delete-generic-password",
      "-s", SERVICE_NAME,
      "-a", key,
    ]);
    return result.exitCode === 0;
  }

  async list(): Promise<string[]> {
    // dump-keychain and grep for our service entries
    const result = await runCommand("/usr/bin/security", [
      "dump-keychain",
    ]);
    if (result.exitCode !== 0) return [];

    const keys: string[] = [];
    const lines = result.stdout.split("\n");
    let inGordonEntry = false;

    for (const line of lines) {
      if (line.includes(`"svce"<blob>="${SERVICE_NAME}"`)) {
        inGordonEntry = true;
      }
      if (inGordonEntry && line.includes('"acct"<blob>="')) {
        const match = line.match(/"acct"<blob>="([^"]+)"/);
        if (match?.[1]) {
          keys.push(match[1]);
        }
        inGordonEntry = false;
      }
    }
    return keys;
  }
}

// ---------------------------------------------------------------------------
// Windows — DPAPI via PowerShell, stored in ~/.gordon/keyring.json
// ---------------------------------------------------------------------------

class WindowsKeyringProvider implements KeyringProvider {
  readonly platform = "Windows DPAPI";

  async isAvailable(): Promise<boolean> {
    const result = await runCommand("powershell.exe", ["-Command", "echo ok"]);
    return result.exitCode === 0 && result.stdout.includes("ok");
  }

  private async readStore(): Promise<Record<string, string>> {
    if (!existsSync(KEYRING_JSON_PATH)) return {};
    try {
      const file = Bun.file(KEYRING_JSON_PATH);
      return await file.json();
    } catch {
      return {};
    }
  }

  private async writeStore(store: Record<string, string>): Promise<void> {
    await mkdir(GORDON_DIR, { recursive: true });
    await Bun.write(KEYRING_JSON_PATH, JSON.stringify(store, null, 2));
  }

  async get(key: string): Promise<string | null> {
    const store = await this.readStore();
    const encrypted = store[key];
    if (!encrypted) return null;

    // Decrypt via DPAPI
    const script = `
      Add-Type -AssemblyName System.Security
      $encrypted = [Convert]::FromBase64String('${encrypted}')
      $decrypted = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
      [Text.Encoding]::UTF8.GetString($decrypted)
    `;
    const result = await runCommand("powershell.exe", ["-NoProfile", "-Command", script]);
    if (result.exitCode !== 0) return null;
    return result.stdout;
  }

  async set(key: string, value: string): Promise<void> {
    // Encrypt via DPAPI — pass value via stdin to avoid command-line exposure
    const script = `
      Add-Type -AssemblyName System.Security
      $input_val = [Console]::In.ReadToEnd()
      $bytes = [Text.Encoding]::UTF8.GetBytes($input_val)
      $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
      [Convert]::ToBase64String($encrypted)
    `;
    const result = await runCommand(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { stdin: value }
    );
    if (result.exitCode !== 0) {
      throw new Error(`DPAPI encryption failed: ${result.stderr}`);
    }

    const store = await this.readStore();
    store[key] = result.stdout;
    await this.writeStore(store);
  }

  async delete(key: string): Promise<boolean> {
    const store = await this.readStore();
    if (!(key in store)) return false;
    delete store[key];
    await this.writeStore(store);
    return true;
  }

  async list(): Promise<string[]> {
    const store = await this.readStore();
    return Object.keys(store);
  }
}

// ---------------------------------------------------------------------------
// Linux — libsecret via secret-tool
// ---------------------------------------------------------------------------

class LinuxKeyringProvider implements KeyringProvider {
  readonly platform = "Linux Secret Service";

  async isAvailable(): Promise<boolean> {
    const result = await runCommand("which", ["secret-tool"]);
    return result.exitCode === 0;
  }

  async get(key: string): Promise<string | null> {
    const result = await runCommand("secret-tool", [
      "lookup",
      "service", SERVICE_NAME,
      "key", key,
    ]);
    if (result.exitCode !== 0 || !result.stdout) return null;
    return result.stdout;
  }

  async set(key: string, value: string): Promise<void> {
    // secret-tool reads the secret from stdin
    const result = await runCommand(
      "secret-tool",
      [
        "store",
        "--label", `Gordon CLI: ${key}`,
        "service", SERVICE_NAME,
        "key", key,
      ],
      { stdin: value }
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to store in Secret Service: ${result.stderr}`);
    }
  }

  async delete(key: string): Promise<boolean> {
    const result = await runCommand("secret-tool", [
      "clear",
      "service", SERVICE_NAME,
      "key", key,
    ]);
    return result.exitCode === 0;
  }

  async list(): Promise<string[]> {
    const result = await runCommand("secret-tool", [
      "search",
      "--all",
      "service", SERVICE_NAME,
    ]);
    if (result.exitCode !== 0) return [];

    const keys: string[] = [];
    for (const line of result.stdout.split("\n")) {
      const match = line.match(/attribute\.key\s*=\s*(.+)/);
      if (match?.[1]) {
        keys.push(match[1].trim());
      }
    }
    return keys;
  }
}

// ---------------------------------------------------------------------------
// Null fallback
// ---------------------------------------------------------------------------

class NullKeyringProvider implements KeyringProvider {
  readonly platform = "none";

  async isAvailable(): Promise<boolean> {
    return false;
  }
  async get(_key: string): Promise<string | null> {
    return null;
  }
  async set(_key: string, _value: string): Promise<void> {
    throw new Error("No keyring provider available on this platform");
  }
  async delete(_key: string): Promise<boolean> {
    return false;
  }
  async list(): Promise<string[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _cachedProvider: KeyringProvider | null = null;

export function createKeyringProvider(): KeyringProvider {
  if (_cachedProvider) return _cachedProvider;

  switch (process.platform) {
    case "darwin":
      _cachedProvider = new DarwinKeyringProvider();
      break;
    case "win32":
      _cachedProvider = new WindowsKeyringProvider();
      break;
    case "linux":
      _cachedProvider = new LinuxKeyringProvider();
      break;
    default:
      _cachedProvider = new NullKeyringProvider();
  }
  return _cachedProvider;
}

/** Reset cached provider (for testing) */
export function resetKeyringProvider(): void {
  _cachedProvider = null;
}
