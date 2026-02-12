/**
 * Wallet Tools (Mastra Format)
 * Tools for wallet management, transfers, and dust conversion
 *
 * Migrated from OpenAI Agents SDK format to Mastra format.
 * Key differences:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Context access via first parameter destructuring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getGordonContext, type MastraExecutionContext } from "./types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please run setup first." },
  binanceOnly: { error: "Wallet operations are currently supported only on Binance." },
  notArmed: (action: string) => ({
    error: `System must be ARMED to ${action}. Use 'arm' command first.`,
  }),
};

// ============================================================================
// Dust Management
// ============================================================================

export const getDustableAssetsTool = createTool({
  id: "get_dustable_assets",
  description:
    "Get list of small balance assets that can be converted to BNB. " +
    "Use when user asks to 'clean up small balances', 'convert dust', or 'what can I convert to BNB'.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    message: z.string().optional(),
    totalBNB: z.string().optional(),
    assets: z.array(
      z.object({
        asset: z.string(),
        amount: z.string(),
        bnbValue: z.string(),
      })
    ).optional(),
    error: z.string().optional(),
  }),
  execute: async (_input, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId != "binance") {
      return errors.binanceOnly;
    }

    try {
      const result = await ctx.binance.getDustableAssets();

      if (result.details.length === 0) {
        return {
          message: "No dustable assets found. All your balances are above the minimum threshold.",
          assets: [],
        };
      }

      return {
        message: `Found ${result.details.length} assets that can be converted to BNB.`,
        totalBNB: result.totalTransferBNB,
        assets: result.details.map((a) => ({
          asset: a.asset,
          amount: a.amountFree,
          bnbValue: a.toBNB,
        })),
      };
    } catch (error) {
      return { error: `Failed to get dustable assets: ${(error as Error).message}` };
    }
  },
});

export const convertDustTool = createTool({
  id: "convert_dust",
  description:
    "Convert small balance assets (dust) to BNB. " +
    "Use when user says 'convert dust to BNB', 'clean up balances', or 'sweep small amounts'. " +
    "Requires ARMED mode for actual conversion.",
  inputSchema: z.object({
    assets: z
      .array(z.string())
      .describe("List of asset symbols to convert (e.g., ['ADA', 'DOT'])"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    totalTransferred: z.string().optional(),
    fee: z.string().optional(),
    conversions: z
      .array(
        z.object({
          from: z.string(),
          amount: z.string(),
          receivedBNB: z.string(),
        })
      )
      .optional(),
    error: z.string().optional(),
    assets: z.array(z.string()).optional(),
  }),
  execute: async ({ assets }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId != "binance") {
      return errors.binanceOnly;
    }

    if (ctx.config?.mode !== "ARMED") {
      return {
        ...errors.notArmed("convert dust"),
        assets: assets,
      };
    }

    try {
      const result = await ctx.binance.convertDust(assets);

      return {
        success: true,
        totalTransferred: result.totalTransfered + " BNB",
        fee: result.totalServiceCharge + " BNB",
        conversions: result.transferResult.map((r) => ({
          from: r.fromAsset,
          amount: r.amount,
          receivedBNB: r.transferedAmount,
        })),
      };
    } catch (error) {
      return { error: `Failed to convert dust: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Universal Transfer
// ============================================================================

export const transferFundsTool = createTool({
  id: "transfer_funds",
  description:
    "Transfer assets between wallets (Spot, Funding, Futures, Margin). " +
    "Use when user wants to 'move funds', 'transfer to funding', 'transfer to spot'. " +
    "Requires ARMED mode.",
  inputSchema: z.object({
    type: z
      .enum([
        "MAIN_FUNDING",
        "FUNDING_MAIN",
        "MAIN_UMFUTURE",
        "UMFUTURE_MAIN",
        "MAIN_MARGIN",
        "MARGIN_MAIN",
      ])
      .describe(
        "Transfer type: MAIN=Spot, FUNDING=Funding wallet, UMFUTURE=USD-M Futures, MARGIN=Cross Margin"
      ),
    asset: z.string().describe("Asset to transfer (e.g., 'USDT', 'BTC')"),
    amount: z.number().positive().describe("Amount to transfer"),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    transactionId: z.number().optional(),
    error: z.string().optional(),
    type: z.string().optional(),
    asset: z.string().optional(),
    amount: z.number().optional(),
  }),
  execute: async ({ type, asset, amount }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId != "binance") {
      return errors.binanceOnly;
    }

    if (ctx.config?.mode !== "ARMED") {
      return {
        ...errors.notArmed("transfer funds"),
        type,
        asset,
        amount,
      };
    }

    try {
      const result = await ctx.binance.universalTransfer(type, asset, amount);

      const typeDescriptions: Record<string, string> = {
        MAIN_FUNDING: "Spot -> Funding",
        FUNDING_MAIN: "Funding -> Spot",
        MAIN_UMFUTURE: "Spot -> USD-M Futures",
        UMFUTURE_MAIN: "USD-M Futures -> Spot",
        MAIN_MARGIN: "Spot -> Cross Margin",
        MARGIN_MAIN: "Cross Margin -> Spot",
      };

      return {
        success: true,
        message: `Transferred ${amount} ${asset} (${typeDescriptions[type]})`,
        transactionId: result.tranId,
      };
    } catch (error) {
      return { error: `Transfer failed: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Asset Info
// ============================================================================

export const getCoinInfoTool = createTool({
  id: "get_coin_info",
  description:
    "Get detailed information about a coin including networks, fees, and deposit/withdrawal status. " +
    "Use when user asks 'what networks for BTC', 'withdrawal fee for ETH', 'can I deposit USDT'.",
  inputSchema: z.object({
    coin: z.string().describe("Coin symbol (e.g., 'BTC', 'ETH', 'USDT')"),
  }),
  outputSchema: z.object({
    coin: z.string().optional(),
    name: z.string().optional(),
    canDeposit: z.boolean().optional(),
    canWithdraw: z.boolean().optional(),
    networks: z
      .array(
        z.object({
          network: z.string(),
          name: z.string(),
          depositEnabled: z.boolean(),
          withdrawEnabled: z.boolean(),
          withdrawFee: z.string(),
          withdrawMin: z.string(),
          confirmations: z.number(),
          estimatedArrival: z.string(),
          isDefault: z.boolean(),
        })
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ coin }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId != "binance") {
      return errors.binanceOnly;
    }

    try {
      const info = await ctx.binance.getCoinNetworks(coin);

      if (!info) {
        return { error: `Coin ${coin} not found on Binance.` };
      }

      return {
        coin: info.coin,
        name: info.name,
        canDeposit: info.depositAllEnable,
        canWithdraw: info.withdrawAllEnable,
        networks: info.networkList.map((n) => ({
          network: n.network,
          name: n.name,
          depositEnabled: n.depositEnable,
          withdrawEnabled: n.withdrawEnable,
          withdrawFee: n.withdrawFee,
          withdrawMin: n.withdrawMin,
          confirmations: n.minConfirm,
          estimatedArrival: n.estimatedArrivalTime + " mins",
          isDefault: n.isDefault,
        })),
      };
    } catch (error) {
      return { error: `Failed to get coin info: ${(error as Error).message}` };
    }
  },
});

export const getTradeFeesTool = createTool({
  id: "get_trade_fees",
  description:
    "Get trading fee rates (maker/taker) for symbols. " +
    "Use when user asks 'what are the fees', 'trading costs', 'maker taker rates'.",
  inputSchema: z.object({
    symbol: z
      .string()
      .default("")
      .describe("Trading pair (e.g., 'BTCUSDT'). Empty string for all symbols."),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    makerFee: z.string().optional(),
    takerFee: z.string().optional(),
    message: z.string().optional(),
    fees: z
      .array(
        z.object({
          symbol: z.string(),
          maker: z.string(),
          taker: z.string(),
        })
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId != "binance") {
      return errors.binanceOnly;
    }

    try {
      const fees = await ctx.binance.getTradeFees(symbol);

      if (fees.length === 0) {
        return { message: "No fee information available." };
      }

      if (symbol) {
        const fee = fees[0];
        return {
          symbol: fee?.symbol,
          makerFee: (parseFloat(fee?.makerCommission ?? "0") * 100).toFixed(4) + "%",
          takerFee: (parseFloat(fee?.takerCommission ?? "0") * 100).toFixed(4) + "%",
        };
      }

      return {
        message: `Fee information for ${fees.length} trading pairs.`,
        fees: fees.slice(0, 20).map((f) => ({
          symbol: f.symbol,
          maker: (parseFloat(f.makerCommission) * 100).toFixed(4) + "%",
          taker: (parseFloat(f.takerCommission) * 100).toFixed(4) + "%",
        })),
      };
    } catch (error) {
      return { error: `Failed to get trade fees: ${(error as Error).message}` };
    }
  },
});

export const getAssetDividendsTool = createTool({
  id: "get_asset_dividends",
  description:
    "Get history of asset dividends, airdrops, and staking rewards. " +
    "Use when user asks 'did I receive any airdrops', 'staking rewards', 'dividend history'.",
  inputSchema: z.object({
    asset: z
      .string()
      .default("")
      .describe("Filter by asset (e.g., 'BNB'). Empty for all."),
    limit: z
      .number()
      .min(1)
      .max(500)
      .default(20)
      .describe("Number of records to return"),
  }),
  outputSchema: z.object({
    message: z.string().optional(),
    total: z.number().optional(),
    dividends: z
      .array(
        z.object({
          asset: z.string(),
          amount: z.string(),
          description: z.string(),
          time: z.string(),
        })
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ asset, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId != "binance") {
      return errors.binanceOnly;
    }

    try {
      const result = await ctx.binance.getAssetDividends({ asset, limit });

      if (result.rows.length === 0) {
        return { message: "No dividend records found." };
      }

      return {
        total: result.total,
        dividends: result.rows.map((d) => ({
          asset: d.asset,
          amount: d.amount,
          description: d.enInfo,
          time: new Date(d.divTime).toISOString(),
        })),
      };
    } catch (error) {
      return { error: `Failed to get dividends: ${(error as Error).message}` };
    }
  },
});

export const getDepositAddressTool = createTool({
  id: "get_deposit_address",
  description:
    "Get deposit address for a coin on a specific network. " +
    "Use when user asks 'deposit address for BTC', 'where to send ETH'.",
  inputSchema: z.object({
    coin: z.string().describe("Coin symbol (e.g., 'BTC', 'ETH')"),
    network: z
      .string()
      .default("")
      .describe("Network (e.g., 'BTC', 'ETH', 'TRX'). Empty for default network."),
  }),
  outputSchema: z.object({
    coin: z.string().optional(),
    address: z.string().optional(),
    tag: z.string().nullable().optional(),
    network: z.string().optional(),
    warning: z.string().nullable().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ coin, network }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId != "binance") {
      return errors.binanceOnly;
    }

    try {
      const address = await ctx.binance.getDepositAddress(coin, network);

      return {
        coin: address.coin,
        address: address.address,
        tag: address.tag || null,
        network: network || "default",
        warning: address.tag
          ? "IMPORTANT: You must include the tag/memo when depositing!"
          : null,
      };
    } catch (error) {
      return { error: `Failed to get deposit address: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// User Assets & Wallet Balances
// ============================================================================

export const getUserAssetsTool = createTool({
  id: "get_user_assets",
  description:
    "Get all user assets with BTC valuation. " +
    "Use when user asks 'what assets do I have?', 'show my balances in BTC', 'total portfolio in BTC'.",
  inputSchema: z.object({
    showAll: z
      .boolean()
      .default(false)
      .describe("Show all assets including zero balances. By default only shows non-zero."),
  }),
  outputSchema: z.object({
    count: z.number().optional(),
    totalBtcValuation: z.string().optional(),
    assets: z
      .array(
        z.object({
          asset: z.string(),
          free: z.string(),
          locked: z.string(),
          btcValuation: z.string(),
        })
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ showAll }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId !== "binance") {
      return errors.binanceOnly;
    }

    try {
      const userAssets = await ctx.binance.getUserAssets(true);

      const filtered = showAll
        ? userAssets
        : userAssets.filter(
            (a) => parseFloat(a.free) > 0 || parseFloat(a.locked) > 0
          );

      const totalBtcValuation = userAssets
        .reduce((sum, a) => sum + parseFloat(a.btcValuation), 0)
        .toFixed(8);

      return {
        count: filtered.length,
        totalBtcValuation,
        assets: filtered.map((a) => ({
          asset: a.asset,
          free: a.free,
          locked: a.locked,
          btcValuation: a.btcValuation,
        })),
      };
    } catch (error) {
      return { error: `Failed to get user assets: ${(error as Error).message}` };
    }
  },
});

export const getWalletBalancesTool = createTool({
  id: "get_wallet_balances",
  description:
    "Get wallet balance summary across all wallet types (Spot, Funding, Margin, etc.). " +
    "Use when user asks 'wallet balances', 'how much in each wallet', 'funding wallet balance'.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    wallets: z
      .array(
        z.object({
          walletName: z.string(),
          balance: z.string(),
          active: z.boolean(),
        })
      )
      .optional(),
    totalBalance: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (_input, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId !== "binance") {
      return errors.binanceOnly;
    }

    try {
      const walletBalances = await ctx.binance.getWalletBalances();

      const totalBalance = walletBalances
        .reduce((sum, w) => sum + parseFloat(w.balance), 0)
        .toFixed(8);

      return {
        wallets: walletBalances.map((w) => ({
          walletName: w.walletName,
          balance: w.balance,
          active: w.activate,
        })),
        totalBalance,
      };
    } catch (error) {
      return { error: `Failed to get wallet balances: ${(error as Error).message}` };
    }
  },
});

export const getDustLogTool = createTool({
  id: "get_dust_log",
  description:
    "Get history of dust conversions (small balances converted to BNB). " +
    "Use when user asks 'dust history', 'past dust conversions', 'BNB conversion log'.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(20)
      .default(10)
      .describe("Number of recent dust conversions to show"),
  }),
  outputSchema: z.object({
    total: z.number().optional(),
    conversions: z
      .array(
        z.object({
          time: z.string(),
          totalBnbReceived: z.string(),
          serviceFee: z.string(),
          assets: z.array(
            z.object({
              fromAsset: z.string(),
              amount: z.string(),
              bnbReceived: z.string(),
            })
          ),
        })
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId !== "binance") {
      return errors.binanceOnly;
    }

    try {
      const result = await ctx.binance.getDustLog();

      const dribblets = result.userAssetDribblets.slice(0, limit);

      return {
        total: result.total,
        conversions: dribblets.map((d) => ({
          time: new Date(d.operateTime).toISOString(),
          totalBnbReceived: d.totalTransferedAmount,
          serviceFee: d.totalServiceChargeAmount,
          assets: d.userAssetDribbletDetails.map((detail) => ({
            fromAsset: detail.fromAsset,
            amount: detail.amount,
            bnbReceived: detail.transferedAmount,
          })),
        })),
      };
    } catch (error) {
      return { error: `Failed to get dust log: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Withdrawal Tools
// ============================================================================

export const previewWithdrawalTool = createTool({
  id: "preview_withdrawal",
  description:
    "Preview a withdrawal to an external address (e.g., hardware wallet, another exchange). " +
    "Shows network fees, minimum amounts, estimated arrival time, and address validation. " +
    "Does NOT execute the withdrawal. Safe to call anytime. " +
    "Use when user asks 'how much to withdraw BTC', 'withdrawal fee for ETH', 'send USDT to my Ledger'.",
  inputSchema: z.object({
    coin: z.string().describe("Coin to withdraw (e.g., 'BTC', 'ETH', 'USDT')"),
    network: z
      .string()
      .default("")
      .describe("Network to use (e.g., 'ETH', 'TRX', 'BTC', 'BSC'). Empty to show all available networks."),
    address: z
      .string()
      .default("")
      .describe("Destination address to validate. Empty to skip validation."),
    amount: z
      .number()
      .positive()
      .optional()
      .describe("Amount to withdraw (optional, used to calculate net received after fees)"),
  }),
  outputSchema: z.object({
    coin: z.string().optional(),
    selectedNetwork: z
      .object({
        network: z.string(),
        name: z.string(),
        withdrawEnabled: z.boolean(),
        withdrawFee: z.number(),
        withdrawMin: z.number(),
        withdrawMax: z.number(),
        estimatedArrivalMins: z.number(),
      })
      .optional(),
    allNetworks: z
      .array(
        z.object({
          network: z.string(),
          name: z.string(),
          withdrawEnabled: z.boolean(),
          withdrawFee: z.number(),
          withdrawMin: z.number(),
          withdrawMax: z.number(),
          estimatedArrivalMins: z.number(),
        })
      )
      .optional(),
    amountPreview: z
      .object({
        grossAmount: z.number(),
        fee: z.number(),
        netReceived: z.number(),
        meetsMinimum: z.boolean(),
        withinMaximum: z.boolean(),
      })
      .optional(),
    addressValid: z.boolean().optional(),
    addressWarning: z.string().optional(),
    availableBalance: z.number().optional(),
    sufficientBalance: z.boolean().optional(),
    warning: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ coin, network, address, amount }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId !== "binance") {
      return errors.binanceOnly;
    }

    try {
      const coinUpper = coin.toUpperCase();
      const coinInfo = await ctx.binance.getCoinNetworks(coinUpper);
      if (!coinInfo) {
        return { error: `Coin ${coinUpper} not found on Binance.` };
      }

      const allNetworks = coinInfo.networkList.map((n) => ({
        network: n.network,
        name: n.name,
        withdrawEnabled: n.withdrawEnable,
        withdrawFee: parseFloat(n.withdrawFee),
        withdrawMin: parseFloat(n.withdrawMin),
        withdrawMax: parseFloat(n.withdrawMax),
        estimatedArrivalMins: n.estimatedArrivalTime,
      }));

      let selectedNetwork = undefined;
      if (network) {
        const networkUpper = network.toUpperCase();
        const found = coinInfo.networkList.find(
          (n) => n.network.toUpperCase() === networkUpper
        );
        if (!found) {
          return {
            error: `Network ${network} not available for ${coinUpper}. Available: ${allNetworks.map((n) => n.network).join(", ")}`,
            allNetworks,
          };
        }
        selectedNetwork = {
          network: found.network,
          name: found.name,
          withdrawEnabled: found.withdrawEnable,
          withdrawFee: parseFloat(found.withdrawFee),
          withdrawMin: parseFloat(found.withdrawMin),
          withdrawMax: parseFloat(found.withdrawMax),
          estimatedArrivalMins: found.estimatedArrivalTime,
        };
      }

      let addressValid: boolean | undefined = undefined;
      let addressWarning: string | undefined = undefined;
      if (address && network) {
        const net = coinInfo.networkList.find(
          (n) => n.network.toUpperCase() === network.toUpperCase()
        );
        if (net?.addressRegex) {
          try {
            const regex = new RegExp(net.addressRegex);
            addressValid = regex.test(address);
            if (!addressValid) {
              addressWarning = `Address does not match expected format for ${net.network} network. Double-check before proceeding.`;
            }
          } catch {
            addressValid = undefined;
            addressWarning = "Could not validate address format. Verify manually.";
          }
        }
      }

      let amountPreview = undefined;
      if (amount !== undefined && selectedNetwork) {
        const fee = selectedNetwork.withdrawFee;
        const netReceived = amount - fee;
        amountPreview = {
          grossAmount: amount,
          fee,
          netReceived: Math.max(0, netReceived),
          meetsMinimum: amount >= selectedNetwork.withdrawMin,
          withinMaximum: selectedNetwork.withdrawMax === 0 || amount <= selectedNetwork.withdrawMax,
        };
      }

      let availableBalance: number | undefined = undefined;
      let sufficientBalance: boolean | undefined = undefined;
      try {
        availableBalance = await ctx.binance.getBalance(coinUpper);
        if (amount !== undefined) {
          sufficientBalance = availableBalance >= amount;
        }
      } catch {
        // Non-critical
      }

      let warning: string | undefined = undefined;
      if (selectedNetwork && !selectedNetwork.withdrawEnabled) {
        warning = `Withdrawals are currently DISABLED for ${coinUpper} on the ${selectedNetwork.network} network.`;
      }

      return {
        coin: coinUpper,
        selectedNetwork,
        allNetworks: !network ? allNetworks : undefined,
        amountPreview,
        addressValid,
        addressWarning,
        availableBalance,
        sufficientBalance,
        warning,
      };
    } catch (error) {
      return { error: `Failed to preview withdrawal: ${(error as Error).message}` };
    }
  },
});

export const withdrawToExternalTool = createTool({
  id: "withdraw_to_external",
  description:
    "Execute a withdrawal to an external address (e.g., hardware wallet, another exchange). " +
    "REQUIRES ARMED MODE and explicit confirm=true. This sends real funds off the exchange. " +
    "ALWAYS call preview_withdrawal first to show the user fees and details. " +
    "Use when user confirms 'yes withdraw', 'send it', 'execute the withdrawal'.",
  inputSchema: z.object({
    coin: z.string().describe("Coin to withdraw (e.g., 'BTC', 'ETH', 'USDT')"),
    network: z.string().describe("Network to use (e.g., 'ETH', 'TRX', 'BTC', 'BSC')"),
    address: z.string().describe("Destination wallet address"),
    amount: z.number().positive().describe("Amount to withdraw"),
    tag: z
      .string()
      .default("")
      .describe("Address tag/memo (required for some coins like XRP, BNB on certain networks)"),
    confirm: z
      .boolean()
      .describe("Must be explicitly set to true to execute. If false, returns a final summary instead."),
  }),
  outputSchema: z.object({
    success: z.boolean().optional(),
    withdrawalId: z.string().optional(),
    coin: z.string().optional(),
    amount: z.number().optional(),
    network: z.string().optional(),
    address: z.string().optional(),
    fee: z.number().optional(),
    netReceived: z.number().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    confirmationRequired: z.boolean().optional(),
    summary: z
      .object({
        coin: z.string(),
        network: z.string(),
        address: z.string(),
        amount: z.number(),
        fee: z.number(),
        netReceived: z.number(),
        tag: z.string().optional(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { coin, network, address, amount, tag, confirm },
    execContext: MastraExecutionContext
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId !== "binance") {
      return errors.binanceOnly;
    }

    const coinUpper = coin.toUpperCase();

    // Fetch network info for fee calculation and validation
    let networkInfo;
    try {
      const coinInfo = await ctx.binance.getCoinNetworks(coinUpper);
      if (!coinInfo) {
        return { error: `Coin ${coinUpper} not found on Binance.` };
      }
      networkInfo = coinInfo.networkList.find(
        (n) => n.network.toUpperCase() === network.toUpperCase()
      );
      if (!networkInfo) {
        return {
          error: `Network ${network} not available for ${coinUpper}. Available: ${coinInfo.networkList.map((n) => n.network).join(", ")}`,
        };
      }
    } catch (error) {
      return { error: `Failed to fetch network info: ${(error as Error).message}` };
    }

    const fee = parseFloat(networkInfo.withdrawFee);
    const netReceived = amount - fee;
    const withdrawMin = parseFloat(networkInfo.withdrawMin);
    const withdrawMax = parseFloat(networkInfo.withdrawMax);

    // Validate
    if (!networkInfo.withdrawEnable) {
      return { error: `Withdrawals are currently DISABLED for ${coinUpper} on ${networkInfo.network}.` };
    }
    if (amount < withdrawMin) {
      return { error: `Amount ${amount} is below minimum withdrawal of ${withdrawMin} ${coinUpper} for ${networkInfo.network}.` };
    }
    if (withdrawMax > 0 && amount > withdrawMax) {
      return { error: `Amount ${amount} exceeds maximum withdrawal of ${withdrawMax} ${coinUpper} for ${networkInfo.network}.` };
    }
    if (netReceived <= 0) {
      return { error: `Amount ${amount} ${coinUpper} is less than or equal to the network fee (${fee}). Nothing would be received.` };
    }

    // Validate address format
    if (networkInfo.addressRegex) {
      try {
        const regex = new RegExp(networkInfo.addressRegex);
        if (!regex.test(address)) {
          return { error: `Address format is invalid for ${networkInfo.network} network. Please double-check the address.` };
        }
      } catch {
        // Skip if regex can't be parsed
      }
    }

    // Check tag/memo requirement
    if (networkInfo.memoRegex && networkInfo.memoRegex !== "^$") {
      if (!tag) {
        return {
          error: `A tag/memo is REQUIRED for ${coinUpper} on ${networkInfo.network}. Sending without it may result in PERMANENT LOSS OF FUNDS.`,
        };
      }
    }

    // If not confirmed, return summary for review
    if (!confirm) {
      return {
        confirmationRequired: true,
        message: "Withdrawal is ready. Review the summary below and call again with confirm=true to execute.",
        summary: {
          coin: coinUpper,
          network: networkInfo.network,
          address,
          amount,
          fee,
          netReceived,
          tag: tag || undefined,
        },
      };
    }

    // Check ARMED mode
    if (ctx.config?.mode !== "ARMED") {
      return {
        ...errors.notArmed("withdraw funds to an external address"),
        coin: coinUpper,
        amount,
        network: networkInfo.network,
        address,
      };
    }

    // Check balance
    try {
      const balance = await ctx.binance.getBalance(coinUpper);
      if (balance < amount) {
        return { error: `Insufficient balance. Available: ${balance} ${coinUpper}, requested: ${amount} ${coinUpper}.` };
      }
    } catch (error) {
      return { error: `Failed to check balance: ${(error as Error).message}` };
    }

    // Execute
    try {
      const result = await ctx.binance.withdraw(coinUpper, networkInfo.network, address, amount, tag || undefined);

      return {
        success: true,
        withdrawalId: result.id,
        coin: coinUpper,
        amount,
        network: networkInfo.network,
        address,
        fee,
        netReceived,
        status: "SUBMITTED",
        message: `Withdrawal submitted. ${amount} ${coinUpper} -> ${address} via ${networkInfo.network}. Fee: ${fee} ${coinUpper}. Estimated arrival: ~${networkInfo.estimatedArrivalTime} mins. Track with withdrawal ID: ${result.id}`,
      };
    } catch (error) {
      return { error: `Withdrawal failed: ${(error as Error).message}` };
    }
  },
});

export const getWithdrawalStatusTool = createTool({
  id: "get_withdrawal_status",
  description:
    "Check the status of recent withdrawals. " +
    "Use when user asks 'is my withdrawal done', 'withdrawal status', 'did my transfer go through'.",
  inputSchema: z.object({
    coin: z.string().default("").describe("Filter by coin (e.g., 'BTC'). Empty for all coins."),
    limit: z.number().min(1).max(100).default(10).describe("Number of recent withdrawals to show"),
  }),
  outputSchema: z.object({
    withdrawals: z
      .array(
        z.object({
          id: z.string(),
          coin: z.string(),
          network: z.string(),
          address: z.string(),
          amount: z.string(),
          fee: z.string(),
          status: z.string(),
          statusText: z.string(),
          txId: z.string().optional(),
          applyTime: z.string(),
          completeTime: z.string().optional(),
        })
      )
      .optional(),
    total: z.number().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ coin, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }
    if (!ctx.binance || ctx.exchange.exchangeId !== "binance") {
      return errors.binanceOnly;
    }

    const statusMap: Record<number, string> = {
      0: "Email Sent",
      1: "Cancelled",
      2: "Awaiting Approval",
      3: "Rejected",
      4: "Processing",
      5: "Failure",
      6: "Completed",
    };

    try {
      const history = await ctx.binance.getWithdrawalHistory(limit);
      let filtered = history;
      if (coin) {
        const coinUpper = coin.toUpperCase();
        filtered = history.filter((w) => w.coin.toUpperCase() === coinUpper);
      }

      if (filtered.length === 0) {
        return {
          message: coin ? `No recent withdrawals found for ${coin.toUpperCase()}.` : "No recent withdrawals found.",
          total: 0,
        };
      }

      return {
        total: filtered.length,
        withdrawals: filtered.map((w) => ({
          id: w.id,
          coin: w.coin,
          network: w.network,
          address: w.address,
          amount: String(w.amount),
          fee: String(w.transactionFee),
          status: String(w.status),
          statusText: statusMap[w.status] ?? `Unknown (${w.status})`,
          txId: w.txId || undefined,
          applyTime: w.applyTime,
          completeTime: w.completeTime || undefined,
        })),
      };
    } catch (error) {
      return { error: `Failed to get withdrawal history: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Wallet tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const walletTools = {
  get_dustable_assets: getDustableAssetsTool,
  convert_dust: convertDustTool,
  transfer_funds: transferFundsTool,
  get_coin_info: getCoinInfoTool,
  get_trade_fees: getTradeFeesTool,
  get_asset_dividends: getAssetDividendsTool,
  get_deposit_address: getDepositAddressTool,
  get_user_assets: getUserAssetsTool,
  get_wallet_balances: getWalletBalancesTool,
  get_dust_log: getDustLogTool,
  preview_withdrawal: previewWithdrawalTool,
  withdraw_to_external: withdrawToExternalTool,
  get_withdrawal_status: getWithdrawalStatusTool,
};
