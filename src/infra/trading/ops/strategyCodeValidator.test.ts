import { describe, it, expect } from "bun:test";

import {
  validateStrategyCode,
  formatValidatorResult,
  validatorResultToPayload,
  DEFAULT_RULES,
  type ValidatorRule,
} from "./strategyCodeValidator.ts";

describe("DEFAULT_RULES", () => {
  it("covers all six leakage families", () => {
    const families = new Set(DEFAULT_RULES.map((r) => r.family));
    expect(families.has("centered_window")).toBe(true);
    expect(families.has("missing_shift")).toBe(true);
    expect(families.has("full_sample_normalization")).toBe(true);
    expect(families.has("survivorship_bias")).toBe(true);
    expect(families.has("restated_fundamentals")).toBe(true);
    expect(families.has("future_reference")).toBe(true);
  });
});

describe("validateStrategyCode — clean code passes", () => {
  it("passes on a benign strategy", () => {
    const code = `
      function makeSignal(bars) {
        const window = bars.slice(i - 20, i);
        return mean(window) > current ? 1 : -1;
      }
    `;
    const r = validateStrategyCode(code);
    expect(r.passes).toBe(true);
    expect(r.violations.length).toBe(0);
  });
});

describe("validateStrategyCode — centered windows", () => {
  it("blocks pandas rolling with center=True", () => {
    const r = validateStrategyCode("df['ma'] = df['close'].rolling(20, center=True).mean()");
    expect(r.passes).toBe(false);
    expect(r.violations[0]!.rule.family).toBe("centered_window");
  });

  it("blocks align: 'center' style", () => {
    const r = validateStrategyCode("const ma = movingAverage(data, { align: 'center' });");
    expect(r.passes).toBe(false);
    expect(r.violations.some((v) => v.rule.family === "centered_window")).toBe(true);
  });
});

describe("validateStrategyCode — missing shift", () => {
  it("warns on 'signal * returns' without shift", () => {
    const r = validateStrategyCode("pnl = signal * returns");
    const hits = r.violations.filter((v) => v.rule.family === "missing_shift");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.rule.severity).toBe("warn");
  });

  it("warns on signal[i] * returns[i] pattern", () => {
    const r = validateStrategyCode(
      "for (let i = 1; i < n; i++) { pnl += signal[i] * returns[i]; }",
    );
    expect(r.violations.some((v) => v.rule.id === "pnl_without_shift_ts")).toBe(true);
  });
});

describe("validateStrategyCode — full-sample normalization", () => {
  it("blocks scaler.fit_transform(X)", () => {
    const r = validateStrategyCode("X_scaled = scaler.fit_transform(X)");
    expect(r.passes).toBe(false);
    expect(r.violations[0]!.rule.family).toBe("full_sample_normalization");
  });

  it("warns on (X - X.mean()) / X.std() style z-score", () => {
    const r = validateStrategyCode("z = (X - X.mean()) / X.std()");
    expect(r.violations.some((v) => v.rule.id === "zscore_full_sample")).toBe(true);
  });
});

describe("validateStrategyCode — survivorship", () => {
  it("warns on current-index-as-universe naming", () => {
    const r = validateStrategyCode("for ticker in sp500_current_members:");
    expect(r.violations.some((v) => v.rule.family === "survivorship_bias")).toBe(true);
  });
});

describe("validateStrategyCode — restated fundamentals", () => {
  it("warns on latest_earnings access", () => {
    const r = validateStrategyCode("eps = company.latest_earnings");
    expect(r.violations.some((v) => v.rule.family === "restated_fundamentals")).toBe(true);
  });
});

describe("validateStrategyCode — future references", () => {
  it("blocks future_price variable name", () => {
    const r = validateStrategyCode("const future_price = bars[i + 1].close;");
    expect(r.passes).toBe(false);
    expect(r.violations.some((v) => v.rule.id === "future_named_variable")).toBe(true);
  });

  it("blocks negative shift", () => {
    const r = validateStrategyCode("lead = df.close.shift(-1)");
    expect(r.passes).toBe(false);
    expect(r.violations.some((v) => v.rule.id === "negative_shift_or_lead")).toBe(true);
  });

  it("blocks .lead() call", () => {
    const r = validateStrategyCode("future = df.lead(1)");
    expect(r.passes).toBe(false);
  });

  it("warns on positive-offset slicing", () => {
    const r = validateStrategyCode("window = bars.slice(i, i + 5)");
    expect(r.violations.some((v) => v.rule.id === "positive_offset_slice")).toBe(true);
  });
});

describe("validateStrategyCode — comments", () => {
  it("ignores Python comments", () => {
    const r = validateStrategyCode("# X_scaled = scaler.fit_transform(X)\n");
    expect(r.passes).toBe(true);
  });

  it("ignores JS line comments", () => {
    const r = validateStrategyCode("// const future_price = bars[i + 1].close;\n");
    expect(r.passes).toBe(true);
  });
});

describe("validateStrategyCode — multiple violations", () => {
  it("collects all violations across multiple lines", () => {
    const code = [
      "ma = df.close.rolling(20, center=True).mean()",
      "X_scaled = scaler.fit_transform(X)",
      "future_price = bars[i + 1].close",
    ].join("\n");
    const r = validateStrategyCode(code);
    expect(r.violations.length).toBeGreaterThanOrEqual(3);
    expect(r.countsBySeverity.block).toBeGreaterThanOrEqual(3);
    expect(r.passes).toBe(false);
  });

  it("aggregates block fix instructions with line tags", () => {
    const r = validateStrategyCode(
      "ma = df.close.rolling(20, center=True).mean()\nfuture_price = bars[i + 1].close",
    );
    expect(r.blockingFixInstruction).toContain("[L1]");
    expect(r.blockingFixInstruction).toContain("[L2]");
  });
});

describe("validateStrategyCode — options", () => {
  it("supports custom rules", () => {
    const customRule: ValidatorRule = {
      id: "gordon_hardcoded_creds",
      family: "other",
      severity: "block",
      pattern: /API_KEY\s*=\s*['"][^'"]+['"]/,
      description: "Hardcoded API key.",
      fixInstruction: "Use env var.",
    };
    const r = validateStrategyCode('API_KEY = "sk-real-secret"', { rules: [customRule] });
    expect(r.passes).toBe(false);
    expect(r.violations[0]!.rule.id).toBe("gordon_hardcoded_creds");
  });

  it("suppresses specific rule ids", () => {
    const r = validateStrategyCode("X_scaled = scaler.fit_transform(X)", {
      suppressRuleIds: ["fit_transform_full"],
    });
    expect(r.violations.some((v) => v.rule.id === "fit_transform_full")).toBe(false);
  });
});

describe("formatValidatorResult", () => {
  it("emits PASS line and per-violation detail", () => {
    const r = validateStrategyCode("ma = df.close.rolling(20, center=True).mean()");
    const out = formatValidatorResult(r);
    expect(out).toContain("BLOCK");
    expect(out).toContain("centered_window_pandas");
  });

  it("prints PASS on clean code", () => {
    const out = formatValidatorResult(validateStrategyCode("const x = 1;"));
    expect(out).toContain("PASS");
  });
});

describe("validatorResultToPayload", () => {
  it("emits stable shape", () => {
    const r = validateStrategyCode("ma = df.close.rolling(20, center=True).mean()");
    const p = validatorResultToPayload(r);
    expect(p.kind).toBe("strategy_code.validator_recorded");
    expect(p.passes).toBe(false);
    expect(p.blockCount).toBeGreaterThanOrEqual(1);
  });
});
