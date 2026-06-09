/**
 * Wallet / address-intelligence adapter.
 *
 * Provider-agnostic interface + capability-routed manager (priority + fallback)
 * for onchain address data CCXT cannot see: balances, portfolios, transaction
 * flow, token holders, and smart-money labels. Each provider implements only
 * the capabilities it supports; the manager routes each op to the highest
 * priority available source. Read-only, per-provider credentials, no wallet.
 *
 * @example
 * const m = getWalletIntelManager();
 * registerWalletIntelSources(m);
 * const flow = await m.getSmartMoneyFlow({ chain: "ethereum" });
 * const labels = await m.getAddressLabels({ address: "0x..." });
 */

import type { WalletIntelSource } from "./types.ts";
import type { WalletIntelManager } from "./manager.ts";
import { CovalentWalletSource } from "./covalent.ts";
import { MoralisWalletSource } from "./moralis.ts";
import { ZerionWalletSource } from "./zerion.ts";
import { DeBankWalletSource } from "./debank.ts";
import { NansenWalletSource } from "./nansen.ts";
import { ArkhamWalletSource } from "./arkham.ts";

export type {
  WalletIntelSource,
  WalletIntelCapabilities,
  AddressQuery,
  TxQuery,
  TokenQuery,
  SmartMoneyQuery,
  TokenBalance,
  Portfolio,
  WalletTx,
  TokenHolder,
  AddressLabel,
  SmartMoneyFlowItem,
} from "./types.ts";

export {
  WalletIntelManager,
  getWalletIntelManager,
  resetWalletIntelManager,
} from "./manager.ts";

export {
  CovalentWalletSource,
  MoralisWalletSource,
  ZerionWalletSource,
  DeBankWalletSource,
  NansenWalletSource,
  ArkhamWalletSource,
};

/** Every wallet-intelligence provider, in priority order. Auth-gated ones
 * self-skip via isAvailable() when their key is unset. */
export function walletIntelSources(): WalletIntelSource[] {
  return [
    new NansenWalletSource(),   // 28 — labels + smart-money flow
    new ArkhamWalletSource(),   // 29 — labels + balances
    new CovalentWalletSource(), // 30 — balances + tx + holders
    new MoralisWalletSource(),  // 32 — balances + tx + portfolio
    new ZerionWalletSource(),   // 34 — portfolio + balances
    new DeBankWalletSource(),   // 36 — portfolio + balances
  ];
}

/** Register every wallet-intelligence provider on a manager (one call). */
export function registerWalletIntelSources(manager: WalletIntelManager): void {
  for (const source of walletIntelSources()) {
    manager.register(source);
  }
}
