import { describe, expect, it } from "bun:test";

import { parseSystemShortcut } from "./systemCommandShortcuts.ts";

describe("parseSystemShortcut", () => {
  it("recognizes plain-text arm and disarm guidance requests", () => {
    expect(parseSystemShortcut("arm")).toBe("arm");
    expect(parseSystemShortcut("arm the system")).toBe("arm");
    expect(parseSystemShortcut("disarm")).toBe("disarm");
  });

  it("recognizes plain-text system status questions deterministically", () => {
    expect(parseSystemShortcut("status")).toBe("status");
    expect(parseSystemShortcut("is the system armed?")).toBe("status");
    expect(parseSystemShortcut("am I armed")).toBe("status");
    expect(parseSystemShortcut("what is the system status")).toBe("status");
  });

  it("leaves slash commands to the slash-command parser", () => {
    expect(parseSystemShortcut("/arm")).toBeNull();
    expect(parseSystemShortcut("/disarm")).toBeNull();
    expect(parseSystemShortcut("/status")).toBeNull();
  });

  it("handles repeated phrases from pasted or duplicated input", () => {
    expect(parseSystemShortcut("is the system armed? is the system armed?")).toBe("status");
    expect(parseSystemShortcut("arm arm")).toBe("arm");
  });

  it("ignores non-system prompts", () => {
    expect(parseSystemShortcut("start the scalping process")).toBeNull();
    expect(parseSystemShortcut("scan btc and eth")).toBeNull();
  });
});
