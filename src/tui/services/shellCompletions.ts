// ============================================================================
// Shell Completions — Auto-generate bash/zsh/fish completions for gordon CLI
// ============================================================================

import { writeFileSync, appendFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SUBCOMMANDS = [
  "scan", "analyze", "plan", "trade", "positions", "help", "doctor", "config",
  "exchange", "broker", "strategy", "backtest", "risk-config", "indicators",
  "consensus", "market", "defi", "regime", "evolve", "strategy-builder",
  "compact", "theme", "effort", "export", "privacy", "settings", "audit",
  "scheduler", "playbooks", "memory", "sessions", "emergency", "context",
  "diff", "stats", "rewind", "branch", "whatif", "sdk-init",
];

export function generateCompletions(shell: "bash" | "zsh" | "fish"): string {
  switch (shell) {
    case "zsh":
      return [
        "#compdef gordon",
        "_gordon() {",
        "  local -a commands",
        `  commands=(${SUBCOMMANDS.map((c) => `'${c}'`).join(" ")})`,
        '  _describe "command" commands',
        "}",
        "compdef _gordon gordon",
      ].join("\n");

    case "bash":
      return [
        "_gordon_completions() {",
        `  local commands="${SUBCOMMANDS.join(" ")}"`,
        '  COMPREPLY=($(compgen -W "$commands" -- "${COMP_WORDS[COMP_CWORD]}"))',
        "}",
        "complete -F _gordon_completions gordon",
      ].join("\n");

    case "fish":
      return SUBCOMMANDS.map(
        (cmd) => `complete -c gordon -a '${cmd}' -d '${cmd} command'`,
      ).join("\n");
  }
}

export function installCompletions(shell: "bash" | "zsh" | "fish"): boolean {
  try {
    const script = generateCompletions(shell);
    const home = homedir();

    const completionFile = join(home, ".gordon", `completions.${shell}`);
    writeFileSync(completionFile, script + "\n");

    // Add source line to shell rc
    const rcFiles: Record<string, string> = {
      bash: join(home, ".bashrc"),
      zsh: join(home, ".zshrc"),
      fish: join(home, ".config", "fish", "completions", "gordon.fish"),
    };

    const rcFile = rcFiles[shell]!;
    if (shell === "fish") {
      writeFileSync(rcFile, script + "\n");
    } else {
      const sourceLine = `\n# Gordon CLI completions\nsource "${completionFile}"\n`;
      if (existsSync(rcFile)) {
        const existing = readFileSync(rcFile, "utf-8");
        if (!existing.includes("Gordon CLI completions")) {
          appendFileSync(rcFile, sourceLine);
        }
      } else {
        writeFileSync(rcFile, sourceLine);
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function detectShell(): "bash" | "zsh" | "fish" | null {
  const shell = process.env.SHELL ?? "";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("bash")) return "bash";
  if (shell.includes("fish")) return "fish";
  return null;
}
