import { beforeEach, describe, expect, it } from "bun:test";
import { GordonConfigSchema } from "../../types/index.ts";
import type { GordonContext } from "../../infra/agents/types.ts";
import { ToolInvoker } from "./ToolInvoker.ts";
import { ToolRegistry } from "./ToolRegistry.ts";
import { PermissionEngine, ToolApprovalRequiredError } from "../permissions/PermissionEngine.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import { createDefaultRuntimeSessionState } from "../state/SessionState.ts";
import { TranscriptStore } from "../transcript/TranscriptStore.ts";
import { ScratchpadStore } from "../workers/ScratchpadStore.ts";
import { WorkerRegistry } from "../workers/WorkerRegistry.ts";
import {
  _resetDefaultTrustTrajectoryForTests,
} from "../permissions/trustTrajectory.ts";

function createContext(permissionMode: GordonContext["config"]["permissionMode"] = "strict"): GordonContext {
  const config = GordonConfigSchema.parse({ permissionMode });
  return {
    exchange: null,
    broker: null,
    llm: {} as GordonContext["llm"],
    config,
    portfolioValue: 10_000,
    availableCash: 5_000,
    userId: "user-test",
    threadId: "thread-test",
  };
}

function createInvoker() {
  const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
  store.setSession({
    runtimeId: "app",
    sessionId: "app",
    resourceId: "user-1",
    threadId: "thread-1",
  });
  return {
    invoker: new ToolInvoker(new ToolRegistry(), new PermissionEngine(store)),
    store,
  };
}

describe("ToolInvoker", () => {
  beforeEach(() => {
    _resetDefaultTrustTrajectoryForTests();
  });

  it("blocks tools denied by runtime policy in strict mode", async () => {
    const { invoker, store } = createInvoker();
    const state = store.getState();
    await expect(
      invoker.prepare("place_market_order", createContext("strict"), {
        session: state.session,
        runtimeState: state,
        transcriptStore: new TranscriptStore(),
        scratchpadStore: new ScratchpadStore(),
        workerRegistry: new WorkerRegistry(),
      }),
    ).rejects.toThrow(/blocked/i);
  });

  it("allows read-only tools in strict mode", async () => {
    const { invoker, store } = createInvoker();
    const state = store.getState();
    const prepared = await invoker.prepare("scan_market", createContext("strict"), {
      session: state.session,
      runtimeState: state,
      transcriptStore: new TranscriptStore(),
      scratchpadStore: new ScratchpadStore(),
      workerRegistry: new WorkerRegistry(),
    });
    expect(prepared.policy.allowed).toBe(true);
  });

  it("queues approval for execution tools in ask mode", async () => {
    const { invoker, store } = createInvoker();
    const state = store.getState();
    await expect(
      invoker.prepare("place_market_order", createContext("ask"), {
        session: state.session,
        runtimeState: state,
        transcriptStore: new TranscriptStore(),
        scratchpadStore: new ScratchpadStore(),
        workerRegistry: new WorkerRegistry(),
      }),
    ).rejects.toBeInstanceOf(ToolApprovalRequiredError);
    expect(store.getState().approvals.pending).toHaveLength(1);
  });

  it("does not collapse different runtime-tool arguments into one approval", async () => {
    const { invoker, store } = createInvoker();
    const state = store.getState();
    const base = {
      session: state.session,
      runtimeState: state,
      transcriptStore: new TranscriptStore(),
      scratchpadStore: new ScratchpadStore(),
      workerRegistry: new WorkerRegistry(),
    };

    await expect(
      invoker.prepare("place_market_order", createContext("ask"), {
        ...base,
        args: { symbol: "BTCUSDT", quantity: 1 },
      }),
    ).rejects.toBeInstanceOf(ToolApprovalRequiredError);
    await expect(
      invoker.prepare("place_market_order", createContext("ask"), {
        ...base,
        args: { symbol: "ETHUSDT", quantity: 1 },
      }),
    ).rejects.toBeInstanceOf(ToolApprovalRequiredError);

    expect(store.getState().approvals.pending).toHaveLength(2);
  });
});
