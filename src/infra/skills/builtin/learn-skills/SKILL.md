---
name: learn-skills
description: Learn how to create custom SKILL.md trading workflows
when_to_use: When user asks about skills, custom workflows, or wants to create their own
tags: [learning, skills, customization]
user-invocable: true
---

Skills are reusable trading workflows you write in markdown. Gordon loads them automatically.

## What is a Skill?

A SKILL.md file = YAML frontmatter + markdown instructions. When you type `/skill-name`, Gordon follows the instructions using its tools.

## Example: Create a Swing Entry Checklist

Show the user this example:

```markdown
---
name: swing-check
description: Walk through swing trade entry criteria before opening a position
arguments: [symbol]
tags: [swing, risk, checklist]
user-invocable: true
---

Before opening a swing trade on {symbol}:

1. Check the daily trend (EMA 20 above EMA 50?)
2. Check RSI — is it oversold (<30) or overbought (>70)?
3. Find the nearest support and resistance levels
4. Calculate position size using 2% risk rule
5. Set stop loss below the nearest support
6. Set take profit at 2:1 reward/risk minimum
7. Check if any earnings or events are coming up

If all checks pass, show me the trade plan. If not, explain what's missing.
```

## Where to Save Skills

Explain the 3 locations:
- **Builtin**: Ship with Gordon (you can't edit these)
- **User**: `~/.gordon/skills/my-skill/SKILL.md` — available in all projects
- **Project**: `.gordon/skills/my-skill/SKILL.md` — project-specific

Project overrides user overrides builtin (same skill name).

## Frontmatter Options

Walk through the key fields:
- `name` — what you type after `/`
- `description` — shown in `/skills` list and typeahead
- `arguments` — placeholders like `{symbol}` that get replaced
- `when_to_use` — when Gordon should suggest this skill
- `tags` — for organization
- `user-invocable` — set to false to hide from `/` menu (model-only)
- `context: fork` — run in a separate sub-agent (for heavy tasks)

## Try It

"Want to create a skill right now? Tell me what trading workflow you repeat often, and I'll write the SKILL.md for you."
