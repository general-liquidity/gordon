import { describe, expect, it } from "bun:test";

import { GatewayRuntime } from "./gateway-runtime.ts";
import type { GordonContext } from "../../infra/agents/types.ts";

describe("GatewayRuntime auth defaults", () => {
  it("fails closed: requireAuth is true when the embedder omits it", () => {
    const runtime = new GatewayRuntime({
      resolveContext: async () => ({} as GordonContext),
    });
    // requireAuth is private; mirror the existing integration test's `as any`
    // access pattern to assert the fail-closed default.
    expect((runtime as any).deps.requireAuth).toBe(true);
  });

  it("honors an explicit requireAuth: false", () => {
    const runtime = new GatewayRuntime({
      resolveContext: async () => ({} as GordonContext),
      requireAuth: false,
    });
    expect((runtime as any).deps.requireAuth).toBe(false);
  });
});
