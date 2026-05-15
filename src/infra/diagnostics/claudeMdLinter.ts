/**
 * CLAUDE.md Linter (GORDON_CLAUDE_MD_LINTER).
 *
 * Port of HumanLayer's "Writing a Good CLAUDE.md" rules (2026):
 *
 *   - "< 300 lines is best, and shorter is even better"
 *   - "Frontier thinking LLMs can follow ~150-200 instructions with
 *     reasonable consistency"
 *   - "Never send an LLM to do a linter's job" — code style belongs in
 *     a linter, not the prompt
 *   - "Don't try to stuff every command Claude could possibly need to
 *     run"
 *   - "Prefer pointers to copies. Don't include code snippets...instead,
 *     include `file:line` references"
 *
 * This primitive is the markdown counterpart to `toolDesignLinter.ts` —
 * static analysis on agent-instruction files (CLAUDE.md, AGENTS.md, and
 * any `agent_docs/*.md` companions).
 */

export const CLAUDE_MD_LINTER_FLAG_ENV = "GORDON_CLAUDE_MD_LINTER";

export type Severity = "info" | "warn" | "error";

export interface LintFinding {
  ruleId: string;
  severity: Severity;
  line?: number;
  message: string;
  fixInstruction: string;
}

export interface LintReport {
  path: string;
  totalLines: number;
  estimatedInstructions: number;
  findings: LintFinding[];
  countsBySeverity: Record<Severity, number>;
  passes: boolean;
}

export interface LintOptions {
  /** Path for diagnostics (does not need to exist). */
  path?: string;
  /** Line-count warn threshold. Default 300. */
  warnLines?: number;
  /** Line-count error threshold. Default 500. */
  errorLines?: number;
  /** Instruction-count warn threshold. Default 200. */
  warnInstructions?: number;
}

export function isClaudeMdLinterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[CLAUDE_MD_LINTER_FLAG_ENV] === "1" ||
    env[CLAUDE_MD_LINTER_FLAG_ENV] === "true"
  );
}

// ============================================================================
// Heuristics
// ============================================================================

/**
 * Count "instructions" — heuristic. An instruction is a line that:
 *   - starts with a bullet (`-` or `*`)
 *   - OR is an imperative sentence (starts with a capitalized verb-ish word
 *     and ends with a period)
 *   - AND is not inside a code fence
 *
 * Approximate, but the count Anthropic / HumanLayer reference is fuzzy
 * to begin with ("~150-200 instructions").
 */
function countInstructions(lines: readonly string[]): number {
  let count = 0;
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      count += 1;
      continue;
    }
    // Imperative sentence: starts with capital, ends with period.
    if (/^[A-Z][a-z]/.test(trimmed) && /\.\s*$/.test(trimmed)) {
      count += 1;
    }
  }
  return count;
}

interface FencedBlock {
  startLine: number;
  endLine: number;
  langTag: string;
  lineCount: number;
}

function findFencedBlocks(lines: readonly string[]): FencedBlock[] {
  const out: FencedBlock[] = [];
  let inFence = false;
  let start = -1;
  let langTag = "";
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("```")) {
      if (!inFence) {
        inFence = true;
        start = i;
        langTag = trimmed.slice(3).trim();
      } else {
        out.push({ startLine: start + 1, endLine: i + 1, langTag, lineCount: i - start - 1 });
        inFence = false;
      }
    }
  }
  return out;
}

const CODE_STYLE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:indent|indentation|tab(?:s)? vs space|formatting|format with|line length|wrap at \d+)\b/i,
  /\bvariable\s+nam(?:e|ing)\b/i,
  /\b(?:semicolons?|trailing commas?|single quotes?|double quotes?|spaces around)\b/i,
  /\bnaming convention\b/i,
];

function detectCodeStyleGuidance(lines: readonly string[]): number[] {
  const hits: number[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (CODE_STYLE_PATTERNS.some((re) => re.test(trimmed))) hits.push(i + 1);
  }
  return hits;
}

function detectCommandList(lines: readonly string[]): number {
  // Heuristic: lines that look like shell commands inside backticks or fenced bash blocks.
  // We only care about EXHAUSTIVE lists (many in a row). Count commands; trigger when > 15.
  let count = 0;
  let inFence = false;
  let fenceLang = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      fenceLang = inFence ? trimmed.slice(3).trim() : "";
      continue;
    }
    if (inFence && (fenceLang === "bash" || fenceLang === "sh" || fenceLang === "shell")) {
      if (trimmed.length > 0 && !trimmed.startsWith("#")) count += 1;
      continue;
    }
    // Inline backtick command-ish: any line where the first backtick-quoted
    // token starts with a known runner prefix. Approximate — the fenced-block
    // check above is the dominant signal.
    const inline = trimmed.match(/`(npm|bun|yarn|pnpm|node|bash|sh|\.\/)/);
    if (inline) count += 1;
  }
  return count;
}

// ============================================================================
// Linter
// ============================================================================

export function lintClaudeMd(content: string, opts: LintOptions = {}): LintReport {
  const path = opts.path ?? "CLAUDE.md";
  const warnLines = opts.warnLines ?? 300;
  const errorLines = opts.errorLines ?? 500;
  const warnInstructions = opts.warnInstructions ?? 200;

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const estimatedInstructions = countInstructions(lines);
  const findings: LintFinding[] = [];

  if (totalLines > errorLines) {
    findings.push({
      ruleId: "line_count_excessive",
      severity: "error",
      message: `${totalLines} lines exceeds error threshold ${errorLines}`,
      fixInstruction: `Move task-specific content into agent_docs/*.md and reference by path. HumanLayer: 'CLAUDE.md is the highest leverage point of the harness' — keep it short.`,
    });
  } else if (totalLines > warnLines) {
    findings.push({
      ruleId: "line_count_warn",
      severity: "warn",
      message: `${totalLines} lines exceeds warn threshold ${warnLines}`,
      fixInstruction: `Split into agent_docs/*.md. HumanLayer target: <300 lines (their own is <60).`,
    });
  }

  if (estimatedInstructions > warnInstructions) {
    findings.push({
      ruleId: "instruction_count_warn",
      severity: "warn",
      message: `~${estimatedInstructions} instructions exceeds warn threshold ${warnInstructions}`,
      fixInstruction: `LLMs follow ~150-200 instructions consistently. Drop low-leverage ones; promote others into linters/hooks.`,
    });
  }

  const styleHits = detectCodeStyleGuidance(lines);
  if (styleHits.length > 0) {
    findings.push({
      ruleId: "code_style_in_prompt",
      severity: "warn",
      line: styleHits[0],
      message: `code-style guidance detected at line(s) ${styleHits.slice(0, 3).join(", ")}${styleHits.length > 3 ? ", ..." : ""}`,
      fixInstruction: `'Never send an LLM to do a linter's job.' Move formatting/naming rules into a linter or pre-commit hook.`,
    });
  }

  const cmdCount = detectCommandList(lines);
  if (cmdCount > 15) {
    findings.push({
      ruleId: "exhaustive_command_list",
      severity: "info",
      message: `detected ~${cmdCount} command references; likely too many for prompt context`,
      fixInstruction: `Move command references into a runbook (docs/runbook.md) and link by path. Keep CLAUDE.md focused on conventions, not commands.`,
    });
  }

  const blocks = findFencedBlocks(lines);
  for (const block of blocks) {
    if (block.lineCount > 30 && block.langTag !== "" && block.langTag !== "txt") {
      findings.push({
        ruleId: "large_code_snippet",
        severity: "info",
        line: block.startLine,
        message: `fenced ${block.langTag} block at line ${block.startLine} is ${block.lineCount} lines`,
        fixInstruction: `'Prefer pointers to copies.' Replace inline code with a 'see <path>:<line>' reference.`,
      });
    }
  }

  const counts: Record<Severity, number> = { info: 0, warn: 0, error: 0 };
  for (const f of findings) counts[f.severity] += 1;

  return {
    path,
    totalLines,
    estimatedInstructions,
    findings,
    countsBySeverity: counts,
    passes: counts.error === 0,
  };
}

export function formatLintReport(report: LintReport): string {
  const lines: string[] = [];
  lines.push(
    `${report.path} — ${report.passes ? "PASS" : "FAIL"} (${report.totalLines} lines, ~${report.estimatedInstructions} instructions, ${report.countsBySeverity.error} error, ${report.countsBySeverity.warn} warn, ${report.countsBySeverity.info} info)`,
  );
  for (const f of report.findings) {
    const where = f.line !== undefined ? ` L${f.line}` : "";
    lines.push(`  [${f.severity.toUpperCase()}]${where} ${f.ruleId}: ${f.message}`);
    lines.push(`    fix: ${f.fixInstruction}`);
  }
  return lines.join("\n");
}

export function reportToPayload(report: LintReport): Record<string, unknown> {
  return {
    kind: "claude_md_lint.report_recorded",
    path: report.path,
    passes: report.passes,
    totalLines: report.totalLines,
    estimatedInstructions: report.estimatedInstructions,
    counts: report.countsBySeverity,
  };
}
