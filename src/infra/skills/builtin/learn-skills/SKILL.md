---
name: learn-skills
description: How to author Gordon skills following Anthropic's official SKILL.md standard — single-field description with WHAT + WHEN + triggers, progressive disclosure. When user asks "how do I make a skill?", "SKILL.md format", "build a custom workflow", "skill frontmatter", or about authoring Gordon skills
tags: [learning, skills, customization, anthropic-standard]
user-invocable: true
status: active
last-reviewed: 2026-05-23
---

Skills are reusable trading workflows you write in markdown. Gordon loads them automatically when their `description` matches what the user is doing.

## What is a Skill?

A SKILL.md file = YAML frontmatter + markdown instructions. When you type `/skill-name`, Gordon follows the instructions using its tools.

## Anthropic's hard requirements (don't skip)

Gordon's skill loader follows the official Anthropic Agent Skills standard. Five rules are non-negotiable:

1. **File name must be exactly `SKILL.md`** (case-sensitive). Not `skill.md`, not `SKILL.MD`.
2. **Folder name must be kebab-case.** `my-cool-skill` ✅. Not `MyCoolSkill`, not `my_cool_skill`, not `My Cool Skill`.
3. **No `README.md` inside the skill folder.** All docs go in `SKILL.md` or `references/`. (A repo-level README for human readers is fine — that's outside the skill folder.)
4. **Frontmatter must have `---` delimiters** above and below the YAML block.
5. **`name` field must match folder name exactly** and cannot contain `claude` or `anthropic` (reserved).

## Example: Create a Swing Entry Checklist

```markdown
---
name: swing-check
description: Walk through swing trade entry criteria before opening a position. When user says "swing entry on X", "check before swing trade", or wants a pre-trade checklist
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

## The one field that decides if your skill ever runs

`description` is how Claude decides whether to load your skill. Get it wrong and the skill exists but is invisible.

Per the Anthropic standard, `description` must contain three things in one field:

`[WHAT it does] + [WHEN to use it] + [literal user trigger phrases]`

**Bad descriptions (real examples from Anthropic's guide):**
- "Helps with projects." — too vague
- "Creates sophisticated multi-page documentation systems." — missing triggers
- "Implements the Project entity model with hierarchical relationships." — too technical

**Good descriptions** combine all three pieces in a single field. Compare:

- ❌ "Portfolio risk assessment" (WHAT only — no WHEN, no triggers)
- ❌ "When user wants risk analysis" (WHEN only — no WHAT)
- ✅ "Portfolio risk assessment — check exposure, concentration, and drawdown status. When user asks 'am I too concentrated?', 'what's my exposure?', or 'how risky is my portfolio?'" (all three in one field)

Quoted user phrases dramatically improve trigger reliability. Look at `learn-calibration` and `tutorial` in Gordon's builtin skills for in-repo examples.

> **Schema note:** Earlier versions of Gordon used a separate `when_to_use` field. That schema has been migrated. The loader now only parses `description` — any `when_to_use` field in your SKILL.md is ignored. Put the WHEN content inside `description`, after a period.

## Where to Save Skills

- **Builtin**: `src/infra/skills/builtin/<name>/SKILL.md` — ship with Gordon (read-only for users)
- **User**: `~/.gordon/skills/<name>/SKILL.md` — available in all your projects
- **Project**: `.gordon/skills/<name>/SKILL.md` — project-specific

Override order: **project > user > builtin** (same skill name).

## Frontmatter Options

| Field | Required | Purpose |
|---|---|---|
| `name` | yes | What you type after `/`; must match folder name; kebab-case |
| `description` | yes | The WHAT + WHEN + triggers in one field; under 1024 chars |
| `arguments` | optional | Placeholders like `{symbol}` that get replaced |
| `tags` | optional | For organization; affects search/filter |
| `user-invocable` | optional | Set `false` to hide from `/` menu (model-only) |
| `context: fork` | optional | Run in a separate sub-agent (heavy/long-running tasks) |

## Forbidden in frontmatter

- XML angle brackets (`<` or `>`) — security restriction (frontmatter is injected into Claude's system prompt)
- Skills named with `claude` or `anthropic` prefix (reserved)
- Bodies over ~5000 words (split detail into `references/` instead — progressive disclosure)

## Progressive disclosure

Keep `SKILL.md` focused on the core workflow. If you need long reference content (API patterns, error codes, examples), put it in `references/` files and link from `SKILL.md`. Claude loads referenced content only when needed, saving tokens.

```
swing-check/
├── SKILL.md              # Core workflow (concise)
├── references/
│   └── risk-rules.md     # Detail only loaded when relevant
└── scripts/
    └── validate_size.py  # Optional executable helper
```

## Try It

"Want to create a skill right now? Tell me what trading workflow you repeat often, and I'll write the SKILL.md for you — following the Anthropic standard so it triggers reliably and works in any Claude surface."
