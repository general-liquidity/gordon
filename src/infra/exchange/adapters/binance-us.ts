/**
 * Binance US Exchange Adapter
 * Extends BinanceAdapter for api.binance.us
 *
 * Binance US shares the same /api/v3/* endpoints (trading, market data, account, OCO)
 * but does NOT support most /sapi/* endpoints (earn, dust, transfers, wallet details,
 * deposit/withdrawal history). This adapter overrides SAPI-dependent methods with
 * graceful fallbacks.
 */

import { BinanceClient } from "../../binance/index.ts";
import { BinanceAdapter } from "./binance.ts";
import type {
  ExchangeId,
  AccountDetails,
  Balance,
  Deposit,
  Withdrawal,
  WithdrawalResult,
  WithdrawalInfo,
} from "../types.ts";

export class BinanceUSAdapter extends BinanceAdapter {
  override readonly exchangeId: ExchangeId = "binance_us";
  override readonly displayName = "Binance US";

  constructor(apiKey: string, apiSecret: string) {
    super(new BinanceClient(apiKey, apiSecret, "https://api.binance.us"));
  }

  // ---------------------------------------------------------------------------
  // Override SAPI-dependent methods
  // ---------------------------------------------------------------------------

  override async getAllBalances(): Promise<Balance[]> {
    const info = await this.getAccountInfo();
    return info.balances.filter((b) => b.total > 0);
  }

  override async getFullAccountDetails(): Promise<AccountDetails> {
    const accountInfo = await this.getAccountInfo();
    const nonZeroBalances = accountInfo.balances.filter((b) => b.total > 0);
    const stableBalances = nonZeroBalances.filter(
      (b) => b.asset === "USDT" || b.asset === "BUSD" || b.asset === "USDC" || b.asset === "USD"
    );
    const totalUsdtValue = stableBalances.reduce((sum, b) => sum + b.total, 0);

    return { accountInfo, totalUsdtValue, nonZeroBalances };
  }

  override async getDepositHistory(_limit?: number): Promise<Deposit[]> {
    console.warn("[binance-us] Deposit/withdrawal history not available via Binance US API (SAPI endpoints unsupported). Use the Binance US website for fund transfer records.");
    return [];
  }

  override async getWithdrawalHistory(_limit?: number): Promise<Withdrawal[]> {
    console.warn("[binance-us] Deposit/withdrawal history not available via Binance US API (SAPI endpoints unsupported). Use the Binance US website for fund transfer records.");
    return [];
  }

  override async withdraw(
    coin: string,
    _network: string,
    _address: string,
    amount: number,
    _tag?: string
  ): Promise<WithdrawalResult> {
    return {
      id: "",
      coin,
      amount,
      network: _network,
      address: _address,
      fee: 0,
      status: "not_supported",
    };
  }

  override async getWithdrawalInfo(coin: string, _network?: string): Promise<WithdrawalInfo> {
    return {
      coin,
      networks: [],
      withdrawEnabled: false,
      message: "Withdrawal info is not available on Binance US. Use the Binance US website.",
    } as WithdrawalInfo;
  }
}
