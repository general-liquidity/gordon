import type { Exchange } from "../exchange/types.ts";

interface BrokerIdentitySource {
  readonly brokerId: string;
  readonly isPaper?: boolean;
  getAccount(): Promise<{ id?: string }>;
}

export interface PortfolioIdentityResult {
  identity?: string;
  error?: string;
}

/**
 * Stable capital-account key for an authenticated exchange connection.
 *
 * Gordon user/profile IDs are deliberately absent: switching the local
 * profile must not escape a halt protecting the same venue account.
 */
export function exchangePortfolioIdentity(exchange: Exchange): string | null {
  if (!exchange.connectionIdentity) return null;
  const mode = exchange.isSandbox ? "paper" : "live";
  return `${exchange.exchangeId}:account:${exchange.connectionIdentity}:${mode}`;
}

/** Resolve the strongest account identity available at a trading chokepoint. */
export async function resolvePortfolioIdentity(input: {
  exchange?: Exchange | null;
  broker?: BrokerIdentitySource | null;
}): Promise<PortfolioIdentityResult> {
  if (input.broker) {
    try {
      const account = await input.broker.getAccount();
      if (!account.id) {
        return { error: `${input.broker.brokerId} returned no stable account ID` };
      }
      return {
        identity: `${input.broker.brokerId}:account:${account.id}:${input.broker.isPaper ? "paper" : "live"}`,
      };
    } catch (error) {
      return {
        error: `${input.broker.brokerId} account identity lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  if (input.exchange) {
    const identity = exchangePortfolioIdentity(input.exchange);
    return identity
      ? { identity }
      : { error: `${input.exchange.exchangeId} returned no stable connection identity` };
  }
  return { error: "no exchange or broker identity source is available" };
}
