import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseFrontmatter,
  validateSkillFrontmatter,
  loadSkillFromFile,
  discoverSkillsFromDir,
  MAX_SKILL_FILE_SIZE,
} from "./loader.ts";

// =================== parseFrontmatter ===================

describe("parseFrontmatter — basic shapes", () => {
  it("parses simple top-level key:value pairs", () => {
    const r = parseFrontmatter(`---
name: my-skill
description: Does a thing
---
body content`);
    expect(r.frontmatter.name).toBe("my-skill");
    expect(r.frontmatter.description).toBe("Does a thing");
    expect(r.body).toBe("body content");
  });

  it("parses quoted strings", () => {
    const r = parseFrontmatter(`---
name: "quoted-name"
description: 'single quoted'
---
`);
    expect(r.frontmatter.name).toBe("quoted-name");
    expect(r.frontmatter.description).toBe("single quoted");
  });

  it("parses inline arrays", () => {
    const r = parseFrontmatter(`---
name: x
description: y
tags: [trading, defi, swap]
---
`);
    expect(r.frontmatter.tags).toEqual(["trading", "defi", "swap"]);
  });

  it("parses booleans", () => {
    const r = parseFrontmatter(`---
name: x
description: y
user-invocable: false
---
`);
    expect(r.frontmatter["user-invocable"]).toBe(false);
  });

  it("returns empty frontmatter when no --- block", () => {
    const r = parseFrontmatter(`no frontmatter here\njust body`);
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe("no frontmatter here\njust body");
  });
});

describe("parseFrontmatter — nested objects (agentskills.io metadata field)", () => {
  it("parses nested metadata object with author + version", () => {
    const r = parseFrontmatter(`---
name: pdf-skill
description: pdf stuff
metadata:
  author: example-org
  version: "1.0"
---
`);
    expect(r.frontmatter.metadata).toEqual({
      author: "example-org",
      version: "1.0",
    });
  });

  it("nested block terminates at next top-level key", () => {
    const r = parseFrontmatter(`---
name: x
metadata:
  author: bob
  version: "2.0"
description: after metadata
---
`);
    expect(r.frontmatter.metadata).toEqual({ author: "bob", version: "2.0" });
    expect(r.frontmatter.description).toBe("after metadata");
  });

  it("empty value with no nested children becomes empty string", () => {
    const r = parseFrontmatter(`---
name: x
description: y
license:
---
`);
    expect(r.frontmatter.license).toBe("");
  });

  it("nested keys handle quoted values", () => {
    const r = parseFrontmatter(`---
name: x
description: y
metadata:
  author: "Quoted Author"
  date: 2026-05-21
---
`);
    expect(r.frontmatter.metadata).toEqual({
      author: "Quoted Author",
      date: "2026-05-21",
    });
  });
});

// =================== validateSkillFrontmatter ===================

describe("validateSkillFrontmatter — name rules", () => {
  it("accepts valid kebab-case names", () => {
    const issues = validateSkillFrontmatter({ name: "my-skill", description: "x" }, "my-skill");
    expect(issues.length).toBe(0);
  });

  it("rejects uppercase names", () => {
    const issues = validateSkillFrontmatter(
      { name: "PDF-Processing", description: "x" },
      "PDF-Processing",
    );
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.field === "name" && e.message.includes("kebab-case"))).toBe(true);
  });

  it("rejects names starting with hyphen", () => {
    const issues = validateSkillFrontmatter({ name: "-pdf", description: "x" }, "-pdf");
    expect(issues.some((i) => i.severity === "error" && i.field === "name")).toBe(true);
  });

  it("rejects names ending with hyphen", () => {
    const issues = validateSkillFrontmatter({ name: "pdf-", description: "x" }, "pdf-");
    expect(issues.some((i) => i.severity === "error" && i.field === "name")).toBe(true);
  });

  it("rejects consecutive hyphens", () => {
    const issues = validateSkillFrontmatter(
      { name: "pdf--processing", description: "x" },
      "pdf--processing",
    );
    expect(issues.some((i) => i.severity === "error" && i.field === "name")).toBe(true);
  });

  it("rejects name > 64 chars", () => {
    const longName = "x".repeat(65);
    const issues = validateSkillFrontmatter({ name: longName, description: "x" }, longName);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("64"))).toBe(true);
  });

  it("rejects when name does not match parent dir", () => {
    const issues = validateSkillFrontmatter(
      { name: "actual-name", description: "x" },
      "different-dir",
    );
    expect(
      issues.some(
        (i) => i.severity === "error" && i.field === "name" && i.message.includes("does not match"),
      ),
    ).toBe(true);
  });

  it("rejects missing name", () => {
    const issues = validateSkillFrontmatter({ description: "x" }, "some-dir");
    expect(
      issues.some(
        (i) =>
          i.severity === "error" && i.field === "name" && i.message === "required field missing",
      ),
    ).toBe(true);
  });
});

describe("validateSkillFrontmatter — description rules", () => {
  it("rejects missing description", () => {
    const issues = validateSkillFrontmatter({ name: "ok-name" }, "ok-name");
    expect(issues.some((i) => i.severity === "error" && i.field === "description")).toBe(true);
  });

  it("warns on description > 1024 chars (but loads)", () => {
    const long = "x".repeat(1025);
    const issues = validateSkillFrontmatter({ name: "ok-name", description: long }, "ok-name");
    const warn = issues.find((i) => i.field === "description");
    expect(warn?.severity).toBe("warning");
    expect(warn?.message).toContain("1024");
  });
});

describe("validateSkillFrontmatter — compatibility (optional)", () => {
  it("accepts compatibility under 500 chars", () => {
    const issues = validateSkillFrontmatter(
      { name: "x", description: "y", compatibility: "Designed for Gordon" },
      "x",
    );
    expect(issues.filter((i) => i.field === "compatibility")).toEqual([]);
  });

  it("warns on compatibility > 500 chars", () => {
    const issues = validateSkillFrontmatter(
      {
        name: "x",
        description: "y",
        compatibility: "y".repeat(501),
      },
      "x",
    );
    const warn = issues.find((i) => i.field === "compatibility");
    expect(warn?.severity).toBe("warning");
  });
});

describe("validateSkillFrontmatter — happy path", () => {
  it("zero issues for fully compliant skill", () => {
    const issues = validateSkillFrontmatter(
      {
        name: "pdf-processing",
        description: "Extract text from PDFs. Use when handling PDF documents.",
        license: "MIT",
        compatibility: "Requires Python 3.10+",
        metadata: { author: "example", version: "1.0" },
      },
      "pdf-processing",
    );
    expect(issues.length).toBe(0);
  });
});

// =================== loadSkillFromFile ===================

describe("loadSkillFromFile — compliant skill loads", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-skill-test-"));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it("loads a valid skill + populates frontmatter fields", () => {
    const skillDir = join(dir, "my-skill");
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: my-skill
description: Does a thing. Use when user asks for the thing.
license: MIT
metadata:
  author: tester
  version: "1.0"
---
Body content here
`,
    );
    const skill = loadSkillFromFile(join(skillDir, "SKILL.md"), "user");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("my-skill");
    expect(skill!.frontmatter.license).toBe("MIT");
    expect(skill!.frontmatter.metadata).toEqual({
      author: "tester",
      version: "1.0",
    });
    expect(skill!.body.trim()).toBe("Body content here");
    expect(skill!.validationWarnings).toBeUndefined();
  });

  it("skips skill with invalid name (uppercase)", () => {
    const skillDir = join(dir, "BadName");
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: BadName
description: y
---
body`,
    );
    const skill = loadSkillFromFile(join(skillDir, "SKILL.md"), "user");
    expect(skill).toBeNull();
  });

  it("skips skill where name does not match parent dir", () => {
    const skillDir = join(dir, "actual-dir");
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: claimed-name
description: y
---
body`,
    );
    const skill = loadSkillFromFile(join(skillDir, "SKILL.md"), "user");
    expect(skill).toBeNull();
  });

  it("skips skill with missing description", () => {
    const skillDir = join(dir, "ok-name");
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: ok-name
---
body`,
    );
    const skill = loadSkillFromFile(join(skillDir, "SKILL.md"), "user");
    expect(skill).toBeNull();
  });

  it("loads with validationWarnings when description over 1024 chars", () => {
    const skillDir = join(dir, "long-desc");
    mkdirSync(skillDir);
    const longDesc = "x".repeat(1100);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: long-desc
description: ${longDesc}
---
body`,
    );
    const skill = loadSkillFromFile(join(skillDir, "SKILL.md"), "user");
    expect(skill).not.toBeNull();
    expect(skill!.validationWarnings?.length).toBeGreaterThan(0);
    expect(skill!.validationWarnings?.[0]?.field).toBe("description");
  });

  it("returns null for nonexistent file", () => {
    const skill = loadSkillFromFile(join(dir, "no-such.md"), "user");
    expect(skill).toBeNull();
  });
});

// =================== Patch 3 — MAX_SKILL_FILE_SIZE ===================

describe("Patch 3 — MAX_SKILL_FILE_SIZE rejects oversized skills", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-skill-size-test-"));
  });
  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it("constant is exported and reasonable", () => {
    expect(MAX_SKILL_FILE_SIZE).toBeGreaterThan(1024);
    expect(MAX_SKILL_FILE_SIZE).toBeLessThanOrEqual(1024 * 1024);
  });

  it("skill within the size cap loads normally", () => {
    const skillDir = join(dir, "okay-skill");
    mkdirSync(skillDir);
    const body = "x".repeat(1000); // ~1KB
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: okay-skill
description: small body
---
${body}
`,
    );
    const skill = loadSkillFromFile(join(skillDir, "SKILL.md"), "user");
    expect(skill).not.toBeNull();
  });

  it("skill exceeding cap is skipped (returns null)", () => {
    const skillDir = join(dir, "huge-skill");
    mkdirSync(skillDir);
    // Body just over the limit
    const body = "x".repeat(MAX_SKILL_FILE_SIZE + 1024);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: huge-skill
description: oversized body
---
${body}`,
    );
    const skill = loadSkillFromFile(join(skillDir, "SKILL.md"), "user");
    expect(skill).toBeNull();
  });

  it("size boundary — exactly at the cap loads", () => {
    const skillDir = join(dir, "edge-skill");
    mkdirSync(skillDir);
    // Compose a file that lands within the cap. Frontmatter ~80 bytes.
    const padding = MAX_SKILL_FILE_SIZE - 200; // leave room for frontmatter
    const body = "y".repeat(padding);
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: edge-skill
description: at-cap body
---
${body}`,
    );
    const skill = loadSkillFromFile(join(skillDir, "SKILL.md"), "user");
    expect(skill).not.toBeNull();
  });
});

describe("discoverSkillsFromDir — mixed compliance", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gordon-skill-disc-"));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it("loads only compliant skills + silently skips invalid ones", () => {
    // Compliant
    mkdirSync(join(dir, "good-one"));
    writeFileSync(
      join(dir, "good-one", "SKILL.md"),
      `---
name: good-one
description: A compliant skill.
---
body 1`,
    );
    // Invalid name
    mkdirSync(join(dir, "BadName"));
    writeFileSync(
      join(dir, "BadName", "SKILL.md"),
      `---
name: BadName
description: y
---
body 2`,
    );
    // Missing description
    mkdirSync(join(dir, "no-desc"));
    writeFileSync(
      join(dir, "no-desc", "SKILL.md"),
      `---
name: no-desc
---
body 3`,
    );
    // Another compliant
    mkdirSync(join(dir, "good-two"));
    writeFileSync(
      join(dir, "good-two", "SKILL.md"),
      `---
name: good-two
description: Another compliant skill.
---
body 4`,
    );

    const skills = discoverSkillsFromDir(dir, "user");
    const ids = skills.map((s) => s.id).sort();
    expect(ids).toEqual(["good-one", "good-two"]);
  });

  it("returns empty array for nonexistent dir", () => {
    expect(discoverSkillsFromDir("/nonexistent/path/here", "user")).toEqual([]);
  });
});

// =================== Bundled skills regression test ===================

describe("All 33 Gordon bundled skills load + pass validation", () => {
  it("discoverSkillsFromDir loads every bundled skill with zero warnings", () => {
    const builtinDir = "src/infra/skills/builtin";
    const skills = discoverSkillsFromDir(builtinDir, "builtin");
    expect(skills.length).toBeGreaterThanOrEqual(33);
    for (const skill of skills) {
      expect(skill.validationWarnings).toBeUndefined();
    }
  });
});
