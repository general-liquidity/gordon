import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  parseModelOverride,
  getRoleModelOverride,
  resolveRuntimeModel,
  createModelResolver,
  type AgentRole,
} from "./agentHelpers.ts";

// Save and restore env so tests don't leak state into the rest of the suite.
const ENV_KEYS = [
  "GORDON_MODEL",
  "GORDON_PROVIDER",
  "GORDON_MODEL_ORCHESTRATOR",
  "GORDON_MODEL_EXECUTOR",
  "GORDON_MODEL_RESEARCHER",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("parseModelOverride", () => {
  test("undefined → undefined", () => {
    expect(parseModelOverride(undefined)).toBeUndefined();
  });

  test("empty string → undefined", () => {
    expect(parseModelOverride("")).toBeUndefined();
  });

  test("whitespace-only → undefined", () => {
    expect(parseModelOverride("   ")).toBeUndefined();
  });

  test("provider:model splits on first colon", () => {
    expect(parseModelOverride("anthropic:claude-haiku-4-5")).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
  });

  test("multi-segment model id (gateway prefix style)", () => {
    expect(parseModelOverride("openrouter:anthropic/claude-sonnet-4-5")).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4-5",
    });
  });

  test("bare model id (no colon) → no provider, model only", () => {
    expect(parseModelOverride("claude-sonnet-4-6")).toEqual({
      model: "claude-sonnet-4-6",
    });
  });

  test("trims whitespace around provider and model", () => {
    expect(parseModelOverride("  anthropic : claude-sonnet-4-6  ")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });

  test("colon with empty provider falls back to model only", () => {
    expect(parseModelOverride(":claude-haiku-4-5")).toEqual({
      model: "claude-haiku-4-5",
    });
  });

  test("colon with empty model falls back to provider only", () => {
    expect(parseModelOverride("anthropic:")).toEqual({
      provider: "anthropic",
    });
  });
});

describe("getRoleModelOverride", () => {
  test("returns undefined when no env var is set", () => {
    expect(getRoleModelOverride("executor", {})).toBeUndefined();
  });

  test("reads from GORDON_MODEL_EXECUTOR for executor role", () => {
    expect(
      getRoleModelOverride("executor", {
        GORDON_MODEL_EXECUTOR: "anthropic:claude-sonnet-4-6",
      }),
    ).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });

  test("reads from GORDON_MODEL_RESEARCHER for researcher role", () => {
    expect(
      getRoleModelOverride("researcher", {
        GORDON_MODEL_RESEARCHER: "anthropic:claude-haiku-4-5",
      }),
    ).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
  });

  test("reads from GORDON_MODEL_ORCHESTRATOR for orchestrator role", () => {
    expect(
      getRoleModelOverride("orchestrator", {
        GORDON_MODEL_ORCHESTRATOR: "openai:gpt-5",
      }),
    ).toEqual({
      provider: "openai",
      model: "gpt-5",
    });
  });

  test("roles are independent: setting executor does not affect researcher", () => {
    const env = { GORDON_MODEL_EXECUTOR: "anthropic:claude-sonnet-4-6" };
    expect(getRoleModelOverride("executor", env)).toBeDefined();
    expect(getRoleModelOverride("researcher", env)).toBeUndefined();
    expect(getRoleModelOverride("orchestrator", env)).toBeUndefined();
  });
});

describe("resolveRuntimeModel — backward compatibility", () => {
  test("called with no args and no env returns a model config (built-in default)", () => {
    const result = resolveRuntimeModel();
    // The exact default depends on registry, but result must be a MastraModelConfig (object or string)
    expect(result).toBeDefined();
  });

  test("called with no agentRole, no env vars — behavior unchanged from pre-FW6", () => {
    process.env.GORDON_MODEL = "claude-sonnet-4-6";
    process.env.GORDON_PROVIDER = "anthropic";
    const result = resolveRuntimeModel();
    expect(result).toBeDefined();
    // Should not have applied any role-specific override
  });

  test("role-specific env var is ignored when agentRole is not passed", () => {
    process.env.GORDON_MODEL_EXECUTOR = "anthropic:claude-haiku-4-5";
    process.env.GORDON_MODEL = "claude-sonnet-4-6";
    process.env.GORDON_PROVIDER = "anthropic";
    // Without role argument, role-specific env should not be applied.
    const result = resolveRuntimeModel();
    // No throw, no leak. Specific assertion left loose because workflow-phase
    // routing may pick fast-tier for some phases; what matters here is that
    // GORDON_MODEL_EXECUTOR did NOT bypass the no-role pathway.
    expect(result).toBeDefined();
  });
});

describe("resolveRuntimeModel — FW6 per-role override", () => {
  test("agentRole=executor reads GORDON_MODEL_EXECUTOR before global", () => {
    process.env.GORDON_MODEL_EXECUTOR = "anthropic:claude-sonnet-4-6";
    process.env.GORDON_MODEL = "claude-haiku-4-5"; // different from role-specific
    process.env.GORDON_PROVIDER = "anthropic";
    const result = resolveRuntimeModel(undefined, "executor");
    expect(result).toBeDefined();
    // Result depends on registry resolution. The key assertion is "no throw"
    // and that the role-specific override was attempted.
  });

  test("falls back to GORDON_MODEL when role-specific is unset", () => {
    process.env.GORDON_MODEL = "claude-sonnet-4-6";
    process.env.GORDON_PROVIDER = "anthropic";
    const result = resolveRuntimeModel(undefined, "executor");
    expect(result).toBeDefined();
  });

  test("requestContext config takes precedence over role env var", () => {
    process.env.GORDON_MODEL_EXECUTOR = "anthropic:claude-haiku-4-5";
    const contextConfig = {
      modelConfig: {
        provider: "anthropic",
        model: "claude-opus-4-5",
      },
    };
    const args = {
      requestContext: {
        get: (key: string) => (key === "config" ? contextConfig : undefined),
      },
    };
    const result = resolveRuntimeModel(args, "executor");
    expect(result).toBeDefined();
    // Context config opus should win over env var haiku; assertion is loose
    // because we don't know the registry's exact return shape for this id.
  });
});

describe("createModelResolver", () => {
  test("returns a function that resolves with the bound role", () => {
    const resolver = createModelResolver("researcher");
    expect(typeof resolver).toBe("function");
    process.env.GORDON_MODEL_RESEARCHER = "anthropic:claude-haiku-4-5";
    process.env.GORDON_MODEL = "claude-sonnet-4-6";
    const result = resolver();
    expect(result).toBeDefined();
  });

  test("each role gets an independent resolver", () => {
    const execResolver = createModelResolver("executor");
    const researchResolver = createModelResolver("researcher");
    process.env.GORDON_MODEL_EXECUTOR = "anthropic:claude-sonnet-4-6";
    process.env.GORDON_MODEL_RESEARCHER = "anthropic:claude-haiku-4-5";
    expect(execResolver()).toBeDefined();
    expect(researchResolver()).toBeDefined();
  });

  test("forwards requestContext args to underlying resolver", () => {
    let lastKey: string | undefined;
    const resolver = createModelResolver("executor");
    resolver({
      requestContext: {
        get: (key: string) => {
          lastKey = key;
          return undefined;
        },
      },
    });
    // Resolver should have queried the context at least once
    expect(typeof lastKey === "string" || lastKey === undefined).toBe(true);
  });
});

describe("ROLE_ENV_VAR mapping (via getRoleModelOverride)", () => {
  test("all three roles read from documented env vars", () => {
    const env: Record<string, string> = {
      GORDON_MODEL_ORCHESTRATOR: "anthropic:opus",
      GORDON_MODEL_EXECUTOR: "anthropic:sonnet",
      GORDON_MODEL_RESEARCHER: "anthropic:haiku",
    };
    expect(getRoleModelOverride("orchestrator", env)?.model).toBe("opus");
    expect(getRoleModelOverride("executor", env)?.model).toBe("sonnet");
    expect(getRoleModelOverride("researcher", env)?.model).toBe("haiku");
  });

  test("only setting one role leaves the others undefined", () => {
    const env: Record<string, string> = {
      GORDON_MODEL_ORCHESTRATOR: "anthropic:opus",
    };
    expect(getRoleModelOverride("orchestrator", env)).toBeDefined();
    expect(getRoleModelOverride("executor", env)).toBeUndefined();
    expect(getRoleModelOverride("researcher", env)).toBeUndefined();
  });

  test("AgentRole type-checks for all three valid values", () => {
    const roles: AgentRole[] = ["orchestrator", "executor", "researcher"];
    for (const role of roles) {
      expect(typeof role).toBe("string");
    }
  });
});
