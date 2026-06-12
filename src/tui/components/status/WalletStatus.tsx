/**
 * WalletStatus — Connected wallet balances
 *
 * Shows chain badge, truncated address, total USD, and token breakdown
 * for each connected wallet.
 *
 * Pattern: Claude Code context panel with grouped key-value data.
 */

import React from "react";
import { Box, Text } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

// ============================================================================
// Types
// ============================================================================

export interface TokenBalance {
  symbol: string;
  amount: number;
  valueUSD: number;
}

export interface WalletInfo {
  chain: string;
  address: string;
  balances: TokenBalance[];
  totalUSD: number;
}

interface Props {
  wallets: WalletInfo[];
}

// ============================================================================
// Helpers
// ============================================================================

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function chainColor(chain: string): string {
  const lower = chain.toLowerCase();
  if (lower.includes("eth")) return "blue";
  if (lower.includes("sol")) return "magenta";
  if (lower.includes("dot") || lower.includes("polka")) return "red";
  if (lower.includes("bsc") || lower.includes("bnb")) return "yellow";
  if (lower.includes("avax")) return "red";
  if (lower.includes("arb")) return "cyan";
  return "white";
}

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtAmount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

// ============================================================================
// Component
// ============================================================================

export function WalletStatus({ wallets }: Props) {
  if (wallets.length === 0) {
    return (
      <Pane title="WALLETS">
        <Text dimColor>No wallets connected.</Text>
      </Pane>
    );
  }

  const totalAll = wallets.reduce((sum, w) => sum + w.totalUSD, 0);

  return (
    <Pane title="WALLETS">
      {wallets.map((wallet, i) => (
        <Box key={`${wallet.chain}-${wallet.address}`} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
          {/* Wallet header */}
          <Box>
            <Text bold color={chainColor(wallet.chain)}>
              {wallet.chain.toUpperCase()}
            </Text>
            <Text dimColor> {"\u00b7"} </Text>
            <Text dimColor>{truncateAddress(wallet.address)}</Text>
            <Text dimColor> {"\u00b7"} </Text>
            <Text bold>{fmtUSD(wallet.totalUSD)}</Text>
          </Box>

          {/* Token breakdown */}
          {wallet.balances.map((token) => (
            <Box key={token.symbol} paddingLeft={4}>
              <Box width={10}>
                <Text>{token.symbol}</Text>
              </Box>
              <Box width={16}>
                <Text dimColor>{fmtAmount(token.amount)}</Text>
              </Box>
              <Text>{fmtUSD(token.valueUSD)}</Text>
            </Box>
          ))}
        </Box>
      ))}

      {/* Total */}
      {wallets.length > 1 && (
        <Box marginTop={1}>
          <Text dimColor>{"\u2500".repeat(40)}</Text>
        </Box>
      )}
      {wallets.length > 1 && (
        <Box>
          <Text bold>TOTAL</Text>
          <Text dimColor> {"\u00b7"} </Text>
          <Text bold>{fmtUSD(totalAll)}</Text>
        </Box>
      )}
    </Pane>
  );
}
