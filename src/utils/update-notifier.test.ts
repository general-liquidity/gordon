import { describe, expect, it } from "bun:test";

import { formatUpdatePromptLines } from "./update-notifier.ts";

describe("update notifier prompt formatting", () => {
  it("selectively highlights only the npm command stem", () => {
    const lines = formatUpdatePromptLines(
      "0.8.9",
      {
        command: "npm",
        args: ["install", "-g", "@general-liquidity/gordon-cli@latest"],
        display: "npm install -g @general-liquidity/gordon-cli@latest",
        publicDisplay: "gordon --upgrade",
      },
      { color: true },
    );
    const commandLine = lines[1];

    const plainLine = commandLine.replace(/\u001B\[[0-9;]*m/g, "");
    expect(plainLine).toContain("gordon --upgrade");
    expect(commandLine).toContain("\u001B[");
    expect(commandLine.match(/\u001B\[/g)?.length).toBeGreaterThan(0);
  });

  it("keeps plain-text output available for non-color terminals", () => {
    const lines = formatUpdatePromptLines(
      "0.8.9",
      {
        command: "bun",
        args: ["update", "-g", "@general-liquidity/gordon-cli"],
        display: "bun update -g @general-liquidity/gordon-cli",
        publicDisplay: "gordon --upgrade",
      },
      { color: false },
    );
    const commandLine = lines[1];

    expect(commandLine).toBe("Run now? gordon --upgrade");
  });
});
