/**
 * DeFiOverviewPanel — read-only onchain market data
 *
 * Tabs: Pools (DexScreener), Yields (DefiLlama), Signals (onchain adapter).
 * Execution venues and chain-specific protocol kits were removed — Gordon
 * routes crypto trades through CCXT; onchain reads go through data adapters.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";
import { Tabs } from "../../design-system/Tabs.js";
import { DataTable, type Column } from "../charts/DataTable.tsx";

export interface DexPoolRow {
  pool: string;
  chain: string;
  tvl: number;
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

interface Props {
  pools?: DexPoolRow[];
  yields?: YieldEntry[];
  onChainSignals?: OnChainSignal[];
  onClose: () => void;
}

const TABS = [
  { key: "pools", label: "Pools" },
  { key: "yields", label: "Yields" },
  { key: "onchain", label: "Signals" },
];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(2);
}

const POOL_COLS: Column<DexPoolRow>[] = [
  { key: "pool", header: "POOL", width: 16, format: (v) => String(v) },
  { key: "chain", header: "CHAIN", width: 12, format: (v) => String(v) },
  { key: "tvl", header: "TVL", width: 12, align: "right", format: (v) => `$${fmtNum(Number(v))}` },
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

export function DeFiOverviewPanel({
  pools = [],
  yields = [],
  onChainSignals = [],
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState("pools");

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
    }
  });

  function renderTabContent() {
    switch (activeTab) {
      case "pools":
        return (
          <DataTable
            columns={POOL_COLS as unknown as Column[]}
            data={pools as unknown as Record<string, unknown>[]}
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
      default:
        return <Text color="gray">No data for this tab.</Text>;
    }
  }

  return (
    <Pane title="ONCHAIN DATA">
      <Tabs tabs={TABS} activeKey={activeTab} onChange={setActiveTab}>
        <Box marginTop={1}>{renderTabContent()}</Box>
      </Tabs>
    </Pane>
  );
}
