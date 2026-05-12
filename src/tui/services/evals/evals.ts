// Evals Framework
//
// Score agent outputs for quality, consistency, and correctness.
// Run test cases against agents, track regressions over time.
//
// Scorers:
// - Faithfulness: does reasoning cite data the agent actually saw?
// - Relevancy: did the agent answer the question asked?
// - Consistency: does output match risk kernel / indicator values?
// - Schema Compliance: does output parse as TradingSignal?
// - Confidence Calibration: is stated confidence justified?

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const EVALS_DIR = join(homedir(), ".gordon", "evals");

export interface EvalCase {
  id: string;
  name: string;
  input: string;
  context?: Record<string, any>;
  expectedOutput?: any;
  assertions: EvalAssertion[];
}

export interface EvalAssertion {
  name: string;
  check: (output: any, context?: Record<string, any>) => { passed: boolean; score: number; reason?: string };
}

export interface EvalResult {
  caseId: string;
  caseName: string;
  passed: boolean;
  score: number; // 0-1 aggregate
  assertions: Array<{ name: string; passed: boolean; score: number; reason?: string }>;
  output: any;
  durationMs: number;
  timestamp: number;
}

export interface EvalRun {
  id: string;
  name: string;
  timestamp: number;
  modelId?: string;
  results: EvalResult[];
  totalPassed: number;
  totalFailed: number;
  avgScore: number;
  durationMs: number;
}

// Built-in scorers

export const scorers = {
  // Does output parse as valid JSON matching expected schema?
  schemaCompliance: (schema: { parse: (data: any) => any }): EvalAssertion => ({
    name: "schema_compliance",
    check: (output) => {
      try {
        schema.parse(output);
        return { passed: true, score: 1 };
      } catch (err) {
        return { passed: false, score: 0, reason: err instanceof Error ? err.message : "Parse failed" };
      }
    },
  }),

  // Does output mention expected keywords/entities?
  keywordPresence: (keywords: string[]): EvalAssertion => ({
    name: "keyword_presence",
    check: (output) => {
      const text = typeof output === "string" ? output : JSON.stringify(output);
      const found = keywords.filter((k) => text.toLowerCase().includes(k.toLowerCase()));
      const score = keywords.length > 0 ? found.length / keywords.length : 0;
      return {
        passed: score >= 0.5,
        score,
        reason: `Found ${found.length}/${keywords.length} keywords`,
      };
    },
  }),

  // Does reasoning cite actual data values (faithfulness)?
  faithfulness: (providedData: Record<string, number>): EvalAssertion => ({
    name: "faithfulness",
    check: (output) => {
      const text = typeof output === "string" ? output : JSON.stringify(output);
      let cited = 0;
      let total = 0;
      for (const [key, value] of Object.entries(providedData)) {
        total++;
        const valueStr = typeof value === "number" ? value.toFixed(2) : String(value);
        if (text.includes(valueStr) || text.toLowerCase().includes(key.toLowerCase())) cited++;
      }
      const score = total > 0 ? cited / total : 0;
      return {
        passed: score >= 0.5,
        score,
        reason: `Cited ${cited}/${total} data points`,
      };
    },
  }),

  // Is confidence within expected range?
  confidenceRange: (min: number, max: number): EvalAssertion => ({
    name: "confidence_range",
    check: (output) => {
      const conf = (output as any)?.confidence;
      if (typeof conf !== "number") {
        return { passed: false, score: 0, reason: "No confidence field" };
      }
      const passed = conf >= min && conf <= max;
      return {
        passed,
        score: passed ? 1 : 0,
        reason: `Confidence ${conf} ${passed ? "within" : "outside"} [${min}, ${max}]`,
      };
    },
  }),

  // Does output have a specific signal?
  signalMatch: (expected: "BULLISH" | "BEARISH" | "NEUTRAL"): EvalAssertion => ({
    name: "signal_match",
    check: (output) => {
      const signal = (output as any)?.signal;
      const passed = signal === expected;
      return {
        passed,
        score: passed ? 1 : 0,
        reason: `Signal "${signal}" ${passed ? "matches" : "does not match"} expected "${expected}"`,
      };
    },
  }),

  // Length check
  responseLengthRange: (minChars: number, maxChars: number): EvalAssertion => ({
    name: "length_range",
    check: (output) => {
      const text = typeof output === "string" ? output : JSON.stringify(output);
      const len = text.length;
      const passed = len >= minChars && len <= maxChars;
      return {
        passed,
        score: passed ? 1 : 0,
        reason: `Length ${len} ${passed ? "within" : "outside"} [${minChars}, ${maxChars}]`,
      };
    },
  }),

  // Custom scorer
  custom: (name: string, fn: (output: any, context?: Record<string, any>) => { passed: boolean; score: number; reason?: string }): EvalAssertion => ({
    name,
    check: fn,
  }),
};

export class EvalRunner {
  async runCase(testCase: EvalCase, executeAgent: (input: string, context?: Record<string, any>) => Promise<any>): Promise<EvalResult> {
    const startTime = Date.now();
    let output: any;
    let error: string | undefined;

    try {
      output = await executeAgent(testCase.input, testCase.context);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      output = null;
    }

    const assertionResults = testCase.assertions.map((a) => {
      try {
        const result = a.check(output, testCase.context);
        return { name: a.name, ...result };
      } catch (err) {
        return {
          name: a.name,
          passed: false,
          score: 0,
          reason: err instanceof Error ? err.message : "Check failed",
        };
      }
    });

    const totalScore = assertionResults.reduce((s, r) => s + r.score, 0);
    const avgScore = assertionResults.length > 0 ? totalScore / assertionResults.length : 0;
    const passed = assertionResults.every((r) => r.passed) && !error;

    return {
      caseId: testCase.id,
      caseName: testCase.name,
      passed,
      score: avgScore,
      assertions: assertionResults,
      output,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  async runSuite(
    name: string,
    cases: EvalCase[],
    executeAgent: (input: string, context?: Record<string, any>) => Promise<any>,
    modelId?: string,
  ): Promise<EvalRun> {
    const startTime = Date.now();
    const results: EvalResult[] = [];

    for (const c of cases) {
      const result = await this.runCase(c, executeAgent);
      results.push(result);
    }

    const totalPassed = results.filter((r) => r.passed).length;
    const totalFailed = results.length - totalPassed;
    const avgScore = results.length > 0
      ? results.reduce((s, r) => s + r.score, 0) / results.length
      : 0;

    const run: EvalRun = {
      id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      timestamp: Date.now(),
      modelId,
      results,
      totalPassed,
      totalFailed,
      avgScore,
      durationMs: Date.now() - startTime,
    };

    this.saveRun(run);
    return run;
  }

  private saveRun(run: EvalRun): void {
    try {
      mkdirSync(EVALS_DIR, { recursive: true });
      writeFileSync(join(EVALS_DIR, `${run.id}.json`), JSON.stringify(run, null, 2));
    } catch {}
  }

  listRuns(): EvalRun[] {
    try {
      const { readdirSync } = require("fs");
      if (!existsSync(EVALS_DIR)) return [];
      const files = readdirSync(EVALS_DIR).filter((f: string) => f.endsWith(".json"));
      const runs: EvalRun[] = [];
      for (const file of files) {
        try {
          runs.push(JSON.parse(readFileSync(join(EVALS_DIR, file), "utf-8")));
        } catch {}
      }
      return runs.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  // Compare two runs to detect regressions
  compareRuns(runA: EvalRun, runB: EvalRun): {
    improved: string[];
    degraded: string[];
    unchanged: string[];
    scoreDelta: number;
  } {
    const byIdA = new Map(runA.results.map((r) => [r.caseId, r]));
    const byIdB = new Map(runB.results.map((r) => [r.caseId, r]));

    const improved: string[] = [];
    const degraded: string[] = [];
    const unchanged: string[] = [];

    for (const [id, resultA] of byIdA) {
      const resultB = byIdB.get(id);
      if (!resultB) continue;
      const delta = resultB.score - resultA.score;
      if (delta > 0.05) improved.push(resultA.caseName);
      else if (delta < -0.05) degraded.push(resultA.caseName);
      else unchanged.push(resultA.caseName);
    }

    return {
      improved,
      degraded,
      unchanged,
      scoreDelta: runB.avgScore - runA.avgScore,
    };
  }
}

let instance: EvalRunner | null = null;
export function getEvalRunner(): EvalRunner {
  if (!instance) instance = new EvalRunner();
  return instance;
}
