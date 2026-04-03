/**
 * useSlashCommandTypeahead -- Prefix-filtered slash command typeahead
 * Phase 9: Takes query string, filters SLASH_COMMANDS by prefix, returns top 5 matches.
 */

import { useState, useEffect, useRef } from "react";
import { SLASH_COMMANDS } from "../../app/slashCommands.ts";

export interface TypeaheadMatch {
  name: string;
  description: string;
  workflow: string;
}

/**
 * Filters SLASH_COMMANDS by prefix match on name.
 * Returns up to 5 matching commands sorted by workflow order then name.
 * Debounces at 80ms to avoid excessive re-filtering on fast typing.
 */
export function useSlashCommandTypeahead(query: string): TypeaheadMatch[] {
  const [matches, setMatches] = useState<TypeaheadMatch[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (!query) {
      setMatches([]);
      return;
    }

    const lower = query.toLowerCase();

    timerRef.current = setTimeout(() => {
      const results: TypeaheadMatch[] = [];

      for (const cmd of SLASH_COMMANDS) {
        if (cmd.name.toLowerCase().startsWith(lower)) {
          results.push({
            name: cmd.name,
            description: cmd.description,
            workflow: cmd.workflow,
          });
          if (results.length >= 5) break;
        }
      }

      setMatches(results);
    }, 80);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [query]);

  return matches;
}
