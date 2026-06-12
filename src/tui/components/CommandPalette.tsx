import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "../ink-custom";
import {
  PALETTE_WORKFLOW_CONFIG,
  type PaletteWorkflowId,
} from "../../app/slash/commandUx.ts";
import type { GordonTheme } from "../themes/themes.ts";
import { useTheme } from "../themes/ThemeProvider.tsx";
import { fuzzyMatch } from "../utils/fuzzy.ts";

export interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  category?: string;
  workflowId?: PaletteWorkflowId;
  keyHint?: string;
}

export interface PaletteWorkspaceSection {
  label: string;
  items: PaletteItem[];
  colorToken?: keyof GordonTheme;
}

interface Props {
  items: PaletteItem[];
  onSelect: (item: PaletteItem) => void;
  onClose: () => void;
  workspaceSection?: PaletteWorkspaceSection;
}

export function groupPaletteItems(
  items: PaletteItem[],
  query: string,
): Array<{ group: PaletteWorkflowId; items: PaletteItem[] }> {
  const trimmed = query.trim();
  const scored = items
    .map((item, index) => {
      if (!trimmed) {
        const group = item.workflowId ?? "system";
        const config = PALETTE_WORKFLOW_CONFIG[group];
        return { item, index, group, score: 1_000 - config.order * 10 - index / 1000 };
      }
      const match =
        fuzzyMatch(trimmed, item.label) ??
        fuzzyMatch(trimmed, item.description ?? "") ??
        fuzzyMatch(trimmed, item.category ?? "");
      if (!match) return null;
      return { item, index, group: item.workflowId ?? "system", score: match.score };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 15);

  const byGroup = new Map<PaletteWorkflowId, PaletteItem[]>();
  for (const entry of scored) {
    const group = entry.group;
    const list = byGroup.get(group) ?? [];
    if (!trimmed && list.length >= 3) continue;
    list.push(entry.item);
    byGroup.set(group, list);
  }

  return (Object.keys(PALETTE_WORKFLOW_CONFIG) as PaletteWorkflowId[])
    .sort((a, b) => PALETTE_WORKFLOW_CONFIG[a].order - PALETTE_WORKFLOW_CONFIG[b].order)
    .map((group) => ({ group, items: byGroup.get(group) ?? [] }))
    .filter((entry) => entry.items.length > 0);
}

export function CommandPalette({ items, onSelect, onClose, workspaceSection }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const grouped = useMemo(() => groupPaletteItems(items, query), [items, query]);
  const showWorkspace = query.trim() === "" && workspaceSection && workspaceSection.items.length > 0;
  const flat = useMemo(
    () => [
      ...(showWorkspace ? workspaceSection!.items : []),
      ...grouped.flatMap((group) => group.items),
    ],
    [grouped, showWorkspace, workspaceSection],
  );
  const totalShown = flat.length;

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(Math.max(0, totalShown - 1), i + 1));
      return;
    }
    if (key.return) {
      const item = flat[selectedIndex];
      if (item) onSelect(item);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setSelectedIndex(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setSelectedIndex(0);
    }
  });

  let cursor = 0;
  const renderRow = (item: PaletteItem, color: string): React.ReactElement => {
    const selected = cursor === selectedIndex;
    cursor += 1;
    return (
      <Box key={item.id} paddingX={1}>
        <Text color={selected ? theme.uiFocus : undefined}>{selected ? "▸ " : "  "}</Text>
        <Text bold={selected}>{item.label}</Text>
        {item.description && (
          <>
            <Text> </Text>
            <Text dimColor>{clip(item.description, item.keyHint ? 34 : 44)}</Text>
          </>
        )}
        {item.keyHint && (
          <>
            <Text dimColor> </Text>
            <Text color={selected ? color : theme.uiMuted}>{item.keyHint}</Text>
          </>
        )}
      </Box>
    );
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.uiBorder}
      paddingX={1}
      paddingY={0}
      width={64}
    >
      <Box>
        <Text color={theme.uiFocus}>▶ </Text>
        <Text>{query || <Text dimColor>Search commands...</Text>}</Text>
        <Text color={theme.uiFocus}>█</Text>
      </Box>

      {showWorkspace && (
        <>
          <Box marginTop={1}>
            <Text color={theme[workspaceSection!.colorToken ?? "uiBrand"]} bold>{workspaceSection!.label}</Text>
          </Box>
          {workspaceSection!.items.map((item) => renderRow(item, theme[workspaceSection!.colorToken ?? "uiBrand"]))}
        </>
      )}

      {grouped.map(({ group, items: groupItems }) => {
        const config = PALETTE_WORKFLOW_CONFIG[group];
        const color = theme[config.colorToken];
        return (
          <React.Fragment key={group}>
            <Box marginTop={1}>
              <Text color={color} bold>{config.icon} {config.label}</Text>
            </Box>
            {groupItems.map((item) => renderRow(item, color))}
          </React.Fragment>
        );
      })}

      {totalShown === 0 && (
        <Box paddingX={1}>
          <Text dimColor>No results for "{query}"</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>{totalShown} of {items.length} · ↑↓ navigate · Enter run · Esc close</Text>
      </Box>
    </Box>
  );
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
