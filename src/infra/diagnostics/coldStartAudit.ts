/**
 * Cold-Start Audit (GORDON_COLD_START_AUDIT).
 *
 * Port of the "cold-start test" pattern from hands-on harness engineering
 * Module 03. A fresh agent opens the repo and must answer N canonical
 * questions using ONLY discoverable files. Each unanswered question is
 * a documentation gap.
 *
 * Gordon-specific question set (trading-domain, not coding-agent):
 *   Q1. What does Gordon do?
 *   Q2. How do I start it (setup / runtime)?
 *   Q3. What venues / brokers are connected and how do I add one?
 *   Q4. What is currently in progress (active plans / mandates)?
 *   Q5. What is the next thing the agent should do?
 *
 * The auditor probes each question against a set of "sources" — file
 * paths or content checks — and reports whether the answer is
 * discoverable. Visibility score = (questions with at least one
 * source hit) / total.
 *
 * This module does NOT itself read code paths or call the agent. The
 * caller supplies a list of `SourceCheck` records (each describing a
 * file existence + optional content-match check) and the auditor
 * resolves them against the working tree. Keeping resolution separate
 * makes the auditor testable with a temp directory.
 */

import { existsSync, readFileSync } from "node:fs";

export const COLD_START_FLAG_ENV = "GORDON_COLD_START_AUDIT";

export interface SourceCheck {
  /** Absolute or repo-relative path. */
  path: string;
  /** Optional substring or regex pattern the file must contain. */
  mustContain?: string | RegExp;
  /** Human-friendly note about what this source answers. */
  note?: string;
}

export type QuestionId =
  | "what_does_it_do"
  | "how_to_start"
  | "venues_connected"
  | "in_progress"
  | "next_action"
  | string;

export interface Question {
  id: QuestionId;
  text: string;
  /** Ordered candidate sources; first hit wins. */
  sources: SourceCheck[];
}

export type QuestionVerdict = "answered" | "partial" | "missing";

export interface QuestionResult {
  id: QuestionId;
  text: string;
  verdict: QuestionVerdict;
  /** Source that answered it (if any). */
  hitSource: SourceCheck | null;
  /** All sources that were probed. */
  attempted: Array<{ source: SourceCheck; hit: boolean; reason: string }>;
}

export interface AuditReport {
  capturedAt: string;
  questions: QuestionResult[];
  /** Visibility = answered / total. 0..1. */
  visibility: number;
  /** Questions with verdict !== "answered". */
  gaps: QuestionId[];
}

export const GORDON_DEFAULT_QUESTIONS: readonly Question[] = [
  {
    id: "what_does_it_do",
    text: "What does Gordon do?",
    sources: [
      { path: "CLAUDE.md", mustContain: /Gordon/, note: "Project briefing" },
      { path: "README.md", mustContain: /Gordon/, note: "Top-level readme" },
    ],
  },
  {
    id: "how_to_start",
    text: "How do I start Gordon?",
    sources: [
      { path: "CLAUDE.md", mustContain: /bun/i, note: "Bun runtime referenced" },
      { path: "package.json", mustContain: /"scripts"/, note: "npm scripts" },
      { path: "README.md", mustContain: /start|install|setup/i },
    ],
  },
  {
    id: "venues_connected",
    text: "What venues / brokers are connected?",
    sources: [
      { path: "CLAUDE.md", mustContain: /broker|exchange|venue/i },
      { path: "src/infra/exchange", note: "Exchange adapters directory" },
      { path: "src/infra/broker", note: "Broker adapters directory" },
    ],
  },
  {
    id: "in_progress",
    text: "What plans / mandates are currently in progress?",
    sources: [
      { path: ".gordon/mandates.json", note: "Active strategy mandates" },
      { path: ".gordon/decisions.jsonl", note: "Recent decisions" },
      { path: ".gordon/session-handoff.json", note: "Last session handoff" },
    ],
  },
  {
    id: "next_action",
    text: "What is the next thing the agent should do?",
    sources: [
      { path: ".gordon/session-handoff.json", mustContain: /next|todo|pending/i },
      { path: "PROGRESS.md", mustContain: /Next Action/i },
    ],
  },
] as const;

export function isColdStartAuditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[COLD_START_FLAG_ENV] === "1" || env[COLD_START_FLAG_ENV] === "true";
}

function checkSource(
  source: SourceCheck,
  rootDir: string,
  resolver: (path: string) => string,
): { hit: boolean; reason: string } {
  const resolved = resolver(source.path);
  if (!existsSync(resolved)) {
    return { hit: false, reason: `path not found: ${source.path}` };
  }
  if (source.mustContain === undefined) {
    return { hit: true, reason: `path exists: ${source.path}` };
  }

  // For directories with mustContain, we treat existence alone as a hit
  // (the content check applies to files only).
  let stat;
  try {
    stat = readFileSync(resolved, "utf8");
  } catch {
    return { hit: true, reason: `path exists (not a file): ${source.path}` };
  }

  const pattern = source.mustContain;
  const matched = typeof pattern === "string"
    ? stat.includes(pattern)
    : pattern.test(stat);

  if (matched) {
    return { hit: true, reason: `path exists and matches pattern` };
  }
  return { hit: false, reason: `path exists but pattern not matched` };
}

export interface AuditOptions {
  /** Root dir to resolve relative source paths from. Defaults to cwd. */
  rootDir?: string;
  /** Override clock for tests. */
  now?: string;
  /**
   * Path resolver. Defaults to `path.join(rootDir, sourcePath)` when relative,
   * absolute paths pass through. Override for testing.
   */
  resolver?: (sourcePath: string) => string;
}

/**
 * Run the cold-start audit. Returns a `visibility` score plus per-question
 * verdicts. A `partial` verdict means at least one source existed but
 * required a content pattern that didn't match — useful to surface "the
 * file is there but doesn't actually answer the question."
 */
export function runColdStartAudit(
  questions: readonly Question[],
  opts: AuditOptions = {},
): AuditReport {
  const rootDir = opts.rootDir ?? process.cwd();
  const resolver = opts.resolver ?? ((p: string) => {
    if (p.startsWith("/") || /^[A-Z]:[\\/]/.test(p)) return p;
    return `${rootDir}/${p}`;
  });
  const capturedAt = opts.now ?? new Date().toISOString();

  const results: QuestionResult[] = [];
  for (const q of questions) {
    const attempted: QuestionResult["attempted"] = [];
    let hitSource: SourceCheck | null = null;
    let sawAnyExistingFile = false;

    for (const source of q.sources) {
      const result = checkSource(source, rootDir, resolver);
      attempted.push({ source, ...result });
      if (result.hit) {
        hitSource = source;
        break;
      }
      if (result.reason.includes("pattern not matched")) sawAnyExistingFile = true;
    }

    let verdict: QuestionVerdict;
    if (hitSource) verdict = "answered";
    else if (sawAnyExistingFile) verdict = "partial";
    else verdict = "missing";

    results.push({ id: q.id, text: q.text, verdict, hitSource, attempted });
  }

  const answered = results.filter((r) => r.verdict === "answered").length;
  const visibility = questions.length === 0 ? 1 : answered / questions.length;
  const gaps = results.filter((r) => r.verdict !== "answered").map((r) => r.id);

  return { capturedAt, questions: results, visibility, gaps };
}

export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`Cold-start audit — ${report.capturedAt}`);
  lines.push(`Visibility: ${(report.visibility * 100).toFixed(0)}% (${report.questions.length - report.gaps.length}/${report.questions.length} answered)`);
  for (const r of report.questions) {
    const tag = r.verdict === "answered" ? "OK" : r.verdict === "partial" ? "PARTIAL" : "MISSING";
    lines.push(`  [${tag}] ${r.text}`);
    if (r.hitSource) lines.push(`    → ${r.hitSource.path}${r.hitSource.note ? ` — ${r.hitSource.note}` : ""}`);
    else lines.push(`    → no source answered; tried ${r.attempted.length}`);
  }
  return lines.join("\n");
}

export function auditToPayload(report: AuditReport): Record<string, unknown> {
  return {
    kind: "cold_start.audit_recorded",
    capturedAt: report.capturedAt,
    visibility: report.visibility,
    gaps: report.gaps,
    questions: report.questions.map((q) => ({
      id: q.id,
      verdict: q.verdict,
      hitSourcePath: q.hitSource?.path ?? null,
    })),
  };
}
