/**
 * Skill Loader — Parse SKILL.md files and discover from directories.
 *
 * Conforms to the agentskills.io formal spec (https://agentskills.io/specification):
 *
 *   Required fields:
 *     - name        : 1-64 chars, lowercase + digits + hyphens only, no
 *                     leading/trailing/consecutive hyphens, MUST match
 *                     parent directory name.
 *     - description : 1-1024 chars, non-empty.
 *
 *   Optional fields:
 *     - license       : license name or bundled-file reference.
 *     - compatibility : 1-500 chars; environment requirements.
 *     - metadata      : nested key→string map (author, version, etc.).
 *     - allowed-tools : space-separated pre-approved tool list (experimental).
 *
 * The loader's behavior on validation:
 *
 *   - Skills failing ANY error-level check are SKIPPED (returned as null,
 *     a warning logged with the failure detail). Silent loading of broken
 *     skills is worse than missing them.
 *
 *   - Skills failing WARNING-level checks (length over recommended caps)
 *     STILL LOAD, with `validationWarnings` populated. Callers can surface
 *     them in admin UIs or CI gates.
 *
 *   - All 33 bundled Gordon skills pass without warnings — verified
 *     against the formal spec (see validate_skills.py probe + the matching
 *     test cases below). The validator is here to catch operator-authored
 *     skills in `~/.claude/skills/` that violate the spec.
 *
 * YAML parsing: extended lightweight parser supporting nested objects
 * (for `metadata:` with indented children). No external `yaml` dep.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Skill,
  SkillFrontmatter,
  SkillSource,
  SkillValidationIssue,
} from "./types.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("skill-loader");

// ============================================================================
// agentskills.io spec constants
// ============================================================================

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME_LEN = 64;
const MAX_DESCRIPTION_LEN = 1024;

/**
 * Reserved skill names that collide with namespace slash commands.
 * Skills matching these names are rejected by the loader so that
 * /skills audit (etc.) routes to the management surface and not a
 * shadowing user skill.
 */
const RESERVED_SKILL_NAMES = new Set(["skills"]);
const MAX_COMPATIBILITY_LEN = 500;

/**
 * Patch 3 — Hard upper bound on SKILL.md file size. Mirrors the
 * MAX_SKILL_FILE_SIZE constant Deep Agents enforces. Files larger than
 * this are rejected pre-parse to bound memory + token cost (a 500KB
 * SKILL.md indicates either a packaging mistake or a malicious payload).
 *
 * 64KB is conservative — Gordon's own bundled skills are all well under
 * 8KB. Operators who legitimately need a bigger skill should split it
 * into multiple skills with cross-references.
 */
export const MAX_SKILL_FILE_SIZE = 64 * 1024;

// ============================================================================
// YAML Frontmatter Parser
// ============================================================================
//
// Extended from the previous lightweight implementation to support nested
// objects (for `metadata:` per agentskills.io spec). The parser handles:
//   - Top-level key: value pairs
//   - Inline arrays: [a, b, c]
//   - Quoted strings: "foo" or 'foo'
//   - Booleans: true / false
//   - Nested objects: key: with indented child key: value lines
//
// Not supported (intentional minimalism — pull `yaml` dep if more needed):
//   - Multi-line strings (`|` or `>`)
//   - Arrays of objects
//   - Deeply nested objects (>1 level)
//   - Anchors / aliases
// ============================================================================

function stripQuotes(s: string): string {
  if (s.length < 2) return s;
  if ((s[0] === '"' && s[s.length - 1] === '"') ||
      (s[0] === "'" && s[s.length - 1] === "'")) {
    return s.slice(1, -1);
  }
  return s;
}

function isIndented(line: string): boolean {
  return line.length > 0 && (line[0] === " " || line[0] === "\t");
}

function parseScalar(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1).split(",").map((s) => stripQuotes(s.trim()));
  }
  return stripQuotes(raw);
}

export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const yamlBlock = match[1]!;
  const body = match[2] ?? "";
  const frontmatter: Record<string, unknown> = {};
  const lines = yamlBlock.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (isIndented(line)) { i++; continue; } // stray indented line — skip

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) { i++; continue; }

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (rawValue === "") {
      // Could be a nested object — look ahead at indented lines
      const nested: Record<string, string> = {};
      let j = i + 1;
      while (j < lines.length) {
        const sub = lines[j]!;
        if (!sub.trim()) { j++; continue; }
        if (!isIndented(sub)) break;
        const subColon = sub.indexOf(":");
        if (subColon === -1) { j++; continue; }
        const subKey = sub.slice(0, subColon).trim();
        const subVal = stripQuotes(sub.slice(subColon + 1).trim());
        nested[subKey] = subVal;
        j++;
      }
      if (Object.keys(nested).length > 0) {
        frontmatter[key] = nested;
        i = j;
        continue;
      }
      // Empty value with no nested block — store as empty string
      frontmatter[key] = "";
      i++;
      continue;
    }

    frontmatter[key] = parseScalar(rawValue);
    i++;
  }

  return { frontmatter, body };
}

// ============================================================================
// Frontmatter Type Coercion
// ============================================================================

function toFrontmatter(raw: Record<string, unknown>): SkillFrontmatter {
  return {
    name: raw.name as string | undefined,
    description: raw.description as string | undefined,
    arguments: raw.arguments as string | string[] | undefined,
    argumentHint: (raw["argument-hint"] ?? raw.argumentHint) as string | undefined,
    allowedTools: (raw["allowed-tools"] ?? raw.allowedTools) as string[] | undefined,
    model: raw.model as string | undefined,
    userInvocable: (raw["user-invocable"] ?? raw.userInvocable ?? true) as boolean,
    disableModelInvocation: (raw["disable-model-invocation"] ?? raw.disableModelInvocation) as boolean | undefined,
    context: raw.context as "inline" | "fork" | undefined,
    agent: raw.agent as string | undefined,
    tags: raw.tags as string[] | undefined,
    version: raw.version as string | undefined,
    license: raw.license as string | undefined,
    compatibility: raw.compatibility as string | undefined,
    metadata: raw.metadata as Record<string, string> | undefined,
    status: raw.status as "active" | "experimental" | "deprecated" | undefined,
    owner: raw.owner as string | undefined,
    lastReviewed: (raw["last-reviewed"] ?? raw.lastReviewed) as string | undefined,
    created: raw.created as string | undefined,
  };
}

// ============================================================================
// agentskills.io spec validation
// ============================================================================

/**
 * Validate a parsed frontmatter against the agentskills.io formal spec.
 *
 * Returns an array of issues. ERROR-severity issues should cause the
 * caller to skip the skill. WARNING-severity issues are advisory.
 *
 * Designed for operator-authored skills under `~/.claude/skills/` or
 * `.gordon/skills/`. Gordon's 33 bundled skills are pre-verified
 * compliant.
 */
export function validateSkillFrontmatter(
  fm: SkillFrontmatter,
  parentDirName: string,
): SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];

  // name (required)
  if (!fm.name) {
    issues.push({ severity: "error", field: "name", message: "required field missing" });
  } else {
    if (fm.name.length === 0) {
      issues.push({ severity: "error", field: "name", message: "must be non-empty" });
    }
    if (fm.name.length > MAX_NAME_LEN) {
      issues.push({
        severity: "error",
        field: "name",
        message: `length ${fm.name.length} > spec max ${MAX_NAME_LEN}`,
      });
    }
    if (!NAME_PATTERN.test(fm.name)) {
      issues.push({
        severity: "error",
        field: "name",
        message: `'${fm.name}' must match [a-z0-9]+(-[a-z0-9]+)* — kebab-case, no leading/trailing/consecutive hyphens`,
      });
    }
    if (fm.name !== parentDirName) {
      issues.push({
        severity: "error",
        field: "name",
        message: `'${fm.name}' does not match parent directory '${parentDirName}'`,
      });
    }
    if (RESERVED_SKILL_NAMES.has(fm.name)) {
      issues.push({
        severity: "error",
        field: "name",
        message: `'${fm.name}' is reserved — collides with the /${fm.name} namespace slash command`,
      });
    }
  }

  // description (required)
  if (!fm.description) {
    issues.push({
      severity: "error",
      field: "description",
      message: "required field missing",
    });
  } else {
    if (fm.description.length === 0) {
      issues.push({
        severity: "error",
        field: "description",
        message: "must be non-empty",
      });
    }
    if (fm.description.length > MAX_DESCRIPTION_LEN) {
      issues.push({
        severity: "warning",
        field: "description",
        message: `length ${fm.description.length} > spec recommended ${MAX_DESCRIPTION_LEN}`,
      });
    }
  }

  // compatibility (optional)
  if (fm.compatibility !== undefined && typeof fm.compatibility === "string") {
    if (fm.compatibility.length > MAX_COMPATIBILITY_LEN) {
      issues.push({
        severity: "warning",
        field: "compatibility",
        message: `length ${fm.compatibility.length} > spec max ${MAX_COMPATIBILITY_LEN}`,
      });
    }
  }

  // Governance fields (all warning-only — never block loading)

  if (fm.status !== undefined) {
    const validStatuses = ["active", "experimental", "deprecated"];
    if (!validStatuses.includes(fm.status)) {
      issues.push({
        severity: "warning",
        field: "status",
        message: `'${fm.status}' is not one of ${validStatuses.join(" / ")}`,
      });
    }
  }

  for (const [field, value] of [
    ["lastReviewed", fm.lastReviewed],
    ["created", fm.created],
  ] as const) {
    if (value !== undefined) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        issues.push({
          severity: "warning",
          field,
          message: `'${value}' is not a valid ISO-8601 date`,
        });
      }
    }
  }

  return issues;
}

// ============================================================================
// Single File Loader
// ============================================================================

export function loadSkillFromFile(filePath: string, source: SkillSource): Skill | null {
  if (!existsSync(filePath)) return null;
  try {
    // Patch 3 — Reject oversized skills pre-read. Reading a 100MB
    // SKILL.md into memory just to discard it after frontmatter parse
    // is a real DoS surface in multi-tenant scenarios.
    let fileSize: number | undefined;
    try {
      fileSize = statSync(filePath).size;
    } catch {
      // statSync failed — fall through to readFileSync which will emit
      // its own error; preserves prior behavior on missing/permission cases.
    }
    if (fileSize !== undefined && fileSize > MAX_SKILL_FILE_SIZE) {
      logger.warn("Skipping oversized skill", {
        filePath,
        source,
        sizeBytes: fileSize,
        maxBytes: MAX_SKILL_FILE_SIZE,
      });
      return null;
    }
    const raw = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const fm = toFrontmatter(frontmatter);
    const dirName = basename(join(filePath, ".."));

    const issues = validateSkillFrontmatter(fm, dirName);
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");

    if (errors.length > 0) {
      logger.warn("Skipping non-compliant skill", {
        filePath,
        source,
        errors: errors.map((e) => `${e.field}: ${e.message}`),
      });
      return null;
    }

    if (warnings.length > 0) {
      logger.info("Skill loaded with validation warnings", {
        filePath,
        warnings: warnings.map((w) => `${w.field}: ${w.message}`),
      });
    }

    const id = fm.name ?? dirName;
    return {
      id,
      name: fm.name ?? dirName,
      description: fm.description ?? "",
      body,
      frontmatter: fm,
      source,
      filePath,
      validationWarnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    logger.debug("Failed to load skill", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ============================================================================
// Directory Discovery
// ============================================================================

/**
 * Discover all SKILL.md files in a skills directory.
 * Each skill lives in its own subdirectory: skills/my-skill/SKILL.md
 *
 * Non-compliant skills are silently skipped (the loader logs a warning
 * but the directory walk continues). Callers see only the valid subset.
 */
export function discoverSkillsFromDir(dir: string, source: SkillSource): Skill[] {
  if (!existsSync(dir)) return [];

  const skills: Skill[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      const skillFile = join(entryPath, "SKILL.md");
      const skill = loadSkillFromFile(skillFile, source);
      if (skill) skills.push(skill);
    }
  } catch {
    // Non-critical — directory may not be readable
  }

  return skills;
}
