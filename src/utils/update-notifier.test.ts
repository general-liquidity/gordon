import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectDistTag, detectInstallContext, formatUpdatePromptLines, getUpdateCommand } from "./update-notifier.ts";

const tempDirectories: string[] = [];

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

function makeTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "gordon-update-"));
  tempDirectories.push(directory);
  return directory;
}

describe("update notifier prompt formatting", () => {
  it("selectively highlights only the npm command stem", () => {
    const lines = formatUpdatePromptLines(
      "0.8.9",
      {
        command: "npm",
        args: ["install", "-g", "@general-liquidity/gordon@latest"],
        display: "npm install -g @general-liquidity/gordon@latest",
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
        args: ["update", "-g", "@general-liquidity/gordon"],
        display: "bun update -g @general-liquidity/gordon",
        publicDisplay: "gordon --upgrade",
      },
      { color: false },
    );
    const commandLine = lines[1];

    expect(commandLine).toBe("Run now? gordon --upgrade");
  });
});

describe("install channel detection", () => {
  it("detects npm wrapper installs from the adjacent install manifest", () => {
    const directory = makeTempDirectory();
    writeFileSync(join(directory, "install.json"), JSON.stringify({ version: "0.8.21" }));

    const context = detectInstallContext({
      packageRoot: null,
      scriptArg: join(directory, "gordon"),
      execPath: join(directory, "gordon"),
      env: {},
    });

    expect(context).toEqual({
      channel: "npm",
      installDir: directory,
    });
  });

  it("detects npx self-installs from the adjacent install metadata file", () => {
    const directory = makeTempDirectory();
    writeFileSync(
      join(directory, "gordon-install.json"),
      JSON.stringify({ channel: "npx", installDir: directory }),
    );

    const context = detectInstallContext({
      packageRoot: null,
      scriptArg: join(directory, "gordon"),
      execPath: join(directory, "gordon"),
      env: {},
    });

    expect(context).toEqual({
      channel: "npx",
      installDir: directory,
    });
  });
});

describe("update command selection", () => {
  it("uses the self-install path for npx-installed binaries with the current channel's dist-tag", () => {
    const command = getUpdateCommand({
      channel: "npx",
      installDir: "/home/george/.local/bin",
    });

    // The tag matches whatever channel this build was published to
    // (friends / alpha / beta / rc / latest). Test stays correct across
    // channels instead of being hardcoded to @latest.
    const expectedTag = detectDistTag();
    expect(command).not.toBeNull();
    expect(command?.command).toBe("npx");
    expect(command?.args).toEqual([
      "--yes",
      `@general-liquidity/gordon@${expectedTag}`,
      "install",
      "--target-dir",
      "/home/george/.local/bin",
    ]);
  });

  it("uses the public tap formula for homebrew installs", () => {
    const command = getUpdateCommand({ channel: "homebrew" });

    expect(command).not.toBeNull();
    expect(command?.command).toBe("brew");
    expect(command?.args).toEqual(["upgrade", "general-liquidity/gordon/gordon"]);
  });

  it("detects the dist-tag from the version string", () => {
    expect(detectDistTag("0.9.0")).toBe("latest");
    expect(detectDistTag("0.9.0-friends.5")).toBe("friends");
    expect(detectDistTag("0.9.0-friends.12")).toBe("friends");
    expect(detectDistTag("0.9.0-alpha.1")).toBe("alpha");
    expect(detectDistTag("0.9.0-beta.3")).toBe("beta");
    expect(detectDistTag("0.9.0-rc.1")).toBe("rc");
  });
});
