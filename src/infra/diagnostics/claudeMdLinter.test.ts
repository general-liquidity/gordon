import { describe, it, expect } from "bun:test";

import {
  isClaudeMdLinterEnabled,
  lintClaudeMd,
  formatLintReport,
  reportToPayload,
  CLAUDE_MD_LINTER_FLAG_ENV,
} from "./claudeMdLinter.ts";

describe("isClaudeMdLinterEnabled", () => {
  it("respects the flag", () => {
    expect(isClaudeMdLinterEnabled({})).toBe(false);
    expect(isClaudeMdLinterEnabled({ [CLAUDE_MD_LINTER_FLAG_ENV]: "1" })).toBe(true);
    expect(isClaudeMdLinterEnabled({ [CLAUDE_MD_LINTER_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("lintClaudeMd — line count thresholds", () => {
  it("passes a small file", () => {
    const content = "# Gordon\n\nShort and sweet.\n";
    const r = lintClaudeMd(content);
    expect(r.passes).toBe(true);
    expect(r.findings.length).toBe(0);
  });

  it("warns on >300 lines", () => {
    const content = "# Gordon\n" + "x\n".repeat(310);
    const r = lintClaudeMd(content);
    expect(r.findings.some((f) => f.ruleId === "line_count_warn")).toBe(true);
  });

  it("errors on >500 lines", () => {
    const content = "# Gordon\n" + "x\n".repeat(510);
    const r = lintClaudeMd(content);
    expect(r.findings.some((f) => f.ruleId === "line_count_excessive")).toBe(true);
    expect(r.passes).toBe(false);
  });

  it("respects custom thresholds", () => {
    const content = "x\n".repeat(50);
    const r = lintClaudeMd(content, { warnLines: 10, errorLines: 100 });
    expect(r.findings.some((f) => f.ruleId === "line_count_warn")).toBe(true);
  });
});

describe("lintClaudeMd — instruction count", () => {
  it("warns when instruction count > 200", () => {
    const bullets = "- do thing\n".repeat(220);
    const r = lintClaudeMd(bullets);
    expect(r.findings.some((f) => f.ruleId === "instruction_count_warn")).toBe(true);
  });

  it("counts both bullets and imperative sentences", () => {
    const content = "- bullet one\nUse npm.\n- bullet two\nRun tests.\n";
    const r = lintClaudeMd(content);
    expect(r.estimatedInstructions).toBeGreaterThanOrEqual(4);
  });

  it("ignores instructions inside code fences", () => {
    const content = "```\n- this is in a fence\nNot an instruction.\n```\n";
    const r = lintClaudeMd(content);
    expect(r.estimatedInstructions).toBe(0);
  });
});

describe("lintClaudeMd — code-style detection", () => {
  it("flags formatting guidance in the prompt", () => {
    const content = "- Use 2-space indentation everywhere.\n- Variables should be camelCase.\n";
    const r = lintClaudeMd(content);
    expect(r.findings.some((f) => f.ruleId === "code_style_in_prompt")).toBe(true);
  });

  it("flags semicolon / quote style", () => {
    const content = "Use semicolons consistently. Prefer single quotes.\n";
    const r = lintClaudeMd(content);
    expect(r.findings.some((f) => f.ruleId === "code_style_in_prompt")).toBe(true);
  });

  it("does NOT flag code-style guidance inside fenced examples", () => {
    const content = "Look at this example:\n```js\n// use 2-space indentation\nconst x = 1;\n```\n";
    const r = lintClaudeMd(content);
    expect(r.findings.some((f) => f.ruleId === "code_style_in_prompt")).toBe(false);
  });
});

describe("lintClaudeMd — exhaustive command list", () => {
  it("flags many bash commands inside a fenced block", () => {
    const commands = Array.from({ length: 20 }, (_, i) => `npm run task-${i}`).join("\n");
    const content = "Here are commands:\n```bash\n" + commands + "\n```\n";
    const r = lintClaudeMd(content);
    expect(r.findings.some((f) => f.ruleId === "exhaustive_command_list")).toBe(true);
  });

  it("does NOT flag a handful of inline backtick commands", () => {
    const content = "Run `npm install` then `npm test`.\n";
    const r = lintClaudeMd(content);
    expect(r.findings.some((f) => f.ruleId === "exhaustive_command_list")).toBe(false);
  });
});

describe("lintClaudeMd — large code snippets", () => {
  it("flags fenced ts blocks > 30 lines", () => {
    const codeBlock = Array.from({ length: 40 }, (_, i) => `const x${i} = ${i};`).join("\n");
    const content = "```ts\n" + codeBlock + "\n```\n";
    const r = lintClaudeMd(content);
    expect(r.findings.some((f) => f.ruleId === "large_code_snippet")).toBe(true);
  });

  it("does NOT flag short code blocks", () => {
    const content = "```ts\nconst x = 1;\nconst y = 2;\n```\n";
    const r = lintClaudeMd(content);
    expect(r.findings.some((f) => f.ruleId === "large_code_snippet")).toBe(false);
  });

  it("does NOT flag plain-text fenced blocks", () => {
    const block = "line\n".repeat(40);
    const content = "```\n" + block + "```\n";
    const r = lintClaudeMd(content);
    expect(r.findings.some((f) => f.ruleId === "large_code_snippet")).toBe(false);
  });
});

describe("lintClaudeMd — combined", () => {
  it("aggregates multiple findings", () => {
    const content =
      "# Big file\n" +
      "x\n".repeat(310) + // line count warn
      "- Use 2-space indentation.\n" + // code style
      "Run all tests.\n";
    const r = lintClaudeMd(content);
    expect(r.findings.length).toBeGreaterThanOrEqual(2);
    expect(r.countsBySeverity.warn).toBeGreaterThanOrEqual(2);
  });

  it("passes on HumanLayer's recommended shape (<60 lines, focused)", () => {
    const content =
      "# Gordon\n\n" +
      "## What\nTrading agent built on Bun + Mastra.\n\n" +
      "## Why\nTools for economic participation in the agentic economy.\n\n" +
      "## How\n- Bun runtime.\n- TypeScript with .ts extensions.\n- Type-check before commit.\n";
    const r = lintClaudeMd(content);
    expect(r.passes).toBe(true);
    expect(r.totalLines).toBeLessThan(60);
  });
});

describe("formatLintReport", () => {
  it("includes PASS/FAIL header + line + instruction counts", () => {
    const content = "x\n".repeat(310);
    const out = formatLintReport(lintClaudeMd(content));
    expect(out).toContain("311 lines");
    expect(out).toContain("line_count_warn");
  });

  it("prints PASS on a clean file", () => {
    const out = formatLintReport(lintClaudeMd("# Short\n\n- One rule.\n"));
    expect(out).toContain("PASS");
  });
});

describe("reportToPayload", () => {
  it("emits stable shape", () => {
    const p = reportToPayload(lintClaudeMd("# Short\n"));
    expect(p.kind).toBe("claude_md_lint.report_recorded");
    expect(p.passes).toBe(true);
  });
});
