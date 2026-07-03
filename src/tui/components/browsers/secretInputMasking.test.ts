import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Cleartext-secret regression guard. Exchange/broker credential prompts must
// render @inkjs/ui PasswordInput (masks with *), never a plain TextInput that
// echoes apiKey/apiSecret/passphrase/wallet keys in the clear. Non-secret
// fields (the community-venue search box) must stay TextInput.

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("credential inputs are masked", () => {
  test("ExchangePicker masks every secret field, leaves search as TextInput", () => {
    const src = read("src/tui/components/browsers/ExchangePicker.tsx");
    for (const placeholder of ["API key...", "API secret...", "Passphrase...", "0x... or base58..."]) {
      const escaped = placeholder.replace(/[.]/g, "\\.");
      expect(
        new RegExp(`<PasswordInput\\s+placeholder="${escaped}"`).test(src),
        `secret field "${placeholder}" must render PasswordInput`,
      ).toBe(true);
    }
    // Non-secret community-venue search stays a visible TextInput.
    expect(/<TextInput\s+placeholder="bybit/.test(src)).toBe(true);
  });

  test("BrokerPicker masks API key and secret", () => {
    const src = read("src/tui/components/browsers/BrokerPicker.tsx");
    for (const placeholder of ["API key...", "API secret..."]) {
      const escaped = placeholder.replace(/[.]/g, "\\.");
      expect(
        new RegExp(`<PasswordInput\\s+placeholder="${escaped}"`).test(src),
      ).toBe(true);
    }
    expect(src.includes("<TextInput")).toBe(false);
  });

  test("SetupWizard renders PasswordInput for password-typed steps", () => {
    const src = read("src/tui/components/wizards/SetupWizard.tsx");
    expect(src.includes('step.inputType === "password"')).toBe(true);
    expect(src.includes("<PasswordInput")).toBe(true);
    // Text steps still use TextInput.
    expect(src.includes("<TextInput")).toBe(true);
  });
});
