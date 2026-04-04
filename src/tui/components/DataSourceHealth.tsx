/**
 * DataSourceHealth — Data pipeline health
 *
 * Shows each data source with name, type badge, status icon,
 * latency, cache hit rate bar, and last update time.
 *
 * Pattern: Claude Code health dashboard with service status indicators.
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import { Pane } from "../design-system/Pane.js";
import { ProgressBar } from "../design-system/ProgressBar.js";

// ============================================================================
// Types
// ============================================================================

export type DataSourceType = "exchange" | "broker";

export type DataSourceStatus = "live" | "degraded" | "disconnected";

export interface DataSourceInfo {
  name: string;
  type: DataSourceType;
  status: DataSourceStatus;
  latencyMs: number;
  cacheHitRate: number;
  lastUpdateAt: string;
}

interface Props {
  sources: DataSourceInfo[];
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function statusConfig(status: DataSourceStatus): { icon: string; color: string } {
  if (status === "live") return { icon: "\u25CF", color: "green" };
  if (status === "degraded") return { icon: "\u25C8", color: "yellow" };
  return { icon: "\u2717", color: "red" };
}

function typeColor(type: DataSourceType): string {
  return type === "exchange" ? "cyan" : "magenta";
}

function latencyColor(ms: number): string {
  if (ms < 100) return "green";
  if (ms < 500) return "yellow";
  return "red";
}

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return "\u2014";
  }
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Component
// ============================================================================

export function DataSourceHealth({ sources, onClose }: Props) {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  const liveCount = sources.filter((s) => s.status === "live").length;
  const degradedCount = sources.filter((s) => s.status === "degraded").length;
  const downCount = sources.filter((s) => s.status === "disconnected").length;

  return (
    <Pane title="DATA SOURCES" color="cyan">
      {/* Summary */}
      <Box>
        <Text color="green">{liveCount} live</Text>
        {degradedCount > 0 && (
          <>
            <Text dimColor> {"\u00b7"} </Text>
            <Text color="yellow">{degradedCount} degraded</Text>
          </>
        )}
        {downCount > 0 && (
          <>
            <Text dimColor> {"\u00b7"} </Text>
            <Text color="red">{downCount} down</Text>
          </>
        )}
      </Box>
      <Text> </Text>

      {/* Column headers */}
      <Box paddingLeft={2}>
        <Box width={16}><Text bold dimColor>SOURCE</Text></Box>
        <Box width={10}><Text bold dimColor>TYPE</Text></Box>
        <Box width={6}><Text bold dimColor>STATUS</Text></Box>
        <Box width={10}><Text bold dimColor>LATENCY</Text></Box>
        <Box width={16}><Text bold dimColor>CACHE HIT</Text></Box>
        <Box width={10}><Text bold dimColor>UPDATED</Text></Box>
      </Box>

      {/* Source rows */}
      {sources.map((source) => {
        const st = statusConfig(source.status);
        const cacheColor = source.cacheHitRate >= 0.9 ? "green" : source.cacheHitRate >= 0.7 ? "yellow" : "red";

        return (
          <Box key={source.name} paddingLeft={2}>
            <Box width={16}>
              <Text bold>{padRight(source.name, 16)}</Text>
            </Box>
            <Box width={10}>
              <Text color={typeColor(source.type)}>
                {padRight(source.type.toUpperCase(), 10)}
              </Text>
            </Box>
            <Box width={6}>
              <Text color={st.color}>{st.icon}</Text>
            </Box>
            <Box width={10}>
              <Text color={latencyColor(source.latencyMs)}>
                {source.status !== "disconnected" ? `${source.latencyMs}ms` : "\u2014"}
              </Text>
            </Box>
            <Box width={16}>
              <ProgressBar value={source.cacheHitRate} width={8} fillColor={cacheColor} />
              <Text dimColor> {(source.cacheHitRate * 100).toFixed(0)}%</Text>
            </Box>
            <Box width={10}>
              <Text dimColor>{timeAgo(source.lastUpdateAt)}</Text>
            </Box>
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}
