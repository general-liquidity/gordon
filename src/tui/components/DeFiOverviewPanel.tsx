/**
 * DeFiOverviewPanel — Tabbed DeFi panel with 6 tabs
 *
 * Tabs: Chainlink, Uniswap, Yields, On-Chain, Solana, Polkadot.
 * Each tab renders a DataTable with placeholder data structure.
 *
 * Pattern: Claude Code tabbed context panel with inline data tables.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "../ink-custom";
import { Pane } from "../design-system/Pane.js";
import { Tabs } from "../design-system/Tabs.js";
import { DataTable, type Column } from "./DataTable.js";

// ============================================================================
// Types
// ============================================================================

export interface ChainlinkFeed {
  pair: string;
  price: number;
  deviation: number;
  heartbeat: string;
  status: "active" | "stale";
}

export interface UniswapPool {
  pool: string;
  tvl: number;
  apr: number;
  volume24h: number;
}

export interface YieldEntry {
  protocol: string;
  pool: string;
  tvl: number;
  apy: number;
}

export interface OnChainSignal {
  signal: string;
  chain: string;
  type: string;
  confidence: number;
}

export interface SolanaPosition {
  protocol: string;
  type: string;
  value: number;
  apy: number;
}

export interface PolkadotStaking {
  chain: string;
  staked: number;
  rewards: number;
  apy: number;
}

interface Props {
  chainlinkFeeds?: ChainlinkFeed[];
  uniswapPools?: UniswapPool[];
  yields?: YieldEntry[];
  onChainSignals?: OnChainSignal[];
  solanaPositions?: SolanaPosition[];
  polkadotStaking?: PolkadotStaking[];
  onClose: () => void;
}

// ============================================================================
// Tab config
// ============================================================================

const TABS = [
  { key: "chainlink", label: "Chainlink" },
  { key: "uniswap", label: "Uniswap" },
  { key: "yields", label: "Yields" },
  { key: "onchain", label: "On-Chain" },
  { key: "solana", label: "Solana" },
  { key: "polkadot", label: "Polkadot" },
];

// ============================================================================
// Column definitions
// ============================================================================

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(2);
}

const CHAINLINK_COLS: Column<ChainlinkFeed>[] = [
  { key: "pair", header: "PAIR", width: 14, format: (v) => String(v) },
  { key: "price", header: "PRICE", width: 12, align: "right", format: (v) => `$${Number(v).toFixed(2)}` },
  { key: "deviation", header: "DEVIATION", width: 12, align: "right", format: (v) => `${Number(v).toFixed(2)}%` },
  { key: "heartbeat", header: "HEARTBEAT", width: 12, format: (v) => String(v) },
  { key: "status", header: "STATUS", width: 10, format: (v) => String(v).toUpperCase(), color: (v) => (v === "active" ? "green" : "red") },
];

const UNISWAP_COLS: Column<UniswapPool>[] = [
  { key: "pool", header: "POOL", width: 16, format: (v) => String(v) },
  { key: "tvl", header: "TVL", width: 12, align: "right", format: (v) => `$${fmtNum(Number(v))}` },
  { key: "apr", header: "APR", width: 10, align: "right", format: (v) => `${Number(v).toFixed(1)}%`, color: (v) => (Number(v) >= 20 ? "green" : Number(v) >= 10 ? "yellow" : undefined) },
  { key: "volume24h", header: "VOL 24H", width: 12, align: "right", format: (v) => `$${fmtNum(Number(v))}` },
];

const YIELD_COLS: Column<YieldEntry>[] = [
  { key: "protocol", header: "PROTOCOL", width: 14, format: (v) => String(v) },
  { key: "pool", header: "POOL", width: 16, format: (v) => String(v) },
  { key: "tvl", header: "TVL", width: 12, align: "right", format: (v) => `$${fmtNum(Number(v))}` },
  { key: "apy", header: "APY", width: 10, align: "right", format: (v) => `${Number(v).toFixed(1)}%`, color: (v) => (Number(v) >= 20 ? "green" : Number(v) >= 10 ? "yellow" : Number(v) < 5 ? undefined : "yellow") },
];

const ONCHAIN_COLS: Column<OnChainSignal>[] = [
  { key: "signal", header: "SIGNAL", width: 20, format: (v) => String(v) },
  { key: "chain", header: "CHAIN", width: 12, format: (v) => String(v) },
  { key: "type", header: "TYPE", width: 12, format: (v) => String(v) },
  { key: "confidence", header: "CONF", width: 8, align: "right", format: (v) => `${Number(v)}%`, color: (v) => (Number(v) >= 80 ? "green" : Number(v) >= 50 ? "yellow" : "red") },
];

const SOLANA_COLS: Column<SolanaPosition>[] = [
  { key: "protocol", header: "PROTOCOL", width: 14, format: (v) => String(v) },
  { key: "type", header: "TYPE", width: 12, format: (v) => String(v) },
  { key: "value", header: "VALUE", width: 12, align: "right", format: (v) => `$${fmtNum(Number(v))}` },
  { key: "apy", header: "APY", width: 10, align: "right", format: (v) => `${Number(v).toFixed(1)}%`, color: (v) => (Number(v) >= 20 ? "green" : Number(v) >= 10 ? "yellow" : undefined) },
];

const POLKADOT_COLS: Column<PolkadotStaking>[] = [
  { key: "chain", header: "CHAIN", width: 14, format: (v) => String(v) },
  { key: "staked", header: "STAKED", width: 12, align: "right", format: (v) => `$${fmtNum(Number(v))}` },
  { key: "rewards", header: "REWARDS", width: 12, align: "right", format: (v) => `$${fmtNum(Number(v))}` },
  { key: "apy", header: "APY", width: 10, align: "right", format: (v) => `${Number(v).toFixed(1)}%`, color: (v) => (Number(v) >= 15 ? "green" : Number(v) >= 8 ? "yellow" : undefined) },
];

// ============================================================================
// Component
// ============================================================================

export function DeFiOverviewPanel({
  chainlinkFeeds = [],
  uniswapPools = [],
  yields = [],
  onChainSignals = [],
  solanaPositions = [],
  polkadotStaking = [],
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState("chainlink");

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
    }
  });

  function renderTabContent() {
    switch (activeTab) {
      case "chainlink":
        return (
          <DataTable
            columns={CHAINLINK_COLS as unknown as Column[]}
            data={chainlinkFeeds as unknown as Record<string, unknown>[]}
          />
        );
      case "uniswap":
        return (
          <DataTable
            columns={UNISWAP_COLS as unknown as Column[]}
            data={uniswapPools as unknown as Record<string, unknown>[]}
          />
        );
      case "yields":
        return (
          <DataTable
            columns={YIELD_COLS as unknown as Column[]}
            data={yields as unknown as Record<string, unknown>[]}
          />
        );
      case "onchain":
        return (
          <DataTable
            columns={ONCHAIN_COLS as unknown as Column[]}
            data={onChainSignals as unknown as Record<string, unknown>[]}
          />
        );
      case "solana":
        return (
          <DataTable
            columns={SOLANA_COLS as unknown as Column[]}
            data={solanaPositions as unknown as Record<string, unknown>[]}
          />
        );
      case "polkadot":
        return (
          <DataTable
            columns={POLKADOT_COLS as unknown as Column[]}
            data={polkadotStaking as unknown as Record<string, unknown>[]}
          />
        );
      default:
        return <Text dimColor>Select a tab</Text>;
    }
  }

  return (
    <Pane title="DEFI" color="magenta">
      <Tabs tabs={TABS} activeKey={activeTab} onChange={setActiveTab}>
        {renderTabContent()}
      </Tabs>
      <Text> </Text>
      <Text dimColor>
        {"\u2190\u2192"} switch tabs {"\u00b7"} Esc close
      </Text>
    </Pane>
  );
}
