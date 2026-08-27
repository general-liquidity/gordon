/**
 * CCXT UX helpers — exchange-type detection + setup guidance for
 * operators adding `ccxt:<sub-id>` exchanges via `/exchange add`.
 *
 * First-class venues have curated passphrase / wallet detection
 * (coinbase needs passphrase, hyperliquid uses wallet, etc.).
 * For the long-tail we don't enumerate 107 entries — instead
 * we maintain compact "known passphrase/wallet" sets and fall through
 * to a sensible default for the long tail (apiKey + apiSecret).
 *
 * Adding a new entry to either set is a one-line change here; the
 * setup-wizard auto-prompts for the right fields after.
 */

import { extractCcxtSubId, isCcxtExchangeId, type CcxtExchangeId } from "./types.ts";

/**
 * CCXT exchanges that require a `passphrase` / `password` field beyond
 * api key + secret. Drawn from CCXT v4 docs + per-exchange known-need
 * audit.
 */
const CCXT_PASSPHRASE_EXCHANGES = new Set<string>([
  "coinbase", // legacy REST
  "coinbasepro", // legacy alias
  "coinbaseinternational",
  "coinbaseadvanced",
  "okx",
  "kucoin",
  "kucoinfutures",
  "bitget",
  "gate",
  "gateio", // alias
  "bitmart",
  "phemex",
  "cryptocom",
  "blofin",
  "ndax",
  "deepcoin",
]);

/**
 * CCXT exchanges that authenticate via a wallet private key rather
 * than api key + secret. Mostly DEXes + non-custodial venues.
 */
const CCXT_WALLET_EXCHANGES = new Set<string>([
  "hyperliquid",
  "apex",
  "aster",
  "dydx",
  "paradex",
  "vertex",
  "lighter",
  "pacifica",
  "grvt",
  "aftermath",
]);

export function ccxtSubIdRequiresPassphrase(subId: string): boolean {
  return CCXT_PASSPHRASE_EXCHANGES.has(subId.toLowerCase());
}

export function ccxtSubIdRequiresWallet(subId: string): boolean {
  return CCXT_WALLET_EXCHANGES.has(subId.toLowerCase());
}

/**
 * Convenience: works on the full `ccxt:<sub-id>` id, not just the sub-id.
 * Returns false for non-CCXT exchange ids (callers should branch on
 * `isCcxtExchangeId` first).
 */
export function ccxtExchangeRequiresPassphrase(id: string): boolean {
  if (!isCcxtExchangeId(id)) return false;
  return ccxtSubIdRequiresPassphrase(extractCcxtSubId(id as CcxtExchangeId));
}

export function ccxtExchangeRequiresWallet(id: string): boolean {
  if (!isCcxtExchangeId(id)) return false;
  return ccxtSubIdRequiresWallet(extractCcxtSubId(id as CcxtExchangeId));
}

/**
 * Setup-instructions text shown to operators after `/exchange add
 * ccxt:<sub-id>` is invoked. Format mirrors the per-native blocks in
 * `app/commands/exchange.ts:getExchangeSetupInstructions`.
 */
export function getCcxtSetupInstructions(id: string, sandbox = false): string {
  if (!isCcxtExchangeId(id)) return "";
  const subId = extractCcxtSubId(id as CcxtExchangeId);
  const upper = subId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const needsPass = ccxtSubIdRequiresPassphrase(subId);
  const needsWallet = ccxtSubIdRequiresWallet(subId);

  const envLines: string[] = [];
  if (needsWallet) {
    envLines.push(`  CCXT_${upper}_WALLET_PRIVATE_KEY="<your-private-key>"`);
  } else {
    envLines.push(`  CCXT_${upper}_API_KEY="<your-api-key>"`);
    envLines.push(`  CCXT_${upper}_API_SECRET="<your-api-secret>"`);
    if (needsPass) {
      envLines.push(`  CCXT_${upper}_PASSPHRASE="<your-passphrase>"`);
    }
  }

  const sandboxNote = sandbox
    ? `\nSandbox: CCXT will call setSandboxMode(true). ~30 of CCXT's 107 exchanges actually support sandbox — the rest silently no-op and run live. Verify via the adapter's isSandbox property after construction.`
    : "";

  return `
${subId.toUpperCase()} (via CCXT)
1. Generate API credentials on the exchange's website.${needsPass ? " This exchange requires a passphrase in addition to key/secret." : ""}${needsWallet ? " This exchange uses wallet-based auth — provide your wallet's private key." : ""}
2. Set the following env vars (Gordon reads them at adapter construct time):
${envLines.join("\n")}
3. Run \`/exchange add ${id}${sandbox ? " --sandbox" : ""}\` again to register.
4. Gordon's CCXT adapter routes all calls through the unified API. Some methods may be unsupported on this specific exchange — check via \`adapter.supports("<method>")\`.${sandboxNote}

Coverage notes:
- All standard spot operations (price, candles, orderbook, balance, order placement) work
- Derivatives (funding rate, positions, leverage, margin mode) work if the exchange offers them
- Margin operations (borrow, repay) work if the exchange offers them
- See https://docs.ccxt.com/ for the canonical CCXT API + per-exchange limitations`;
}

/**
 * Help text fragment listing CCXT integration availability. Slotted
 * into `/exchange help` output.
 */
export function getCcxtHelpFragment(): string {
  return `CCXT-routed exchanges (alternative to natives, 100+ supported):
  /exchange add ccxt:bybit       - Add Bybit via CCXT
  /exchange add ccxt:kucoin      - Add KuCoin via CCXT
  /exchange add ccxt:mexc        - Add MEXC via CCXT
  /exchange add ccxt:crypto_com  - Add Crypto.com via CCXT
  /exchange add ccxt:<sub-id>    - Any of CCXT's 107 exchanges

Auth: CCXT exchanges read credentials from CCXT_<UPPER_SUB_ID>_API_KEY /
      _API_SECRET / _PASSPHRASE / _WALLET_PRIVATE_KEY env vars.
      Run \`/exchange add ccxt:<sub-id>\` for the exact env var names.`;
}
