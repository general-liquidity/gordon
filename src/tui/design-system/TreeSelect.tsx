import React, { useState } from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// TreeSelect — Hierarchical expand/collapse selection
//
// ▾ Exchange
//   ▸ Binance
//     BTC/USDT
//     ETH/USDT
//   ▸ Coinbase
// ============================================================================

export interface TreeNode { id: string; label: string; children?: TreeNode[]; }

interface Props { tree: TreeNode[]; onSelect: (node: TreeNode) => void; onClose: () => void; }

interface FlatNode { node: TreeNode; depth: number; hasChildren: boolean; expanded: boolean; path: string; }

function flatten(nodes: TreeNode[], expandedSet: Set<string>, depth = 0, parentPath = ""): FlatNode[] {
  const result: FlatNode[] = [];
  for (const node of nodes) {
    const path = parentPath ? `${parentPath}/${node.id}` : node.id;
    const hasChildren = !!(node.children && node.children.length > 0);
    const expanded = expandedSet.has(path);
    result.push({ node, depth, hasChildren, expanded, path });
    if (hasChildren && expanded) {
      result.push(...flatten(node.children!, expandedSet, depth + 1, path));
    }
  }
  return result;
}

export function TreeSelect({ tree, onSelect, onClose }: Props) {
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const flat = flatten(tree, expandedSet);

  useInput((_, key) => {
    if (key.escape) onClose();
    else if (key.upArrow) setCursor((p) => Math.max(0, p - 1));
    else if (key.downArrow) setCursor((p) => Math.min(flat.length - 1, p + 1));
    else if (key.rightArrow) {
      const item = flat[cursor];
      if (item?.hasChildren && !item.expanded) {
        setExpandedSet((prev) => new Set([...prev, item.path]));
      }
    } else if (key.leftArrow) {
      const item = flat[cursor];
      if (item?.hasChildren && item.expanded) {
        setExpandedSet((prev) => { const s = new Set(prev); s.delete(item.path); return s; });
      }
    } else if (key.return) {
      const item = flat[cursor];
      if (item) {
        if (item.hasChildren) {
          setExpandedSet((prev) => {
            const s = new Set(prev);
            if (s.has(item.path)) s.delete(item.path); else s.add(item.path);
            return s;
          });
        } else {
          onSelect(item.node);
        }
      }
    }
  });

  return (
    <Box flexDirection="column">
      {flat.map((item, i) => (
        <Box key={item.path}>
          <Text color={i === cursor ? "cyanBright" : undefined}>
            {"  ".repeat(item.depth)}
            {item.hasChildren ? (item.expanded ? "\u25BE " : "\u25B8 ") : "  "}
          </Text>
          <Text bold={i === cursor}>{item.node.label}</Text>
        </Box>
      ))}
    </Box>
  );
}
