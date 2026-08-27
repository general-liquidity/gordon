import { afterEach, describe, expect, test } from "bun:test";

import { parseCommand } from "./cli.ts";

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv = [...originalArgv];
});

describe("cli command parsing", () => {
  test("parses doctor command with args", () => {
    process.argv = ["bun", "src/index.tsx", "doctor", "--json"];
    expect(parseCommand()).toEqual({ name: "doctor", args: ["--json"] });
  });

  test("parses configure command with section", () => {
    process.argv = ["bun", "src/index.tsx", "configure", "llm"];
    expect(parseCommand()).toEqual({ name: "configure", args: ["llm"] });
  });

  test("preserves bootstrap flags for downstream parsing", () => {
    process.argv = [
      "bun",
      "src/index.tsx",
      "bootstrap",
      "--profile",
      "quickstart",
      "--llm-provider",
      "openai",
      "--llm-key",
      "sk-test",
    ];
    expect(parseCommand()).toEqual({
      name: "bootstrap",
      args: ["--profile", "quickstart", "--llm-provider", "openai", "--llm-key", "sk-test"],
    });
  });
});
