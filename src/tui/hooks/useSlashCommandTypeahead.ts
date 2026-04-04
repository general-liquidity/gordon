/**
 * useSlashCommandTypeahead -- Claude Code-style slash command browser with subcommands
 *
 * Typing "/" shows top-level commands grouped by 8 workflows.
 * Typing "/runtime " (with space) switches to subcommand list.
 * Typing characters filters by prefix → alias → fuzzy substring.
 * Commands with hideFromTypeahead=true are excluded from the top-level list.
 */

import { useState, useEffect, useRef } from "react";
import { SLASH_COMMANDS } from "../../app/slashCommands.ts";

export interface TypeaheadMatch {
  name: string;
  description: string;
  workflow: string;
  aliases?: string[];
  usage?: string;
  subcommandCount?: number;
  isSubcommand?: boolean;
}

// Pre-sort top-level commands (excluding hidden + subcommand-only entries)
const ALL_COMMANDS: TypeaheadMatch[] = (() => {
  const sorted = [...SLASH_COMMANDS]
    .filter((cmd) => !(cmd as any).hideFromTypeahead)
    .sort((a, b) => {
      if (a.workflowOrder !== b.workflowOrder) return a.workflowOrder - b.workflowOrder;
      return a.name.localeCompare(b.name);
    });
  return sorted.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    workflow: cmd.workflowLabel ?? cmd.workflow,
    aliases: cmd.aliases?.length ? cmd.aliases : undefined,
    usage: cmd.usage,
    subcommandCount: (cmd as any).subcommands?.length,
  }));
})();

// Index of commands that have subcommands
const SUBCOMMAND_PARENTS = new Map<string, { subcommands: string[]; descriptions: Record<string, string>; workflow: string }>();
for (const cmd of SLASH_COMMANDS) {
  const c = cmd as any;
  if (c.subcommands?.length) {
    SUBCOMMAND_PARENTS.set(cmd.name, {
      subcommands: c.subcommands,
      descriptions: c.subcommandDescriptions ?? {},
      workflow: cmd.workflowLabel ?? cmd.workflow,
    });
  }
}

export function useSlashCommandTypeahead(
  query: string,
  options: { maxResults?: number; showAllOnEmpty?: boolean } = {},
): TypeaheadMatch[] {
  const { maxResults = 50, showAllOnEmpty = true } = options;
  const [matches, setMatches] = useState<TypeaheadMatch[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    // Detect subcommand mode: "runtime " or "runtime st"
    const spaceIdx = query.indexOf(" ");
    if (spaceIdx > 0) {
      const parentName = query.slice(0, spaceIdx).toLowerCase();
      const subQuery = query.slice(spaceIdx + 1).toLowerCase();
      const parent = SUBCOMMAND_PARENTS.get(parentName);

      if (parent) {
        // Show subcommands for this parent
        const subs = parent.subcommands
          .filter((s) => !subQuery || s.startsWith(subQuery) || s.includes(subQuery))
          .map((s): TypeaheadMatch => ({
            name: `${parentName} ${s}`,
            description: parent.descriptions[s] ?? "",
            workflow: parent.workflow,
            isSubcommand: true,
          }));
        setMatches(subs);
        return;
      }
    }

    // Empty query → show top-level commands (like Claude Code)
    if (!query && showAllOnEmpty) {
      setMatches(ALL_COMMANDS.slice(0, maxResults));
      return;
    }

    if (!query) {
      setMatches([]);
      return;
    }

    const lower = query.toLowerCase();

    timerRef.current = setTimeout(() => {
      const results: TypeaheadMatch[] = [];

      // Pass 1: prefix match on name
      for (const cmd of ALL_COMMANDS) {
        if (cmd.name.toLowerCase().startsWith(lower)) {
          results.push(cmd);
        }
      }

      // Pass 2: prefix match on aliases
      if (results.length < maxResults) {
        for (const cmd of ALL_COMMANDS) {
          if (results.some((r) => r.name === cmd.name)) continue;
          if (cmd.aliases?.some((a) => a.toLowerCase().startsWith(lower))) {
            results.push(cmd);
          }
        }
      }

      // Pass 3: substring match on name or description
      if (results.length < 3) {
        for (const cmd of ALL_COMMANDS) {
          if (results.some((r) => r.name === cmd.name)) continue;
          if (
            cmd.name.toLowerCase().includes(lower) ||
            cmd.description.toLowerCase().includes(lower)
          ) {
            results.push(cmd);
          }
        }
      }

      setMatches(results.slice(0, maxResults));
    }, 80);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, maxResults, showAllOnEmpty]);

  return matches;
}
