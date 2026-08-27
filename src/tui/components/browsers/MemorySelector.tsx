/**
 * MemorySelector — Browse memory files grouped by type
 *
 * Lists all memory entries from MemoryProvider, grouped into four sections
 * (user, feedback, project, reference). Each entry shows name, type,
 * description, and last-modified timestamp. Selecting an entry displays
 * its full content.
 *
 * Phase 18 of the TUI rebuild plan.
 */

import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { useMemory, type MemoryType, type MemoryEntry } from "../../state/MemoryProvider.js";

// ============================================================================
// Group configuration
// ============================================================================

interface GroupConfig {
  type: MemoryType;
  label: string;
  color: string;
}

const GROUPS: GroupConfig[] = [
  { type: "user", label: "User Preferences", color: "cyan" },
  { type: "feedback", label: "Trade Learnings", color: "yellow" },
  { type: "project", label: "Active Strategies", color: "green" },
  { type: "reference", label: "Market Knowledge", color: "magenta" },
];

// ============================================================================
// Helpers
// ============================================================================

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return "";
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}\u2026`;
}

// ============================================================================
// Component
// ============================================================================

interface Props {
  /** Currently selected entry name (controlled externally, optional) */
  selected?: string;
  /** Called when user selects an entry */
  onSelect?: (entry: MemoryEntry) => void;
}

export function MemorySelector({ selected, onSelect }: Props) {
  const { memories, loading, error } = useMemory();
  const [viewingEntry, setViewingEntry] = useState<MemoryEntry | null>(null);
  const [cursor, setCursor] = useState(0);

  // Group memories by type
  const grouped = useMemo(() => {
    const map = new Map<MemoryType, MemoryEntry[]>();
    for (const group of GROUPS) {
      map.set(group.type, []);
    }
    for (const mem of memories) {
      const list = map.get(mem.type);
      if (list) list.push(mem);
    }
    return map;
  }, [memories]);

  const orderedEntries = useMemo(
    () => GROUPS.flatMap((group) => grouped.get(group.type) ?? []),
    [grouped],
  );

  useEffect(() => {
    if (!selected) return;
    const selectedIndex = orderedEntries.findIndex((entry) => entry.name === selected);
    if (selectedIndex >= 0) setCursor(selectedIndex);
  }, [orderedEntries, selected]);

  useInput((input, key) => {
    if (loading || error || orderedEntries.length === 0) return;
    if (viewingEntry) {
      if (key.escape || input === "q") setViewingEntry(null);
      return;
    }
    if (key.upArrow) setCursor((current) => Math.max(0, current - 1));
    if (key.downArrow) setCursor((current) => Math.min(orderedEntries.length - 1, current + 1));
    if (key.return) {
      const entry = orderedEntries[cursor];
      if (entry) {
        setViewingEntry(entry);
        onSelect?.(entry);
      }
    }
  });

  // ── Loading state ──
  if (loading) {
    return (
      <Box paddingLeft={2} paddingTop={1}>
        <Text dimColor>Loading memory files...</Text>
      </Box>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <Box paddingLeft={2} paddingTop={1}>
        <Text color="red">Memory error: {error}</Text>
      </Box>
    );
  }

  // ── Empty state ──
  if (memories.length === 0) {
    return (
      <Box paddingLeft={2} paddingTop={1}>
        <Text dimColor>No memory files found in ~/.gordon/memory/</Text>
      </Box>
    );
  }

  // ── Detail view ──
  if (viewingEntry) {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {viewingEntry.name}
          </Text>
          <Text dimColor>
            {" "}
            [{viewingEntry.type}] {formatDate(viewingEntry.lastModified)}
          </Text>
        </Box>
        {viewingEntry.description ? (
          <Box marginBottom={1}>
            <Text dimColor italic>
              {viewingEntry.description}
            </Text>
          </Box>
        ) : null}
        <Box flexDirection="column">
          {viewingEntry.content.split("\n").map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>(press Esc or q to go back)</Text>
        </Box>
      </Box>
    );
  }

  // ── Grouped list view ──
  return (
    <Box flexDirection="column" paddingLeft={2} paddingTop={1}>
      <Box marginBottom={1}>
        <Text bold>Memory Files</Text>
        <Text dimColor> ({memories.length} total)</Text>
      </Box>

      {GROUPS.map((group) => {
        const entries = grouped.get(group.type) ?? [];
        if (entries.length === 0) return null;

        return (
          <Box key={group.type} flexDirection="column" marginBottom={1}>
            {/* Section header */}
            <Box>
              <Text bold color={group.color}>
                {group.label}
              </Text>
              <Text dimColor> ({entries.length})</Text>
            </Box>

            {/* Entries */}
            {entries.map((entry) => {
              const isSelected = orderedEntries[cursor]?.name === entry.name;
              return (
                <Box key={entry.name} paddingLeft={2}>
                  <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                    {isSelected ? "\u25b6 " : "  "}
                    {truncate(entry.name, 30)}
                  </Text>
                  <Text dimColor>
                    {"  "}
                    {truncate(entry.description || "\u2014", 40)}
                    {"  "}
                    {formatDate(entry.lastModified)}
                  </Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
      <Text dimColor>↑↓ navigate · Enter open</Text>
    </Box>
  );
}
