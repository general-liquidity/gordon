import { describe, expect, test } from "bun:test";
import { buildHelpMenuEntries } from "./PromptInputHelpMenu.tsx";
import { getBinding } from "../../keybindings/keybindings.ts";

describe("buildHelpMenuEntries", () => {
  const entries = buildHelpMenuEntries();
  const labels = entries.map((e) => e.label);

  test("teaches the live inline composer affordances", () => {
    expect(labels).toContain("for commands");
    expect(labels).toContain("newline");
    expect(labels).toContain("clear input");
    expect(labels).toContain("keyboard shortcuts");
    expect(labels).toContain("history");
    expect(labels).toContain("complete command");
  });

  test("newline is shift + enter and commands are triggered with /", () => {
    const byLabel = new Map(entries.map((e) => [e.label, e.keys]));
    expect(byLabel.get("for commands")).toBe("/");
    expect(byLabel.get("newline")).toBe("shift + enter");
    expect(byLabel.get("clear input")).toBe("esc");
    expect(byLabel.get("keyboard shortcuts")).toBe("?");
  });

  test("modifier chords are pulled from the live keybinding registry", () => {
    const byLabel = new Map(entries.map((e) => [e.label, e.keys]));
    const palette = getBinding("togglePalette")?.key ?? "ctrl+p";
    const interrupt = getBinding("interruptStream")?.key ?? "ctrl+c";
    expect(byLabel.get("command palette")).toBe(palette.split("+").join(" + "));
    expect(byLabel.get("interrupt")).toBe(interrupt.split("+").join(" + "));
  });

  test("trims Claude Code entries that do not apply to a trading agent", () => {
    const joined = entries.map((e) => `${e.keys} ${e.label}`).join(" ").toLowerCase();
    expect(joined).not.toContain("bash");
    expect(joined).not.toContain("file path");
    expect(joined).not.toContain("@");
  });
});
