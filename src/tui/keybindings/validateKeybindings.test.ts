import { describe, expect, test } from "bun:test";

import { validateKeybindings, type KeyBinding } from "./keybindings.ts";

describe("validateKeybindings", () => {
  test("reports key collisions in resolution order", () => {
    const bindings: KeyBinding[] = [
      { key: "ctrl+p", action: "togglePalette" },
      { key: "ctrl+y", action: "quickApprove" },
      { key: "ctrl+p", action: "quickApprove" },
    ];

    expect(validateKeybindings(bindings)).toEqual([
      {
        key: "ctrl+p",
        when: "always",
        actions: ["togglePalette", "quickApprove"],
        winner: "togglePalette",
      },
    ]);
  });

  test("normalizes modifier order and case", () => {
    const conflicts = validateKeybindings([
      { key: "ctrl+shift+s", action: "toggleStrictMode" },
      { key: "shift+CTRL+S", action: "quickDeny" },
    ]);

    expect(conflicts[0]?.key).toBe("ctrl+shift+s");
    expect(conflicts[0]?.winner).toBe("toggleStrictMode");
  });

  test("separates shifted letters from unshifted letters", () => {
    expect(validateKeybindings([
      { key: "g", action: "scrollTop", when: "normalMode" },
      { key: "G", action: "scrollBottom", when: "normalMode" },
    ])).toEqual([]);
  });

  test("honors scope intersections", () => {
    expect(validateKeybindings([
      { key: "j", action: "scrollDown", when: "normalMode" },
      { key: "j", action: "submit", when: "insertMode" },
    ])).toEqual([]);

    const conflicts = validateKeybindings([
      { key: "escape", action: "cancel" },
      { key: "escape", action: "vimEscape", when: "insertMode" },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.actions).toEqual(["cancel", "vimEscape"]);
    expect(conflicts[0]?.when).toBe("always,insertMode");
  });

  test("ignores same-action duplicates", () => {
    expect(validateKeybindings([
      { key: "ctrl+l", action: "clearInput" },
      { key: "CTRL+L", action: "clearInput" },
    ])).toEqual([]);
  });
});
