import { describe, it, expect } from "bun:test";

import {
  isToolDesignLinterEnabled,
  lintTool,
  lintToolRegistry,
  formatLintReport,
  reportToPayload,
  TOOL_DESIGN_LINTER_FLAG_ENV,
  type ToolDescriptor,
} from "./toolDesignLinter.ts";

describe("isToolDesignLinterEnabled", () => {
  it("respects the flag", () => {
    expect(isToolDesignLinterEnabled({})).toBe(false);
    expect(isToolDesignLinterEnabled({ [TOOL_DESIGN_LINTER_FLAG_ENV]: "1" })).toBe(true);
    expect(isToolDesignLinterEnabled({ [TOOL_DESIGN_LINTER_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("lintTool — no description", () => {
  it("flags as error when description missing", () => {
    const t: ToolDescriptor = { name: "broker_get_account" };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "no_description")).toBe(true);
    expect(findings.find((f) => f.ruleId === "no_description")!.severity).toBe("error");
  });

  it("flags as error when description is empty whitespace", () => {
    const t: ToolDescriptor = { name: "broker_get_account", description: "   " };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "no_description")).toBe(true);
  });
});

describe("lintTool — namespacing", () => {
  it("flags single-word names without prefix", () => {
    const t: ToolDescriptor = { name: "doStuff", description: "Does some stuff with the user data here" };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "namespacing")).toBe(true);
  });

  it("accepts underscore-namespaced names", () => {
    const t: ToolDescriptor = {
      name: "broker_get_account",
      description: "Fetches the active broker account balance and positions",
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "namespacing")).toBe(false);
  });

  it("accepts dot-namespaced names", () => {
    const t: ToolDescriptor = {
      name: "broker.getAccount",
      description: "Fetches the active broker account balance and positions",
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "namespacing")).toBe(false);
  });

  it("accepts explicit namespace property", () => {
    const t: ToolDescriptor = {
      name: "getAccount",
      namespace: "broker",
      description: "Fetches the active broker account balance and positions",
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "namespacing")).toBe(false);
  });
});

describe("lintTool — generic parameter names", () => {
  it("flags 'id' as too generic", () => {
    const t: ToolDescriptor = {
      name: "broker_get_order",
      description: "Fetches an order from the broker by its identifier",
      parameters: [{ name: "id", type: "string" }],
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "generic_param_name")).toBe(true);
  });

  it("flags 'user' as too generic", () => {
    const t: ToolDescriptor = {
      name: "broker_get",
      description: "Fetches details by user",
      parameters: [{ name: "user", type: "string" }],
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "generic_param_name")).toBe(true);
  });

  it("accepts disambiguated names", () => {
    const t: ToolDescriptor = {
      name: "broker_get_order",
      description: "Fetches an order from the broker by its identifier",
      parameters: [{ name: "order_id", type: "string" }],
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "generic_param_name")).toBe(false);
  });
});

describe("lintTool — description length", () => {
  it("flags short descriptions", () => {
    const t: ToolDescriptor = { name: "broker_x", description: "short" };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "description_too_short")).toBe(true);
  });

  it("accepts descriptions ≥ 20 chars", () => {
    const t: ToolDescriptor = {
      name: "broker_x",
      description: "Fetches data from broker x for the active account",
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "description_too_short")).toBe(false);
  });
});

describe("lintTool — low-level identifiers", () => {
  it("flags uuid in parameter name", () => {
    const t: ToolDescriptor = {
      name: "broker_get",
      description: "Fetches data by uuid for the active broker session",
      parameters: [{ name: "asset_uuid", type: "string" }],
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "low_level_identifier")).toBe(true);
  });

  it("flags mime_type", () => {
    const t: ToolDescriptor = {
      name: "broker_get",
      description: "Fetches data with mime constraints from the broker",
      parameters: [{ name: "mime_type", type: "string" }],
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "low_level_identifier")).toBe(true);
  });

  it("accepts semantic names like 'symbol'", () => {
    const t: ToolDescriptor = {
      name: "market_get_candles",
      description: "Fetches OHLCV candles for a market symbol over a time range",
      parameters: [{ name: "symbol", type: "string" }],
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "low_level_identifier")).toBe(false);
  });
});

describe("lintTool — missing response_format on large-output tools", () => {
  it("flags 'list_orders' without response_format", () => {
    const t: ToolDescriptor = {
      name: "list_orders",
      description: "Returns all open orders across all venues — potentially many rows",
      parameters: [],
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "missing_response_format")).toBe(true);
  });

  it("flags 'search_news'", () => {
    const t: ToolDescriptor = {
      name: "search_news",
      description: "Searches news headlines across configured sources for matching keywords",
      parameters: [{ name: "query", type: "string" }],
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "missing_response_format")).toBe(true);
  });

  it("accepts when response_format is present", () => {
    const t: ToolDescriptor = {
      name: "list_orders",
      description: "Returns all open orders across all venues — potentially many rows",
      parameters: [{ name: "response_format", type: "string" }],
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "missing_response_format")).toBe(false);
  });

  it("does not flag small-output tools", () => {
    const t: ToolDescriptor = {
      name: "get_balance",
      description: "Returns the account's current cash balance in USD",
    };
    const findings = lintTool(t);
    expect(findings.some((f) => f.ruleId === "missing_response_format")).toBe(false);
  });
});

describe("lintToolRegistry", () => {
  it("aggregates findings across multiple tools", () => {
    const tools: ToolDescriptor[] = [
      { name: "doStuff" }, // no description + namespacing
      { name: "broker_get", description: "short" }, // description_too_short
      {
        name: "market_get_candles",
        description: "Fetches OHLCV candles for the given symbol",
        parameters: [{ name: "symbol", type: "string" }],
      }, // clean
    ];
    const report = lintToolRegistry(tools);
    expect(report.totalTools).toBe(3);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.countsBySeverity.error).toBeGreaterThanOrEqual(1);
  });

  it("passes when only info/warn findings", () => {
    const tools: ToolDescriptor[] = [
      {
        name: "broker_get_account",
        description: "Fetches the active broker account balance and positions",
        parameters: [{ name: "account_id", type: "string" }],
      },
    ];
    const report = lintToolRegistry(tools);
    expect(report.passes).toBe(true);
  });

  it("fails on any error finding", () => {
    const tools: ToolDescriptor[] = [{ name: "broker_get_x" }]; // missing description = error
    const report = lintToolRegistry(tools);
    expect(report.passes).toBe(false);
  });

  it("handles empty registry", () => {
    const report = lintToolRegistry([]);
    expect(report.totalTools).toBe(0);
    expect(report.passes).toBe(true);
  });
});

describe("formatLintReport", () => {
  it("prints PASS / FAIL header + per-finding lines", () => {
    const tools: ToolDescriptor[] = [{ name: "broker_get" }];
    const out = formatLintReport(lintToolRegistry(tools));
    expect(out).toContain("FAIL");
    expect(out).toContain("no_description");
  });
});

describe("reportToPayload", () => {
  it("emits stable shape", () => {
    const tools: ToolDescriptor[] = [
      {
        name: "broker_get_account",
        description: "Fetches the active broker account balance and positions",
      },
    ];
    const p = reportToPayload(lintToolRegistry(tools));
    expect(p.kind).toBe("tool_design_lint.report_recorded");
    expect(p.passes).toBe(true);
  });
});
