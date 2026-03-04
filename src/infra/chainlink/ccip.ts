/**
 * Chainlink CCIP — Cross-Chain Interoperability Protocol
 *
 * Enables cross-chain token transfers between EVM chains using Chainlink's CCIP.
 * Flow: approve token → estimate fee → ccipSend → track message
 *
 * Uses ethers.js v6 (already installed) for contract interaction.
 * Required env var: EVM_PRIVATE_KEY (hex-encoded private key)
 */

import { Wallet, JsonRpcProvider, Contract, AbiCoder, parseUnits, formatUnits } from "ethers";

import {
  CHAINLINK_ENV_KEYS,
  CCIP_CHAINS,
  ERC20_APPROVE_ABI,
  CCIP_ROUTER_ABI,
  getRpcUrl,
  type CCIPChainConfig,
  type CCIPFeeResult,
  type CCIPTransferResult,
} from "./types.ts";

// ============================================================================
// Configuration Check
// ============================================================================

/**
 * Check if CCIP is configured (EVM_PRIVATE_KEY present)
 */
export function isCCIPConfigured(): boolean {
  return Boolean(process.env[CHAINLINK_ENV_KEYS.EVM_PRIVATE_KEY]);
}

// ============================================================================
// Wallet & Provider Helpers
// ============================================================================

/**
 * Get an ethers Wallet connected to a specific chain
 */
function getWallet(chainName: string): Wallet {
  const privateKey = process.env[CHAINLINK_ENV_KEYS.EVM_PRIVATE_KEY];
  if (!privateKey) {
    throw new Error("CCIP not configured. Set EVM_PRIVATE_KEY environment variable.");
  }

  const rpcUrl = getRpcUrl(chainName);
  const provider = new JsonRpcProvider(rpcUrl);

  // Handle both with and without 0x prefix
  const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return new Wallet(key, provider);
}

/**
 * Get chain config, throwing a clear error if not found
 */
function getChainConfig(chainName: string): CCIPChainConfig {
  const config = CCIP_CHAINS[chainName.toLowerCase()];
  if (!config) {
    throw new Error(
      `Chain "${chainName}" not supported for CCIP. ` +
      `Supported: ${Object.keys(CCIP_CHAINS).join(", ")}`
    );
  }
  return config;
}

// ============================================================================
// CCIP Message Building
// ============================================================================

/**
 * Build a CCIP EVM2AnyMessage struct for a token transfer
 *
 * @param recipient - Recipient address on destination chain
 * @param tokenAddress - Token contract address on source chain
 * @param amount - Token amount in wei (bigint)
 * @param feeToken - Address of token to pay fees with (address(0) for native)
 */
function buildCCIPMessage(
  recipient: string,
  tokenAddress: string,
  amount: bigint,
  feeToken: string,
): {
  receiver: string;
  data: string;
  tokenAmounts: Array<{ token: string; amount: bigint }>;
  feeToken: string;
  extraArgs: string;
} {
  const abiCoder = AbiCoder.defaultAbiCoder();

  // Encode recipient address as bytes
  const receiver = abiCoder.encode(["address"], [recipient]);

  // extraArgs: encode gasLimit for destination chain execution
  // V1 tag (0x97a657c9) + encoded gasLimit (200000 is sufficient for token transfers)
  const extraArgs =
    "0x97a657c9" +
    abiCoder.encode(["uint256"], [200_000n]).slice(2);

  return {
    receiver,
    data: "0x", // No additional data for simple token transfers
    tokenAmounts: [{ token: tokenAddress, amount }],
    feeToken,
    extraArgs,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get all CCIP-supported chains and their available tokens
 */
export function getSupportedChains(): Array<{
  chain: string;
  selector: string;
  tokens: string[];
}> {
  return Object.entries(CCIP_CHAINS).map(([chain, config]) => ({
    chain,
    selector: config.selector,
    tokens: Object.keys(config.supportedTokens),
  }));
}

/**
 * Estimate the CCIP transfer fee
 *
 * @param sourceChain - Source chain name (e.g., "ethereum")
 * @param destChain - Destination chain name (e.g., "arbitrum")
 * @param tokenSymbol - Token symbol (e.g., "USDC", "LINK", "WETH")
 * @param amount - Human-readable amount (e.g., "100.5")
 * @param recipient - Recipient address on destination chain
 * @param decimals - Token decimals (default 18, USDC uses 6)
 */
export async function getCCIPFee(
  sourceChain: string,
  destChain: string,
  tokenSymbol: string,
  amount: string,
  recipient: string,
  decimals: number = 18,
): Promise<CCIPFeeResult> {
  const sourceConfig = getChainConfig(sourceChain);
  const destConfig = getChainConfig(destChain);

  const tokenAddress = sourceConfig.supportedTokens[tokenSymbol.toUpperCase()];
  if (!tokenAddress) {
    throw new Error(
      `Token "${tokenSymbol}" not supported on ${sourceChain} for CCIP. ` +
      `Available: ${Object.keys(sourceConfig.supportedTokens).join(", ")}`
    );
  }

  const wallet = getWallet(sourceChain);
  const router = new Contract(sourceConfig.router, CCIP_ROUTER_ABI, wallet);

  const amountWei = parseUnits(amount, decimals);

  // Build message with LINK as fee token
  const linkFeeMessage = buildCCIPMessage(
    recipient,
    tokenAddress,
    amountWei,
    sourceConfig.linkToken,
  );

  // Build message with native token as fee token (address(0))
  const nativeFeeMessage = buildCCIPMessage(
    recipient,
    tokenAddress,
    amountWei,
    "0x0000000000000000000000000000000000000000",
  );

  // Get fees in both LINK and native
  const getFee = router.getFunction("getFee");
  const [feeInLink, feeInNative] = await Promise.all([
    getFee(destConfig.selector, linkFeeMessage) as Promise<bigint>,
    getFee(destConfig.selector, nativeFeeMessage) as Promise<bigint>,
  ]);

  return {
    sourceChain,
    destChain,
    token: tokenSymbol,
    amount,
    feeInLink: formatUnits(feeInLink, 18),
    feeInNative: formatUnits(feeInNative, 18),
  };
}

/**
 * Execute a CCIP cross-chain token transfer
 *
 * Flow: 1) Approve router to spend tokens → 2) Get fee → 3) ccipSend
 *
 * @param sourceChain - Source chain name
 * @param destChain - Destination chain name
 * @param tokenSymbol - Token symbol (e.g., "USDC")
 * @param amount - Human-readable amount
 * @param recipient - Recipient address on destination chain
 * @param payFeesInLink - Pay fees in LINK (true) or native token (false, default)
 * @param decimals - Token decimals (default 18)
 */
export async function executeCCIPTransfer(
  sourceChain: string,
  destChain: string,
  tokenSymbol: string,
  amount: string,
  recipient: string,
  payFeesInLink: boolean = false,
  decimals: number = 18,
): Promise<CCIPTransferResult> {
  if (!isCCIPConfigured()) {
    throw new Error("CCIP not configured. Set EVM_PRIVATE_KEY environment variable.");
  }

  const sourceConfig = getChainConfig(sourceChain);
  const destConfig = getChainConfig(destChain);

  const tokenAddress = sourceConfig.supportedTokens[tokenSymbol.toUpperCase()];
  if (!tokenAddress) {
    throw new Error(
      `Token "${tokenSymbol}" not supported on ${sourceChain} for CCIP. ` +
      `Available: ${Object.keys(sourceConfig.supportedTokens).join(", ")}`
    );
  }

  const wallet = getWallet(sourceChain);
  const amountWei = parseUnits(amount, decimals);

  // 1. Approve the router to spend the token
  const tokenContract = new Contract(tokenAddress, ERC20_APPROVE_ABI, wallet);
  const tokenApprove = tokenContract.getFunction("approve");
  const approveTx = await tokenApprove(sourceConfig.router, amountWei);
  await approveTx.wait();

  // 2. Build the CCIP message
  const feeToken = payFeesInLink
    ? sourceConfig.linkToken
    : "0x0000000000000000000000000000000000000000";

  const message = buildCCIPMessage(recipient, tokenAddress, amountWei, feeToken);

  // 3. Get the fee
  const router = new Contract(sourceConfig.router, CCIP_ROUTER_ABI, wallet);
  const routerGetFee = router.getFunction("getFee");
  const fee = await routerGetFee(destConfig.selector, message) as bigint;

  // 4. If paying in LINK, approve LINK for fee. If native, send as msg.value.
  if (payFeesInLink) {
    const linkContract = new Contract(sourceConfig.linkToken, ERC20_APPROVE_ABI, wallet);
    const linkApprove = linkContract.getFunction("approve");
    const linkApproveTx = await linkApprove(sourceConfig.router, fee);
    await linkApproveTx.wait();
  }

  // 5. Send the CCIP message
  const ccipSend = router.getFunction("ccipSend");
  const tx = await ccipSend(destConfig.selector, message, {
    value: payFeesInLink ? 0n : fee,
  });
  const receipt = await tx.wait();

  // 6. Extract messageId from the CCIPSendRequested event log
  // The messageId is the first topic of the CCIPSendRequested event
  const messageId = receipt?.logs?.[receipt.logs.length - 1]?.topics?.[1] ?? "unknown";

  return {
    txHash: receipt?.hash ?? tx.hash,
    messageId,
    sourceChain,
    destChain,
    token: tokenSymbol,
    amount,
    recipient,
  };
}

/**
 * Check CCIP transfer status via the CCIP Explorer API
 *
 * @param messageId - The CCIP message ID from executeCCIPTransfer
 */
export async function getCCIPStatus(
  messageId: string,
): Promise<{
  messageId: string;
  status: string;
  sourceChain: string;
  destChain: string;
  timestamp: number | null;
}> {
  // CCIP Explorer API
  const url = `https://ccip.chain.link/api/h/atlas/message/${messageId}`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return {
        messageId,
        status: "pending",
        sourceChain: "unknown",
        destChain: "unknown",
        timestamp: null,
      };
    }
    throw new Error(`CCIP Explorer error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as Record<string, unknown>;

  return {
    messageId,
    status: String(data.state || data.status || "unknown"),
    sourceChain: String(data.sourceChainName || data.sourceNetwork || "unknown"),
    destChain: String(data.destChainName || data.destNetwork || "unknown"),
    timestamp: data.timestamp ? Number(data.timestamp) : null,
  };
}
