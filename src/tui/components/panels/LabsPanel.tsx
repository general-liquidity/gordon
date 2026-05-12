/**
 * LabsPanel — experimental flag manager (B7).
 *
 * Lists all opt-in feature flags and allows the user to toggle them.
 * Persists changes to ~/.gordon/labs.json. Most flags require a restart;
 * GORDON_PERF_LOG can be enabled live via /perf start as well.
 *
 * UI:
 *   Up/Down: navigate
 *   Space:   toggle current row
 *   Enter:   save + emit confirmation message
 *   Esc:     cancel (no save)
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

interface Props {
  onComplete: (message: string) => void;
  onCancel: () => void;
}

interface FlagDef {
  envName: string;
  label: string;
  description: string;
  /** "restart" — env var read once at boot. "live" — read on every check. */
  effect: "restart" | "live" | "rebuild";
  /** Optional gate: only show / count as relevant when another env is truthy. */
  gateEnv?: string;
}

const FLAGS: readonly FlagDef[] = [
  {
    envName: "GORDON_CUSTOM_RENDER",
    label: "Custom renderer (Phase 5 reconciler)",
    description: "Route through ink-custom cell-buffer pipeline",
    effect: "restart",
  },
  {
    envName: "GORDON_REACT_COMPILER",
    label: "React Compiler optimization",
    description: "Auto-memoize components at build time",
    effect: "rebuild",
  },
  {
    envName: "GORDON_POOL_MIGRATION_ENABLED",
    label: "Pool migration (custom renderer only)",
    description: "Phase 4 char-pool migration scheduler",
    effect: "restart",
    gateEnv: "GORDON_CUSTOM_RENDER",
  },
  {
    envName: "GORDON_AUTODREAM_ENABLED",
    label: "Auto-dream / idle reflection",
    description: "Background reflection loop while idle",
    effect: "restart",
  },
  {
    envName: "GORDON_REFLECTION_ENABLED",
    label: "Critique / reflection pass",
    description: "Add a reflection LLM pass on HIGH thinking depth",
    effect: "restart",
  },
  {
    envName: "GORDON_DENIAL_MEMORY_ENABLED",
    label: "Denial memory",
    description: "Persist user denials to avoid repeating prompts",
    effect: "restart",
  },
  {
    envName: "GORDON_PERF_LOG",
    label: "Performance log (live)",
    description: "Equivalent to /perf start — flushes JSONL snapshots",
    effect: "live",
  },
] as const;

// ─── Persistence ─────────────────────────────────────────────────────────────

interface LabsFile {
  flags: Record<string, "true" | "false">;
}

function gordonDir(): string {
  if (process.env.GORDON_HOME) return process.env.GORDON_HOME;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "gordon");
  return path.join(os.homedir(), ".gordon");
}

function labsPath(): string {
  return path.join(gordonDir(), "labs.json");
}

function readLabsFile(): LabsFile {
  try {
    const raw = fs.readFileSync(labsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LabsFile>;
    if (parsed && typeof parsed === "object" && parsed.flags && typeof parsed.flags === "object") {
      return { flags: parsed.flags as Record<string, "true" | "false"> };
    }
  } catch {
    // missing or unreadable — start empty
  }
  return { flags: {} };
}

function writeLabsFile(file: LabsFile): void {
  const dir = gordonDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(labsPath(), JSON.stringify(file, null, 2), "utf8");
}

/**
 * Compute the effective enabled state for a flag, preferring (in order):
 *   1. live process.env (for the "live" effect class)
 *   2. persisted labs.json
 *   3. live process.env again (for restart-class flags it's the same)
 */
function isFlagEnabled(envName: string, persisted: Record<string, "true" | "false">): boolean {
  const live = process.env[envName];
  if (live !== undefined && live !== "") {
    return live === "1" || live === "true";
  }
  const stored = persisted[envName];
  return stored === "true";
}

export function LabsPanel({ onComplete, onCancel }: Props) {
  const [persisted, setPersisted] = useState<Record<string, "true" | "false">>({});
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // Load persisted flags once on mount.
  useEffect(() => {
    const file = readLabsFile();
    setPersisted(file.flags);
    const initialDraft: Record<string, boolean> = {};
    for (const flag of FLAGS) {
      initialDraft[flag.envName] = isFlagEnabled(flag.envName, file.flags);
    }
    setDraft(initialDraft);
    setLoaded(true);
  }, []);

  const visibleFlags = useMemo(() => {
    // Always show all flags; gated ones get a (gate inactive) hint.
    return FLAGS.slice();
  }, []);

  const save = useCallback(() => {
    const next: Record<string, "true" | "false"> = { ...persisted };
    let changed = 0;
    for (const flag of FLAGS) {
      const newVal = draft[flag.envName] ? "true" : "false";
      const oldVal = persisted[flag.envName] ?? "false";
      if (newVal !== oldVal) changed += 1;
      next[flag.envName] = newVal;
    }
    try {
      writeLabsFile({ flags: next });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onComplete(`Failed to save labs.json: ${msg}`);
      return;
    }
    if (changed === 0) {
      onComplete("Labs flags unchanged.");
      return;
    }
    onComplete(`Labs flags saved (${changed} change${changed === 1 ? "" : "s"}). Restart Gordon for restart-required flags to take effect.`);
  }, [draft, persisted, onComplete]);

  useInput((input, key) => {
    if (!loaded) return;
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      save();
      return;
    }
    if (key.upArrow) {
      setCursor((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((prev) => Math.min(visibleFlags.length - 1, prev + 1));
      return;
    }
    if (input === " ") {
      const flag = visibleFlags[cursor];
      if (!flag) return;
      setDraft((prev) => ({ ...prev, [flag.envName]: !prev[flag.envName] }));
    }
  });

  if (!loaded) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyanBright">EXPERIMENTAL FLAGS</Text>
        <Text dimColor>Loading labs.json…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyanBright" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">EXPERIMENTAL FLAGS</Text>
        <Text dimColor>  ({labsPath()})</Text>
      </Box>
      {visibleFlags.map((flag, i) => {
        const enabled = !!draft[flag.envName];
        const isCursor = i === cursor;
        const envOverride = process.env[flag.envName] !== undefined && process.env[flag.envName] !== "";
        const gateInactive = !!flag.gateEnv && !(process.env[flag.gateEnv] === "1" || process.env[flag.gateEnv] === "true");
        const hint =
          flag.effect === "restart"
            ? "(restart required)"
            : flag.effect === "rebuild"
              ? "(rebuild required)"
              : "(live)";
        return (
          <Box key={flag.envName} flexDirection="column">
            <Box>
              <Text color={isCursor ? "cyanBright" : undefined}>{isCursor ? "▸ " : "  "}</Text>
              <Text>{enabled ? "[x] " : "[ ] "}</Text>
              <Text bold={isCursor}>{flag.label.padEnd(40)}</Text>
              <Text dimColor> {hint}</Text>
              {envOverride && <Text color="yellow"> [env-override]</Text>}
              {gateInactive && <Text color="yellow"> [gate inactive]</Text>}
            </Box>
            {isCursor && (
              <Box paddingLeft={6}>
                <Text dimColor>{flag.description} — env: {flag.envName}</Text>
              </Box>
            )}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>Up/Down navigate {"·"} Space toggle {"·"} Enter save {"·"} Esc cancel</Text>
      </Box>
    </Box>
  );
}
