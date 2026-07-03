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
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
  "TASTYTRADE_API_KEY",
  "TASTYTRADE_API_SECRET",
  "TASTYTRADE_ACCOUNT_ID",
  "IBKR_API_KEY",
  "IBKR_API_SECRET",
  "IBKR_ACCOUNT_ID",
  "ROBINHOOD_API_KEY",
  "ROBINHOOD_API_SECRET",
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
  "GEMINI_API_KEY",
  "GEMINI_API_SECRET",
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

  /**
   * Resolve a usable PowerShell binary. Prefers PowerShell Core (`pwsh`)
   * when installed (faster, cross-version stable), falls back to legacy
   * `powershell.exe`. Cached after first detection.
   */
  private static cachedShell: string | null = null;

  private async resolveShell(): Promise<string | null> {
    if (WindowsKeyringProvider.cachedShell) return WindowsKeyringProvider.cachedShell;
    for (const candidate of ["pwsh.exe", "pwsh", "powershell.exe", "powershell"]) {
      const result = await runCommand(candidate, ["-NoProfile", "-Command", "echo ok"]);
      if (result.exitCode === 0 && result.stdout.includes("ok")) {
        WindowsKeyringProvider.cachedShell = candidate;
        return candidate;
      }
    }
    return null;
  }

  async isAvailable(): Promise<boolean> {
    const shell = await this.resolveShell();
    return shell !== null;
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
// Bun.secrets — native bindings to the OS credential manager
// ---------------------------------------------------------------------------
//
// `Bun.secrets` (added in Bun 1.2) is a native cross-platform wrapper over
// the same OS facilities the CLI-subprocess providers above use:
//   - macOS:   Keychain Services
//   - Linux:   libsecret (GNOME Keyring / KWallet / etc.)
//   - Windows: Windows Credential Manager (DPAPI under the hood)
//
// Compared to the subprocess providers, the native API:
//   - Skips fork/exec of `security` / `secret-tool` / `powershell` per call
//     — credential reads on the hot path go from ~50ms+ to sub-millisecond.
//   - Zeroes the password memory after use (documented behavior).
//   - Returns null cleanly when a credential is missing (no exit-code dance).
//
// We add it as a preferred provider but keep the CLI-based providers as
// fallback: Bun.secrets is documented as experimental and may not exist on
// older Bun runtimes that Gordon binary builds support. Feature-detect at
// construction and fall through if absent.

interface BunSecretsApi {
  get(opts: { service: string; name: string }): Promise<string | null>;
  set(opts: { service: string; name: string; value: string }): Promise<void>;
  delete(opts: { service: string; name: string }): Promise<boolean>;
}

function tryGetBunSecrets(): BunSecretsApi | null {
  const bun = (globalThis as { Bun?: { secrets?: unknown } }).Bun;
  const secrets = bun?.secrets;
  if (!secrets || typeof secrets !== "object") return null;
  const api = secrets as Partial<BunSecretsApi>;
  if (typeof api.get !== "function" || typeof api.set !== "function" || typeof api.delete !== "function") {
    return null;
  }
  return api as BunSecretsApi;
}

class BunSecretsKeyringProvider implements KeyringProvider {
  readonly platform: string;
  private readonly api: BunSecretsApi;
  // List API doesn't exist on Bun.secrets, so we shadow-track keys in a
  // sidecar index file. Reads still go straight to the OS keychain — the
  // index is only consulted by .list() and may legitimately drift if the
  // user adds entries via Keychain Access / seahorse / Credential Manager
  // directly. Documented limitation.
  private readonly indexPath: string;

  constructor(api: BunSecretsApi) {
    this.api = api;
    this.platform = `Bun.secrets (${process.platform})`;
    this.indexPath = join(GORDON_DIR, "keyring-index.json");
  }

  async isAvailable(): Promise<boolean> {
    // We've already feature-detected the API in the factory; just confirm
    // the platform's secret service is actually reachable by attempting a
    // benign read. A throw here means libsecret isn't running, etc., and
    // the factory should fall back to a CLI provider.
    try {
      await this.api.get({ service: SERVICE_NAME, name: "__gordon_probe__" });
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.api.get({ service: SERVICE_NAME, name: key });
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.api.set({ service: SERVICE_NAME, name: key, value });
    await this.addToIndex(key);
  }

  async delete(key: string): Promise<boolean> {
    let deleted = false;
    try {
      deleted = await this.api.delete({ service: SERVICE_NAME, name: key });
    } catch {
      deleted = false;
    }
    await this.removeFromIndex(key);
    return deleted;
  }

  async list(): Promise<string[]> {
    return await this.readIndex();
  }

  private async readIndex(): Promise<string[]> {
    if (!existsSync(this.indexPath)) return [];
    try {
      const parsed = (await Bun.file(this.indexPath).json()) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
      return [];
    } catch {
      return [];
    }
  }

  private async writeIndex(keys: string[]): Promise<void> {
    await mkdir(GORDON_DIR, { recursive: true });
    await Bun.write(this.indexPath, JSON.stringify(Array.from(new Set(keys)).sort(), null, 2));
  }

  private async addToIndex(key: string): Promise<void> {
    const keys = await this.readIndex();
    if (keys.includes(key)) return;
    keys.push(key);
    await this.writeIndex(keys);
  }

  private async removeFromIndex(key: string): Promise<void> {
    const keys = await this.readIndex();
    const filtered = keys.filter((k) => k !== key);
    if (filtered.length === keys.length) return;
    await this.writeIndex(filtered);
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

  // Prefer Bun.secrets when present — native bindings, no subprocess per
  // call. Set GORDON_KEYRING_LEGACY=1 to force the CLI-subprocess
  // providers (used by the unit test that exercises the legacy path).
  if (process.env.GORDON_KEYRING_LEGACY !== "1") {
    const bunSecrets = tryGetBunSecrets();
    if (bunSecrets) {
      _cachedProvider = new BunSecretsKeyringProvider(bunSecrets);
      return _cachedProvider;
    }
  }

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
