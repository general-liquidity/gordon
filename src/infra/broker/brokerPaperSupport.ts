/**
 * Broker Paper Trading Support Matrix
 *
 * Central declaration of which brokers offer a paper/sandbox environment
 * Gordon can route to when `credentials.paper === true`.
 *
 * Kinds of paper support:
 *  - "paper_url"   — dedicated paper-trading base URL (separate from live)
 *  - "sim_url"     — simulation/certification URL (functionally equivalent)
 *  - "account"     — same URL; paper mode is a separate account type at
 *                    the broker (IBKR paper uses same gateway, different port)
 *  - "unsupported" — broker doesn't expose a developer-accessible paper env
 */

import type { BrokerId } from "./types.ts";

export type BrokerPaperKind = "paper_url" | "sim_url" | "account" | "unsupported";

export interface BrokerPaperSupportEntry {
  kind: BrokerPaperKind;
  paperBaseUrl?: string;
  /** Human-readable hint shown when paper mode is requested but unsupported. */
  notSupportedHint?: string;
  /** Docs pointer for setting up paper credentials. */
  docs?: string;
}

export const BROKER_PAPER_SUPPORT: Record<BrokerId, BrokerPaperSupportEntry> = {
  alpaca: {
    kind: "paper_url",
    paperBaseUrl: "https://paper-api.alpaca.markets",
    docs: "Alpaca paper trading requires the same API key set — no separate signup. Set ALPACA_PAPER=true.",
  },
  tastytrade: {
    kind: "sim_url",
    paperBaseUrl: "https://api.cert.tastyworks.com",
    docs: "tastytrade certification environment mirrors production. Set TASTYTRADE_PAPER=true.",
  },
  ibkr: {
    kind: "account",
    docs: "IBKR paper trading runs through the same Client Portal Gateway on a different port (typically 5001 vs 5000). Set IBKR_PAPER=true and point IBKR_GATEWAY_URL to your paper gateway.",
  },
};

export class BrokerPaperNotSupportedError extends Error {
  readonly brokerId: BrokerId;
  readonly hint?: string;

  constructor(brokerId: BrokerId, hint?: string) {
    const baseMsg = `Paper trading is not available for broker "${brokerId}".`;
    super(hint ? `${baseMsg} ${hint}` : baseMsg);
    this.name = "BrokerPaperNotSupportedError";
    this.brokerId = brokerId;
    this.hint = hint;
  }
}

/**
 * Validate that paper mode is supported for this broker.
 * No-op when paper mode isn't requested.
 */
export function assertBrokerPaperSupported(brokerId: BrokerId, paperRequested: boolean): void {
  if (!paperRequested) return;
  const entry = BROKER_PAPER_SUPPORT[brokerId];
  if (entry.kind === "unsupported") {
    throw new BrokerPaperNotSupportedError(brokerId, entry.notSupportedHint);
  }
}

export function isBrokerPaperSupported(brokerId: BrokerId): boolean {
  return BROKER_PAPER_SUPPORT[brokerId].kind !== "unsupported";
}

export function listBrokerPaperSupported(): BrokerId[] {
  return (Object.keys(BROKER_PAPER_SUPPORT) as BrokerId[]).filter(isBrokerPaperSupported);
}
