import type { RuntimeSessionContext, RuntimeSessionSnapshot } from "../contracts/types.ts";

export interface ActiveSessionContextInput {
  runtimeId: string;
  sessionId?: string;
  snapshot: RuntimeSessionSnapshot;
  threadId?: string;
  resourceId?: string;
}

export function createRuntimeSessionContext(
  input: ActiveSessionContextInput,
): RuntimeSessionContext {
  return {
    runtimeId: input.runtimeId,
    sessionId: input.sessionId,
    resourceId: input.resourceId ?? input.snapshot.resourceId,
    threadId: input.threadId ?? input.snapshot.threadId ?? undefined,
  };
}
