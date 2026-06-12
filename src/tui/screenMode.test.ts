import { describe, expect, test } from "bun:test";

import { resolveScreenMode, type ScreenModeInputs } from "./screenMode.ts";

function base(overrides: Partial<ScreenModeInputs> = {}): ScreenModeInputs {
  return {
    env: {},
    argv: ["bun", "src/index.tsx"],
    isTTY: true,
    hasAltScreen: true,
    ...overrides,
  };
}

describe("resolveScreenMode", () => {
  test("fullscreen when TTY + alt-screen capable + no opt-outs", () => {
    expect(resolveScreenMode(base())).toBe("fullscreen");
  });

  test("GORDON_SCREEN=inline is the operator escape hatch", () => {
    expect(resolveScreenMode(base({ env: { GORDON_SCREEN: "inline" } }))).toBe("inline");
  });

  test("GORDON_SCREEN with any other value does not force inline", () => {
    expect(resolveScreenMode(base({ env: { GORDON_SCREEN: "fullscreen" } }))).toBe("fullscreen");
  });

  test("GORDON_ALT_SCREEN=false (legacy alt-screen kill switch) forces inline", () => {
    expect(resolveScreenMode(base({ env: { GORDON_ALT_SCREEN: "false" } }))).toBe("inline");
  });

  test("non-TTY stdout falls back to inline", () => {
    expect(resolveScreenMode(base({ isTTY: false }))).toBe("inline");
  });

  test("terminal without alternate screen falls back to inline", () => {
    expect(resolveScreenMode(base({ hasAltScreen: false }))).toBe("inline");
  });

  test("TERM=dumb resolves alt-screen incapable via detectTerminalCapability", () => {
    expect(
      resolveScreenMode(base({ env: { TERM: "dumb" }, hasAltScreen: undefined })),
    ).toBe("inline");
  });

  test("CI env forces inline", () => {
    expect(resolveScreenMode(base({ env: { CI: "true" } }))).toBe("inline");
    expect(resolveScreenMode(base({ env: { CI: "1" } }))).toBe("inline");
  });

  test("headless / acp argv flags force inline", () => {
    expect(resolveScreenMode(base({ argv: ["bun", "src/index.tsx", "--headless"] }))).toBe("inline");
    expect(resolveScreenMode(base({ argv: ["bun", "src/index.tsx", "--acp"] }))).toBe("inline");
  });

  test("full matrix: every single opt-out flips an otherwise-fullscreen result", () => {
    const cases: Array<[Partial<ScreenModeInputs>, "inline" | "fullscreen"]> = [
      [{}, "fullscreen"],
      [{ env: { GORDON_SCREEN: "inline" } }, "inline"],
      [{ env: { GORDON_ALT_SCREEN: "false" } }, "inline"],
      [{ env: { CI: "yes" } }, "inline"],
      [{ argv: ["x", "--headless"] }, "inline"],
      [{ isTTY: false }, "inline"],
      [{ hasAltScreen: false }, "inline"],
    ];
    for (const [overrides, expected] of cases) {
      expect(resolveScreenMode(base(overrides))).toBe(expected);
    }
  });
});
