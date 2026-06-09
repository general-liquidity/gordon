import type { GordonContext } from "../../infra/agents/types.ts";
import type { BinanceClient } from "../../infra/venues/exchange/clients/binance/index.ts";
import type { Exchange } from "../../infra/exchange/index.ts";
import type { BrokerAdapter } from "../../infra/broker/index.ts";
import type { LLMClient } from "../../infra/ai/llm/index.ts";
import type { ActionTaskScope, CredentialProfile } from "../../infra/runtime/actions/types.ts";
import type { GordonConfig } from "../../types/index.ts";

export interface AppContextInput {
  binance: BinanceClient | null;
  exchange: Exchange | null;
  broker: BrokerAdapter | null;
  llm: LLMClient;
  config: GordonConfig;
  portfolioValue: number;
  availableCash: number;
  userId?: string;
  threadId?: string;
  requestedActionId?: string;
  requestedTaskScope?: ActionTaskScope;
  credentialProfile?: CredentialProfile;
}

export function buildAppGordonContext(input: AppContextInput): GordonContext {
  return {
    binance: input.binance,
    exchange: input.exchange,
    broker: input.broker,
    llm: input.llm,
    config: input.config,
    portfolioValue: input.portfolioValue,
    availableCash: input.availableCash,
    userId: input.userId,
    threadId: input.threadId,
    requestedActionId: input.requestedActionId,
    requestedTaskScope: input.requestedTaskScope,
    credentialProfile: input.credentialProfile,
  };
}
