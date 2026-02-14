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
    return [];
  }

  override async getWithdrawalHistory(_limit?: number): Promise<Withdrawal[]> {
    return [];
  }

  override async withdraw(
    _coin: string,
    _network: string,
    _address: string,
    _amount: number,
    _tag?: string
  ): Promise<WithdrawalResult> {
    throw new Error("Withdrawals via API are not supported on Binance US. Use the Binance US website.");
  }

  override async getWithdrawalInfo(_coin: string, _network?: string): Promise<WithdrawalInfo> {
    throw new Error("Withdrawal info is not available on Binance US. Use the Binance US website.");
  }
}
