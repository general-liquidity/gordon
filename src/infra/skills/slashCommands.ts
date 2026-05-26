/**
 * Skill → slash-command bridge.
 *
 * Every user-invocable skill in the registry gets a slash command
 * automatically. The command name matches the skill ID; invoking it
 * tells the agent to load and follow the skill's recipe.
 *
 * Categories are inferred from skill tags. Legacy slash commands
 * defined explicitly in slashCommands.ts win on name collisions
 * (e.g. /learn-finnhub stays the legacy entry, not the skill-derived
 * one), so this is gap-filling, not override.
 */

import { discoverSkills } from "./registry.ts";
import type { Skill } from "./types.ts";

/** Shape that matches SlashCommandSeed from app/slash/slashCommands.ts.
 *  Defined inline to avoid an upward import dependency. */
export interface SkillSlashSeed {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  category: "trading" | "market" | "account" | "system" | "strategy";
  level: 1 | 2 | 3;
  action: "agent" | "tool" | "menu";
  target?: string;
  whenToUse?: string;
  executionTime?: string;
}

/** Tag-driven category inference. Falls back to "trading" since most
 *  user-facing workflow skills are trading-flow oriented. */
function categoryForTags(tags: ReadonlyArray<string>): SkillSlashSeed["category"] {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => ["scan", "discovery", "market", "news"].includes(x))) return "market";
  if (t.some((x) => ["portfolio", "account", "balances"].includes(x))) return "account";
  if (t.some((x) => ["strategy", "backtest", "validation"].includes(x))) return "strategy";
  if (t.some((x) => ["system", "config", "diagnostic", "docs", "documentation"].includes(x))) return "system";
  return "trading";
}

function shortDescription(skill: Skill): string {
  const raw = skill.description ?? skill.name ?? skill.id;
  // First sentence up to the first period or 140 chars, whichever comes first.
  const firstSentence = raw.split(/[.!?]/)[0] ?? raw;
  const clean = firstSentence.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean;
}

function usageFor(skill: Skill): string {
  const hint = skill.frontmatter.argumentHint;
  if (hint) return `/${skill.id} ${hint}`;
  const args = skill.frontmatter.arguments;
  if (Array.isArray(args) && args.length > 0) {
    return `/${skill.id} <${args.join("> <")}>`;
  }
  if (typeof args === "string" && args.length > 0) {
    return `/${skill.id} <${args}>`;
  }
  return `/${skill.id}`;
}

/** Build a SlashCommandSeed-shaped object per user-invocable skill. */
export function getSkillSlashCommands(): SkillSlashSeed[] {
  return discoverSkills()
    .filter((s) => s.frontmatter.userInvocable !== false)
    .map((skill) => {
      const tags = skill.frontmatter.tags ?? [];
      return {
        name: skill.id,
        aliases: [],
        description: shortDescription(skill),
        usage: usageFor(skill),
        category: categoryForTags(tags),
        level: 2 as const,
        action: "agent" as const,
        whenToUse: skill.frontmatter.description ?? undefined,
      };
    });
}

/** Set of skill IDs available as slash commands. Used by the prompt
 *  converter to recognize skill-derived commands and emit a proper
 *  "load and follow this skill" prompt instead of dumping description. */
export function getSkillSlashCommandIds(): Set<string> {
  return new Set(
    discoverSkills()
      .filter((s) => s.frontmatter.userInvocable !== false)
      .map((s) => s.id),
  );
}
