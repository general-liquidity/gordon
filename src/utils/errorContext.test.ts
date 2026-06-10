import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SLASH_COMMANDS } from "../app/slash/slashCommands.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "errorContext.ts"), "utf-8");

function extractRecoveryCommands(): string[] {
  const commands = new Set<string>();
  for (const match of source.matchAll(/command:\s*"([^"]+)"/g)) {
    const command = match[1];
    if (command?.startsWith("/")) {
      commands.add(command);
    }
  }
  return [...commands].sort();
}

describe("error recovery commands", () => {
  it("reference registered slash commands or aliases", () => {
    const registered = new Set<string>();
    for (const command of SLASH_COMMANDS) {
      registered.add(command.name);
      for (const alias of command.aliases) {
        registered.add(alias);
      }
    }

    const missing = extractRecoveryCommands().filter((command) => {
      const root = command.slice(1).split(/\s+/)[0] ?? "";
      return !registered.has(root);
    });

    expect(missing).toEqual([]);
  });
});
