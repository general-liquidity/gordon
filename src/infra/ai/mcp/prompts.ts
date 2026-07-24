/**
 * MCP prompts — Gordon's 36 bundled skills wrapped as MCP prompts.
 *
 * Per the MCP server-concepts spec, prompts are user-controlled
 * templates that editor hosts (Cursor, Warp, Claude Code) expose via
 * slash commands ("/scan-market", "/dd", "/dca-setup"). Each prompt's
 * body is the skill's markdown content; arguments come from the skill
 * frontmatter.
 *
 * Mechanics:
 *
 *   - One MCP prompt per bundled skill (count: 36 as of v3.5)
 *   - Prompt name = skill id (kebab-case, agentskills.io-compliant)
 *   - Prompt description = skill description (the single-field
 *     migration we shipped in commit aec9e137 makes this a clean fit)
 *   - Prompt arguments come from the skill's `arguments` / `argumentHint`
 *     frontmatter (when present), surfaced as text params with the
 *     hint as description
 *   - Prompt body = skill markdown body wrapped in a single user-role
 *     message; the editor inserts it into the conversation when the
 *     operator invokes the prompt
 *
 * Per the agentskills.io standard Gordon already follows, the body
 * already contains "when to use" + "step-by-step" + "good output"
 * structure, so the LLM receiving it gets immediately-actionable
 * guidance.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { discoverSkillsFromDir } from "../../skills/loader.ts";
import type { Skill } from "../../skills/types.ts";

type RegisterPromptArgsSchema = NonNullable<
  Parameters<McpServer["registerPrompt"]>[1]["argsSchema"]
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function skillArgumentsSchema(skill: Skill): Record<string, z.ZodOptional<z.ZodString>> | undefined {
  const args = skill.frontmatter.arguments;
  if (!args) return undefined;

  // Normalize: arguments may be a single string or an array
  const argList = Array.isArray(args) ? args : [args];
  if (argList.length === 0) return undefined;

  const shape: Record<string, z.ZodOptional<z.ZodString>> = {};
  for (const name of argList) {
    if (typeof name !== "string" || !name.trim()) continue;
    // Use the argument hint as the description if present (single hint
    // applies to all args by convention — operators with multi-arg
    // skills can refine in the body).
    shape[name.trim()] = z
      .string()
      .optional()
      .describe(skill.frontmatter.argumentHint ?? `Argument ${name}`);
  }

  return Object.keys(shape).length > 0 ? shape : undefined;
}

function renderSkillBodyWithArgs(skill: Skill, args: Record<string, string | undefined>): string {
  // If the body uses $1, $2, $ARGUMENTS placeholders (agentskills.io
  // convention) and we have args, substitute them. Otherwise the body
  // is used verbatim — most Gordon skills don't use placeholders since
  // they expect the LLM to read context from the conversation.
  let body = skill.body;
  const argEntries = Object.entries(args);
  if (argEntries.length === 0) return body;

  // $ARGUMENTS = all args concatenated (skip undefined when joining)
  const defined = argEntries.filter(([, v]) => typeof v === "string") as [string, string][];
  const allArgs = defined.map(([, v]) => v).join(" ");
  body = body.replace(/\$ARGUMENTS\b/g, allArgs);

  // $1, $2, ... = positional. Each declared arg gets its slot, undefined
  // collapses to empty string (matches shell-style behavior).
  for (let i = 0; i < argEntries.length; i++) {
    const re = new RegExp(`\\$${i + 1}\\b`, "g");
    body = body.replace(re, argEntries[i]![1] ?? "");
  }

  // {name} = named substitution. Undefined collapses to empty string
  // so templates don't end up with literal `{var}` leakage when the
  // arg is omitted.
  for (const [name, value] of argEntries) {
    const re = new RegExp(`\\{${name}\\}`, "g");
    body = body.replace(re, value ?? "");
  }

  return body;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface PromptRegistrationSummary {
  count: number;
  prompts: Array<{ name: string; argCount: number }>;
}

/**
 * Register all bundled-skill prompts on the MCP server.
 *
 * Walks `src/infra/skills/builtin/`, validates each skill against
 * agentskills.io (the loader already does this), and registers one
 * MCP prompt per compliant skill. Non-compliant skills are silently
 * skipped (matches the existing loader behavior).
 */
export function registerGordonPrompts(server: McpServer): PromptRegistrationSummary {
  const skills = discoverSkillsFromDir("src/infra/skills/builtin", "builtin");
  const summary: PromptRegistrationSummary = { count: 0, prompts: [] };

  for (const skill of skills) {
    const argsSchema = skillArgumentsSchema(skill);
    const title = skill.name;

    server.registerPrompt(
      skill.id,
      {
        title,
        description: skill.description,
        // The MCP SDK bundles its own nested zod (4.3.x) whose `$ZodType` base differs
        // structurally from the app's zod 4.4 `ZodOptional<ZodString>` (cross-package
        // zod-version identity skew), so the otherwise-valid raw shape needs a cast to the
        // SDK's own expected shape type (extracted via `Parameters`, which keeps the
        // generic `Args` inference — and thus the callback typing — intact).
        ...(argsSchema
          ? { argsSchema: argsSchema as unknown as RegisterPromptArgsSchema }
          : {}),
      },
      (args) => {
        const rendered = renderSkillBodyWithArgs(skill, args ?? {});
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: rendered,
              },
            },
          ],
        };
      },
    );

    summary.count++;
    summary.prompts.push({
      name: skill.id,
      argCount: argsSchema ? Object.keys(argsSchema).length : 0,
    });
  }

  return summary;
}

// Exposed for tests
export const _internal = {
  skillArgumentsSchema,
  renderSkillBodyWithArgs,
};
