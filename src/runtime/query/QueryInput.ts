import type { GordonContext } from "../../infra/agents/types.ts";
import type { RuntimeQueryExecutionOptions, RuntimeSessionContext } from "../contracts/types.ts";

export interface QueryInput extends RuntimeQueryExecutionOptions {
  session: RuntimeSessionContext;
  contextOverride?: GordonContext;
}
