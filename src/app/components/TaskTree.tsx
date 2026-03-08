import React, { useMemo } from "react";
import { Box, Static, Text } from "ink";
import { getTaskTreeTokens } from "../componentTheme.ts";
import { truncateWithEllipsis, useMeasuredWidth } from "../layout.ts";
import { COLORS } from "../theme.ts";
import type { TaskTreeNode, TaskTreeNodeStatus, TaskTreeState } from "../taskTree.ts";

interface TaskTreeProps {
  tree: TaskTreeState;
  title?: string;
  staticCompleted?: boolean;
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

export const TaskTree: React.FC<TaskTreeProps> = ({ tree, title = "Task Tree", staticCompleted = true }) => {
  const rows = useMemo(() => buildRows(tree), [tree]);
  const { ref, width } = useMeasuredWidth(72);
  const completedRows = staticCompleted
    ? rows.filter(({ node }) => ["completed", "failed", "cancelled"].includes(node.status))
    : [];
  const activeRows = staticCompleted
    ? rows.filter(({ node }) => !["completed", "failed", "cancelled"].includes(node.status))
    : rows;

  const renderRow = ({ node, prefix, isActiveLeaf }: RenderRow): React.ReactElement => {
    const statusGlyph = getStatusGlyph(node.status);
    const tokens = getTaskTreeTokens(node, node.status, isActiveLeaf);
    const availableTextWidth = Math.max(16, width - prefix.length - 8);
    const label = truncateWithEllipsis(node.label, Math.min(availableTextWidth, 48));
    const detail = node.detail
      ? truncateWithEllipsis(node.detail, Math.min(availableTextWidth, 40))
      : null;

    return (
      <Box key={node.id}>
        <Text color={COLORS.DIM}>{prefix}</Text>
        <Text color={tokens.status}>{statusGlyph}</Text>
        <Text> </Text>
        <Text color={tokens.label} bold={node.kind === "request" || isActiveLeaf} underline={isActiveLeaf}>
          {label}
        </Text>
        {detail && (
          <Text color={tokens.detail}> {" — "}{detail}</Text>
        )}
      </Box>
    );
  };

  return (
    <Box ref={ref} flexDirection="column" marginX={2} marginBottom={1}>
      <Text color={COLORS.TAN} bold>
        {title}
      </Text>
      {staticCompleted && completedRows.length > 0 && (
        <Static key={tree.rootId} items={completedRows}>
          {(item) => renderRow(item)}
        </Static>
      )}
      {activeRows.map(renderRow)}
    </Box>
  );
};

export default TaskTree;
