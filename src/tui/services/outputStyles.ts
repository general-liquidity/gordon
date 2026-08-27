// ============================================================================
// Output Styles — Custom response formatting modes
// ============================================================================
//
// Built-in personas are the stable core. Operators can extend the set with
// markdown files under ~/.gordon/output-styles/*.md — each file is one
// persona (frontmatter `name`/`description`, body = the style instruction
// injected as a prompt addendum). User files extend, never replace, the
// built-ins; a user file whose id collides with a built-in is ignored.
//
// Safety: a persona body is injected into the prompt as instructions, so it
// is a prompt-injection surface the same way a third-party SKILL.md body is.
// We reuse the same guard — scan the body with `checkForInjection`, block
// blocking-level bodies under GORDON_SKILL_INJECTION_GUARD, and neutralize an
// injected description with `sanitizeToolDescription`.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { getGordonDir } from "../../infra/storage/paths.ts";
import { parseFrontmatter } from "../../infra/skills/loader.ts";
import {
  checkForInjection,
  sanitizeToolDescription,
} from "../../infra/safety/defense/injectionDefense.ts";
import { isSkillInjectionGuardEnabled } from "../../infra/skills/skillSecurity.ts";

export interface OutputStyle {
  id: string;
  name: string;
  description: string;
  promptAddendum: string;
}

const BUILTIN_STYLES: OutputStyle[] = [
  { id: "default", name: "Default", description: "Standard response format", promptAddendum: "" },
  {
    id: "brief",
    name: "Brief",
    description: "Just fills, P&L, and key numbers. No prose.",
    promptAddendum:
      "Be extremely concise. Only output numbers, prices, and key metrics. No explanations.",
  },
  {
    id: "detailed",
    name: "Detailed",
    description: "Full reasoning, indicator values, confidence scores",
    promptAddendum:
      "Provide detailed analysis with all indicator values, reasoning chain, and confidence scores.",
  },
  {
    id: "risk-focused",
    name: "Risk-Focused",
    description: "Emphasizes risk metrics in every response",
    promptAddendum:
      "Always lead with risk assessment. Show position sizing, stop distances, max loss, drawdown, and correlation exposure.",
  },
];

/** Same cap the skill loader applies — bounds memory + token cost per file. */
const MAX_STYLE_FILE_SIZE = 64 * 1024;
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function userStylesDir(): string {
  return join(getGordonDir(), "output-styles");
}

/**
 * Load one operator persona from a markdown file. Returns null (skipped) when
 * the file is oversized, malformed (no usable name), or carries a
 * blocking-level prompt injection in its body under the injection guard.
 */
function loadStyleFromFile(filePath: string): OutputStyle | null {
  try {
    let size: number | undefined;
    try {
      size = statSync(filePath).size;
    } catch {
      /* fall through */
    }
    if (size !== undefined && size > MAX_STYLE_FILE_SIZE) return null;

    const raw = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);

    const fileBase = basename(filePath).replace(/\.md$/i, "");
    const name =
      typeof frontmatter.name === "string" && frontmatter.name.trim()
        ? frontmatter.name.trim()
        : fileBase;
    const id = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    if (!id || !ID_PATTERN.test(id)) return null;

    const rawDescription =
      typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
    const addendum = body.trim();
    if (!addendum) return null; // a persona with no style instruction is useless

    // Body is instructions → can only be flagged/blocked, not wrapped-as-data.
    const bodyCheck = checkForInjection(addendum);
    if (isSkillInjectionGuardEnabled() && bodyCheck.shouldBlock) return null;

    // Description is metadata → neutralize in place if injected.
    const description = sanitizeToolDescription(
      rawDescription || "Custom operator persona",
      `output-style:${id}`,
    ).description;

    return { id, name, description, promptAddendum: addendum };
  } catch {
    return null;
  }
}

/** Discover all operator personas under ~/.gordon/output-styles/*.md. */
function loadUserStyles(): OutputStyle[] {
  const dir = userStylesDir();
  if (!existsSync(dir)) return [];
  const styles: OutputStyle[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (!/\.md$/i.test(entry)) continue;
      const filePath = join(dir, entry);
      try {
        if (!statSync(filePath).isFile()) continue;
      } catch {
        continue;
      }
      const style = loadStyleFromFile(filePath);
      if (style) styles.push(style);
    }
  } catch {
    // Directory unreadable — built-ins still serve.
  }
  return styles;
}

/**
 * Built-ins + operator files, built-ins winning id collisions so a user file
 * can never shadow `default` / `risk-focused`.
 */
function loadAllStyles(): OutputStyle[] {
  const merged = [...BUILTIN_STYLES];
  const seen = new Set(merged.map((s) => s.id));
  for (const style of loadUserStyles()) {
    if (seen.has(style.id)) continue;
    seen.add(style.id);
    merged.push(style);
  }
  return merged;
}

let activeId = "default";

export class OutputStyleManager {
  private styles: OutputStyle[];

  constructor() {
    this.styles = loadAllStyles();
  }

  /** Re-scan the user directory (e.g. after the operator adds a file). */
  reload(): void {
    this.styles = loadAllStyles();
  }

  listStyles(): OutputStyle[] {
    return this.styles;
  }
  getActive(): OutputStyle {
    return this.styles.find((s) => s.id === activeId) ?? this.styles[0]!;
  }
  setActive(styleId: string): void {
    if (this.styles.some((s) => s.id === styleId)) activeId = styleId;
  }
}
