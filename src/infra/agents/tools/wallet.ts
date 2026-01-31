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
  noBinance: { error: "Binance client not connected. Please run setup first." },
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
    if (!ctx?.binance) {
      return errors.noBinance;
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
    if (!ctx?.binance) {
      return errors.noBinance;
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
    if (!ctx?.binance) {
      return errors.noBinance;
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
    if (!ctx?.binance) {
      return errors.noBinance;
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
    if (!ctx?.binance) {
      return errors.noBinance;
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
    if (!ctx?.binance) {
      return errors.noBinance;
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
    if (!ctx?.binance) {
      return errors.noBinance;
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
};
