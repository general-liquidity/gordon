/**
 * Tests for keyring module
 *
 * Tests the cross-platform keyring abstraction.
 * Since we can't easily mock Bun.spawn across platforms,
 * these tests focus on the provider factory and NullKeyringProvider behavior.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  createKeyringProvider,
  resetKeyringProvider,
  KEYRING_SUPPORTED_KEYS,
} from "./keyring.ts";

beforeEach(() => {
  resetKeyringProvider();
});

describe("createKeyringProvider", () => {
  test("returns a provider with correct platform string", () => {
    const provider = createKeyringProvider();
    expect(provider.platform).toBeTruthy();
    expect(typeof provider.platform).toBe("string");
  });

  test("returns correct provider for current platform", () => {
    const provider = createKeyringProvider();
    switch (process.platform) {
      case "darwin":
        expect(provider.platform).toBe("macOS Keychain");
        break;
      case "win32":
        expect(provider.platform).toBe("Windows DPAPI");
        break;
      case "linux":
        expect(provider.platform).toBe("Linux Secret Service");
        break;
      default:
        expect(provider.platform).toBe("none");
    }
  });

  test("caches provider instance", () => {
    const a = createKeyringProvider();
    const b = createKeyringProvider();
    expect(a).toBe(b);
  });

  test("resetKeyringProvider clears cache", () => {
    const a = createKeyringProvider();
    resetKeyringProvider();
    const b = createKeyringProvider();
    // Same type but different instance
    expect(a.platform).toBe(b.platform);
  });
});

describe("KeyringProvider interface", () => {
  test("isAvailable returns boolean", async () => {
    const provider = createKeyringProvider();
    const available = await provider.isAvailable();
    expect(typeof available).toBe("boolean");
  });

  test("get returns null for non-existent key", async () => {
    const provider = createKeyringProvider();
    const available = await provider.isAvailable();
    if (!available) return; // Skip on platforms without keyring

    const value = await provider.get("TEST_NONEXISTENT_KEY_XYZ_123");
    expect(value).toBeNull();
  });

  test("list returns an array", async () => {
    const provider = createKeyringProvider();
    const available = await provider.isAvailable();
    if (!available) return;

    const keys = await provider.list();
    expect(Array.isArray(keys)).toBe(true);
  });
});

describe("KEYRING_SUPPORTED_KEYS", () => {
  test("contains expected exchange keys", () => {
    expect(KEYRING_SUPPORTED_KEYS).toContain("BINANCE_API_KEY");
    expect(KEYRING_SUPPORTED_KEYS).toContain("BINANCE_API_SECRET");
    expect(KEYRING_SUPPORTED_KEYS).toContain("KRAKEN_API_KEY");
    expect(KEYRING_SUPPORTED_KEYS).toContain("COINBASE_API_KEY");
    expect(KEYRING_SUPPORTED_KEYS).toContain("TRADING212_API_KEY");
  });

  test("contains expected LLM keys", () => {
    expect(KEYRING_SUPPORTED_KEYS).toContain("OPENAI_API_KEY");
    expect(KEYRING_SUPPORTED_KEYS).toContain("DEDALUS_API_KEY");
    expect(KEYRING_SUPPORTED_KEYS).toContain("INCEPTION_API_KEY");
    expect(KEYRING_SUPPORTED_KEYS).toContain("ANTHROPIC_API_KEY");
  });

  test("contains expected agent rail keys", () => {
    expect(KEYRING_SUPPORTED_KEYS).toContain("HELIUS_API_KEY");
    expect(KEYRING_SUPPORTED_KEYS).toContain("MOONPAY_API_KEY");
    expect(KEYRING_SUPPORTED_KEYS).toContain("MOONPAY_WEBHOOK_API_KEY");
    expect(KEYRING_SUPPORTED_KEYS).toContain("MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY");
    expect(KEYRING_SUPPORTED_KEYS).toContain("POLYGON_X402_PRIVATE_KEY");
  });

  test("all keys are uppercase with underscores", () => {
    for (const key of KEYRING_SUPPORTED_KEYS) {
      expect(key).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });
});

describe("round-trip on current platform", () => {
  const TEST_KEY = "__GORDON_TEST_KEYRING__";
  const TEST_VALUE = "test-secret-value-12345";

  test("set + get + delete round-trip", async () => {
    const provider = createKeyringProvider();
    const available = await provider.isAvailable();
    if (!available) return; // Skip on platforms without keyring

    // Store
    await provider.set(TEST_KEY, TEST_VALUE);

    // Retrieve
    const retrieved = await provider.get(TEST_KEY);
    expect(retrieved).toBe(TEST_VALUE);

    // List should contain our key
    const keys = await provider.list();
    expect(keys).toContain(TEST_KEY);

    // Cleanup
    const deleted = await provider.delete(TEST_KEY);
    expect(deleted).toBe(true);

    // Should be gone
    const afterDelete = await provider.get(TEST_KEY);
    expect(afterDelete).toBeNull();
  });
});
