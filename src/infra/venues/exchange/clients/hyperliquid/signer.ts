/**
 * Hyperliquid Wallet Signer
 * Handles EIP-712 typed data signing for Hyperliquid API authentication
 *
 * Requires: ethers.js (bun add ethers)
 */

import { Wallet } from "ethers";
import type { TypedDataDomain, TypedDataField } from "ethers";
import { InvalidWalletError, WalletSigningError } from "../../../../../errors/index.ts";
import { createModuleLogger } from "../../../../logger/index.ts";

const logger = createModuleLogger("hyperliquid-signer");

/**
 * Hyperliquid EIP-712 domain
 */
export const HYPERLIQUID_DOMAIN: TypedDataDomain = {
  name: "Exchange",
  version: "1",
  chainId: 42161, // Arbitrum One
  verifyingContract: "0x0000000000000000000000000000000000000000",
};

/**
 * EIP-712 types for Hyperliquid actions
 */
export const HYPERLIQUID_TYPES: Record<string, TypedDataField[]> = {
  // Agent type for general actions
  Agent: [
    { name: "source", type: "string" },
    { name: "connectionId", type: "bytes32" },
  ],
  // Order placement
  Order: [
    { name: "asset", type: "uint32" },
    { name: "isBuy", type: "bool" },
    { name: "limitPx", type: "uint64" },
    { name: "sz", type: "uint64" },
    { name: "reduceOnly", type: "bool" },
    { name: "cloid", type: "bytes16" },
  ],
  // Bulk order placement
  BulkOrder: [
    { name: "orders", type: "Order[]" },
    { name: "grouping", type: "string" },
  ],
  // Cancel order
  Cancel: [
    { name: "asset", type: "uint32" },
    { name: "oid", type: "uint64" },
  ],
  // Bulk cancel
  BulkCancel: [
    { name: "cancels", type: "Cancel[]" },
  ],
  // Withdraw
  Withdraw: [
    { name: "destination", type: "string" },
    { name: "amount", type: "string" },
    { name: "time", type: "uint64" },
  ],
  // Update leverage
  UpdateLeverage: [
    { name: "asset", type: "uint32" },
    { name: "isCross", type: "bool" },
    { name: "leverage", type: "uint32" },
  ],
  // Transfer
  UsdTransfer: [
    { name: "destination", type: "string" },
    { name: "amount", type: "string" },
    { name: "time", type: "uint64" },
  ],
};

/**
 * Hyperliquid Signer
 * Manages wallet signing for API authentication
 */
export class HyperliquidSigner {
  private wallet: Wallet;
  private _address: string;

  constructor(privateKey: string) {
    try {
      // Ensure private key has 0x prefix
      const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
      this.wallet = new Wallet(normalizedKey);
      this._address = this.wallet.address;
      logger.info("Wallet initialized", { address: this._address });
    } catch (error) {
      logger.error("Failed to initialize wallet", error instanceof Error ? error : undefined);
      throw new InvalidWalletError(
        `Invalid private key format: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  /**
   * Get the wallet address
   */
  get address(): string {
    return this._address;
  }

  /**
   * Sign typed data using EIP-712
   */
  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string> {
    try {
      const signature = await this.wallet.signTypedData(domain, types, value);
      return signature;
    } catch (error) {
      logger.error("Failed to sign typed data", error instanceof Error ? error : undefined);
      throw new WalletSigningError(
        `Failed to sign transaction: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  /**
   * Sign a Hyperliquid action
   */
  async signAction(
    action: Record<string, unknown>,
    timestamp: number,
    vaultAddress?: string
  ): Promise<{
    r: string;
    s: string;
    v: number;
  }> {
    const types = {
      HyperliquidTransaction: [
        { name: "action", type: "string" },
        { name: "nonce", type: "uint64" },
        { name: "vaultAddress", type: "address" },
      ],
    };

    const value = {
      action: JSON.stringify(action),
      nonce: timestamp,
      vaultAddress: vaultAddress || "0x0000000000000000000000000000000000000000",
    };

    try {
      const signature = await this.signTypedData(HYPERLIQUID_DOMAIN, types, value);

      // Parse signature into r, s, v components
      const sig = signature.slice(2); // Remove 0x prefix
      const r = "0x" + sig.slice(0, 64);
      const s = "0x" + sig.slice(64, 128);
      const v = parseInt(sig.slice(128, 130), 16);

      return { r, s, v };
    } catch (error) {
      if (error instanceof WalletSigningError) {
        throw error;
      }
      throw new WalletSigningError(
        `Failed to sign action: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  /**
   * Sign an L1 action (for deposits/withdrawals)
   */
  async signL1Action(
    action: Record<string, unknown>,
    activePool: string | null,
    nonce: number
  ): Promise<{
    r: string;
    s: string;
    v: number;
  }> {
    // L1 actions use a different signing scheme
    const phantomAgent = {
      source: activePool === null ? "a" : "b", // a = main, b = vault
      connectionId: this.hashAction(action, nonce),
    };

    try {
      const agentType = HYPERLIQUID_TYPES.Agent;
      if (!agentType) {
        throw new Error("Agent type not defined in HYPERLIQUID_TYPES");
      }
      const signature = await this.signTypedData(
        HYPERLIQUID_DOMAIN,
        { Agent: agentType },
        phantomAgent
      );

      // Parse signature
      const sig = signature.slice(2);
      const r = "0x" + sig.slice(0, 64);
      const s = "0x" + sig.slice(64, 128);
      const v = parseInt(sig.slice(128, 130), 16);

      return { r, s, v };
    } catch (error) {
      if (error instanceof WalletSigningError) {
        throw error;
      }
      throw new WalletSigningError(
        `Failed to sign L1 action: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  /**
   * Hash an action for signing
   */
  private hashAction(action: Record<string, unknown>, nonce: number): string {
    // Create a deterministic hash of the action
    const actionStr = JSON.stringify(action) + nonce.toString();
    // Simple hash - in production this should use proper keccak256
    let hash = 0n;
    for (let i = 0; i < actionStr.length; i++) {
      const char = BigInt(actionStr.charCodeAt(i));
      hash = ((hash << 5n) - hash) + char;
      hash = hash & 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;
    }
    return "0x" + hash.toString(16).padStart(64, "0");
  }

  /**
   * Get a unique nonce (timestamp in milliseconds)
   */
  getNonce(): number {
    return Date.now();
  }
}
