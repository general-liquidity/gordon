/**
 * argumentHint — inline ghost-text hint derived from a command's `usage` string.
 *
 * Gordon threads each command's `usage` (e.g. "/chart <symbol> [timeframe]")
 * into the typeahead but never renders it. When the composer holds an exact
 * command match followed by a trailing space, we surface the argument portion
 * of the usage as dim ghost text after the cursor.
 *
 * Claude Code parity: useTypeahead's `commandArgumentHint` (argument-hint at
 * :752, progressive generateProgressiveArgumentHint at :756). Gordon commands
 * carry only a flat `usage` string, so we tokenize it here instead of reading
 * an argNames array.
 */

import { SLASH_COMMANDS } from "../../app/slash/slashCommands.ts";

/**
 * Extract the argument tokens from a usage string, dropping the leading
 * "/command" token. Angle-bracket <required> and square-bracket [optional]
 * groups stay intact; everything else splits on whitespace.
 *
 * "/chart <symbol> [timeframe]" -> ["<symbol>", "[timeframe]"]
 * "/scan"                       -> []
 */
export function extractUsageArgs(usage: string | undefined): string[] {
  if (!usage) return [];
  // Take the primary form when the usage lists "|"-separated alternatives.
  // Split only on space-delimited pipes so bracket groups like
  // "[gainers|losers]" stay intact.
  const primary = usage.split(/\s+\|\s+/)[0]!.trim();
  if (!primary.startsWith("/")) return [];
  const tail = primary.replace(/^\/\S+\s*/, "");
  if (!tail) return [];
  return tail.match(/<[^>]+>|\[[^\]]*\]|\S+/g) ?? [];
}

let usageMap: Map<string, string> | null = null;
function commandUsageMap(): Map<string, string> {
  if (usageMap) return usageMap;
  const map = new Map<string, string>();
  for (const cmd of SLASH_COMMANDS) {
    if (cmd.usage) map.set(cmd.name.toLowerCase(), cmd.usage);
  }
  usageMap = map;
  return map;
}

export interface ArgumentHint {
  /** The next expected argument — highlighted so the user knows what to type. */
  active: string;
  /** Remaining argument tokens after the active one, shown dimmer. */
  rest: string[];
}

/**
 * Given the raw composer buffer, return the progressive argument hint, or null
 * when no hint applies. A hint applies only when the buffer is an exact command
 * match followed by a trailing space (i.e. the user is ready to type the next
 * argument). Each already-typed argument is dropped from the front, so the
 * "active" token always names the next expected argument; the hint disappears
 * once every argument has been supplied.
 */
export function argumentHintFor(buffer: string): ArgumentHint | null {
  if (!buffer.startsWith("/") || !buffer.endsWith(" ")) return null;
  const parts = buffer.trim().split(/\s+/);
  const name = parts[0]!.slice(1).toLowerCase();
  const usage = commandUsageMap().get(name);
  if (!usage) return null;
  const args = extractUsageArgs(usage);
  const typed = parts.length - 1; // tokens after the command name
  const remaining = args.slice(typed);
  if (remaining.length === 0) return null;
  return { active: remaining[0]!, rest: remaining.slice(1) };
}
