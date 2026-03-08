import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { COLORS } from "../theme.ts";
import type { TaskTreeNode, TaskTreeNodeStatus, TaskTreeState } from "../taskTree.ts";
import { getTaskLabelColor, getTaskStatusColor } from "../tuiSemantics.ts";

interface TaskTreeProps {
  tree: TaskTreeState;
  title?: string;
}

interface RenderRow {
  node: TaskTreeNode;
  prefix: string;
  isActiveLeaf: boolean;
}

function getStatusGlyph(status: TaskTreeNodeStatus): string {
  switch (status) {
    case "running":
      return "●";
    case "completed":
      return "✓";
    case "failed":
      return "✕";
    case "cancelled":
      return "◌";
    case "blocked":
      return "!";
    case "queued":
      return "…";
    case "pending":
    default:
      return "○";
  }
}

function buildRows(tree: TaskTreeState): RenderRow[] {
  const childMap = new Map<string, TaskTreeNode[]>();
  for (const node of tree.nodes) {
    if (!node.parentId) continue;
    const current = childMap.get(node.parentId) ?? [];
    current.push(node);
    childMap.set(node.parentId, current);
  }

  for (const children of childMap.values()) {
    children.sort((left, right) => left.startedAt - right.startedAt);
  }

  const rows: RenderRow[] = [];

  const visit = (node: TaskTreeNode, prefix: string, isLast: boolean): void => {
    const children = childMap.get(node.id) ?? [];
    const isActiveLeaf = node.status === "running" && children.every((child) => child.status !== "running");
    rows.push({
      node,
      prefix,
      isActiveLeaf,
    });

    const childPrefix = `${prefix}${isLast ? "   " : "│  "}`;
    children.forEach((child, index) => {
      const childIsLast = index === children.length - 1;
      visit(child, `${childPrefix}${childIsLast ? "└─ " : "├─ "}`, childIsLast);
    });
  };

  const root = tree.nodes.find((node) => node.id === tree.rootId);
  if (!root) return rows;

  visit(root, "", true);
  return rows;
}

export const TaskTree: React.FC<TaskTreeProps> = ({ tree, title = "Task Tree" }) => {
  const rows = useMemo(() => buildRows(tree), [tree]);

  return (
    <Box flexDirection="column" marginX={2} marginBottom={1}>
      <Text color={COLORS.TAN} bold>
        {title}
      </Text>
      {rows.map(({ node, prefix, isActiveLeaf }) => {
        const statusGlyph = getStatusGlyph(node.status);
        const statusColor = getTaskStatusColor(node.status);
        const labelColor = getTaskLabelColor(node, isActiveLeaf);

        return (
          <Box key={node.id}>
            <Text color={COLORS.DIM}>{prefix}</Text>
            <Text color={statusColor}>{statusGlyph}</Text>
            <Text> </Text>
            <Text color={labelColor} bold={node.kind === "request" || isActiveLeaf} underline={isActiveLeaf}>
              {node.label}
            </Text>
            {node.detail && (
              <Text color={COLORS.DIM}> {" — "}{node.detail}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

export default TaskTree;
