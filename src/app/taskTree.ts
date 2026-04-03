import { getActionById, getActionByToolName } from "../infra/actions/index.ts";

export type TaskTreeNodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"
  | "queued";

export type TaskTreeNodeKind = "request" | "routing" | "family" | "agent" | "tool" | "queue";

export interface TaskTreeNode {
  id: string;
  parentId: string | null;
  kind: TaskTreeNodeKind;
  label: string;
  detail?: string;
  status: TaskTreeNodeStatus;
  startedAt: number;
  endedAt?: number;
  meta?: Record<string, string>;
}

export interface TaskTreeState {
  runId: string;
  rootId: string;
  actionId?: string;
  inputPreview: string;
  nodes: TaskTreeNode[];
  currentAgentName?: string;
}

interface TaskFamily {
  key: string;
  label: string;
}

const MAX_PREVIEW_LENGTH = 72;

const TOOL_FAMILY_PATTERNS: Array<{ family: TaskFamily; patterns: RegExp[] }> = [
  {
    family: { key: "market-analysis", label: "Market analysis" },
    patterns: [
      /scan/i,
      /analy/i,
      /indicator/i,
      /chart/i,
      /market/i,
      /liquidation/i,
      /pair/i,
      /regime/i,
      /discovery/i,
      /orderbook/i,
    ],
  },
  {
    family: { key: "trading-execution", label: "Trade planning and execution" },
    patterns: [
      /trade/i,
      /plan/i,
      /order/i,
      /risk/i,
      /position/i,
      /portfolio/i,
      /account/i,
      /history/i,
      /withdraw/i,
      /wallet/i,
      /earn/i,
    ],
  },
  {
    family: { key: "systematic-research", label: "Systematic research" },
    patterns: [
      /backtest/i,
      /systematic/i,
      /dataset/i,
      /snapshot/i,
      /experiment/i,
      /lifecycle/i,
      /validate/i,
      /runtime/i,
      /playbook/i,
      /protocol/i,
      /genome/i,
      /audit/i,
      /monte/i,
      /walk/i,
      /optimi/i,
    ],
  },
  {
    family: { key: "automation-runtime", label: "Automation and runtime" },
    patterns: [
      /autonomous/i,
      /scheduler/i,
      /monitor/i,
      /daemon/i,
      /reconcile/i,
      /capital/i,
      /health/i,
      /evolution/i,
    ],
  },
  {
    family: { key: "rails-payments", label: "Rails and payments" },
    patterns: [
      /moonpay/i,
      /polygon/i,
      /helius/i,
      /fund/i,
      /payment/i,
      /rail/i,
      /x402/i,
    ],
  },
  {
    family: { key: "onchain-protocols", label: "Onchain protocols" },
    patterns: [
      /uniswap/i,
      /base/i,
      /chainlink/i,
      /solana/i,
      /polkadot/i,
      /agentkit/i,
      /dex/i,
      /defillama/i,
      /ccip/i,
    ],
  },
  {
    family: { key: "web-automation", label: "Web automation" },
    patterns: [/tinyfish/i, /web/i, /browser/i, /monitor/i],
  },
];

const ACTION_FAMILIES: Record<string, TaskFamily> = {
  "market.scan": { key: "market-analysis", label: "Market discovery" },
  "market.analyze": { key: "market-analysis", label: "Market analysis" },
  "trading.plan": { key: "trading-execution", label: "Trade planning" },
  "trading.preview_market_order": { key: "trading-execution", label: "Order preview" },
  "trading.place_market_order": { key: "trading-execution", label: "Trade execution" },
  "account.portfolio": { key: "trading-execution", label: "Portfolio and account" },
  "rails.fund": { key: "rails-payments", label: "Funding and wallet rails" },
  "rails.pay": { key: "rails-payments", label: "Payments" },
};

function shorten(text: string, maxLength: number = MAX_PREVIEW_LENGTH): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function createNode(
  kind: TaskTreeNodeKind,
  label: string,
  status: TaskTreeNodeStatus,
  parentId: string | null,
  detail?: string,
  meta?: Record<string, string>,
): TaskTreeNode {
  return {
    id: `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    parentId,
    kind,
    label,
    detail,
    status,
    startedAt: Date.now(),
    meta,
  };
}

function replaceNode(nodes: TaskTreeNode[], nodeId: string, updater: (node: TaskTreeNode) => TaskTreeNode): TaskTreeNode[] {
  return nodes.map((node) => (node.id === nodeId ? updater(node) : node));
}

function getNode(nodes: TaskTreeNode[], nodeId: string): TaskTreeNode | undefined {
  return nodes.find((node) => node.id === nodeId);
}

function findNode(nodes: TaskTreeNode[], predicate: (node: TaskTreeNode) => boolean): TaskTreeNode | undefined {
  return nodes.find(predicate);
}

function ensureNode(
  tree: TaskTreeState,
  predicate: (node: TaskTreeNode) => boolean,
  factory: () => TaskTreeNode,
): [TaskTreeState, TaskTreeNode] {
  const existing = findNode(tree.nodes, predicate);
  if (existing) return [tree, existing];

  const next = factory();
  return [{ ...tree, nodes: [...tree.nodes, next] }, next];
}

function markNodeStatus(tree: TaskTreeState, nodeId: string, status: TaskTreeNodeStatus, detail?: string): TaskTreeState {
  return {
    ...tree,
    nodes: replaceNode(tree.nodes, nodeId, (node) => ({
      ...node,
      status,
      detail: detail ?? node.detail,
      endedAt: status === "running" || status === "pending" || status === "queued" ? node.endedAt : Date.now(),
    })),
  };
}

function getRoutingNode(tree: TaskTreeState): TaskTreeNode | undefined {
  return findNode(tree.nodes, (node) => node.kind === "routing");
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function summarizeArgs(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;

  const preferredKeys = ["symbol", "symbols", "strategy", "timeframe", "side", "intent", "goal", "resource", "monitorId"];
  const parts: string[] = [];

  for (const key of preferredKeys) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      parts.push(`${key}: ${value.slice(0, 3).join(", ")}`);
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}: ${String(value)}`);
    }
    if (parts.length >= 2) break;
  }

  if (parts.length === 0) return undefined;
  return shorten(parts.join(" · "), 64);
}

function buildToolFingerprint(agentNodeId: string, toolName: string, detail?: string): string {
  return `${agentNodeId}::${toolName}::${detail ?? ""}`;
}

function getPrimaryFamily(actionId?: string): TaskFamily {
  if (actionId && ACTION_FAMILIES[actionId]) {
    return ACTION_FAMILIES[actionId];
  }
  return { key: "general-request", label: "General request" };
}

function classifyToolFamily(toolName: string, actionId?: string): TaskFamily {
  const action = getActionByToolName(toolName);
  const actionFamily = action ? ACTION_FAMILIES[action.id] : undefined;
  if (actionFamily) {
    return actionFamily;
  }

  for (const entry of TOOL_FAMILY_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(toolName))) {
      return entry.family;
    }
  }

  return getPrimaryFamily(actionId);
}

function ensureFamilyNode(tree: TaskTreeState, family: TaskFamily): [TaskTreeState, TaskTreeNode] {
  return ensureNode(
    tree,
    (node) => node.kind === "family" && node.meta?.familyKey === family.key,
    () => createNode("family", family.label, "running", tree.rootId, undefined, { familyKey: family.key }),
  );
}

function ensureAgentNode(tree: TaskTreeState, familyNode: TaskTreeNode, agentName: string): [TaskTreeState, TaskTreeNode] {
  return ensureNode(
    tree,
    (node) => node.kind === "agent" && node.parentId === familyNode.id && node.meta?.agentName === agentName,
    () => createNode("agent", agentName, "running", familyNode.id, undefined, { agentName }),
  );
}

function completeActiveToolNodes(tree: TaskTreeState): TaskTreeState {
  return {
    ...tree,
    nodes: tree.nodes.map((node) => (
      node.kind === "tool" && node.status === "running"
        ? { ...node, status: "completed" as const, endedAt: Date.now() }
        : node
    )),
  };
}

function settleFamilyAndAgentStatuses(tree: TaskTreeState): TaskTreeState {
  const children = new Map<string, TaskTreeNode[]>();
  for (const node of tree.nodes) {
    if (!node.parentId) continue;
    const current = children.get(node.parentId) ?? [];
    current.push(node);
    children.set(node.parentId, current);
  }

  return {
    ...tree,
    nodes: tree.nodes.map((node) => {
      if (node.kind !== "family" && node.kind !== "agent") return node;
      const childNodes = children.get(node.id) ?? [];
      if (childNodes.length === 0) return node;
      const hasRunning = childNodes.some((child) => child.status === "running" || child.status === "pending");
      const hasFailed = childNodes.some((child) => child.status === "failed" || child.status === "blocked");
      const allCancelled = childNodes.every((child) => child.status === "cancelled");
      if (hasRunning) return { ...node, status: "running" as const };
      if (hasFailed) return { ...node, status: "failed" as const, endedAt: Date.now() };
      if (allCancelled) return { ...node, status: "cancelled" as const, endedAt: Date.now() };
      return { ...node, status: "completed" as const, endedAt: Date.now() };
    }),
  };
}

export function createTaskTree(options: {
  input: string;
  actionId?: string;
  commandName?: string;
}): TaskTreeState {
  const action = options.actionId ? getActionById(options.actionId) : undefined;
  const requestLabel = action?.title
    ?? (options.commandName ? humanizeIdentifier(options.commandName) : "Handle request");
  const requestDetail = shorten(options.input);
  const root = createNode("request", requestLabel, "running", null, requestDetail, {
    actionId: options.actionId ?? "",
  });
  const routing = createNode("routing", "Route request", "running", root.id, "Selecting the right workflow and tools");

  return {
    runId: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    rootId: root.id,
    actionId: options.actionId,
    inputPreview: requestDetail,
    nodes: [root, routing],
  };
}

export function markTaskTreeRoutingResolved(tree: TaskTreeState, detail?: string): TaskTreeState {
  const routing = getRoutingNode(tree);
  if (!routing || routing.status === "completed") return tree;
  return markNodeStatus(tree, routing.id, "completed", detail ?? "Workflow routed");
}

export function recordTaskTreeAgentSwitch(tree: TaskTreeState, agentName: string): TaskTreeState {
  let next = markTaskTreeRoutingResolved(tree);
  const family = getPrimaryFamily(tree.actionId);
  let familyNode: TaskTreeNode;
  [next, familyNode] = ensureFamilyNode(next, family);
  next = markNodeStatus(next, familyNode.id, "running");

  let agentNode: TaskTreeNode;
  [next, agentNode] = ensureAgentNode(next, familyNode, agentName);
  next = markNodeStatus(next, agentNode.id, "running");

  return {
    ...next,
    currentAgentName: agentName,
  };
}

export function recordTaskTreeToolStart(
  tree: TaskTreeState,
  toolName: string,
  args?: Record<string, unknown>,
  agentName?: string,
): TaskTreeState {
  let next = markTaskTreeRoutingResolved(tree);
  const family = classifyToolFamily(toolName, tree.actionId);
  let familyNode: TaskTreeNode;
  [next, familyNode] = ensureFamilyNode(next, family);
  next = markNodeStatus(next, familyNode.id, "running");

  const resolvedAgentName = agentName ?? tree.currentAgentName ?? "Gordon";
  let agentNode: TaskTreeNode;
  [next, agentNode] = ensureAgentNode(next, familyNode, resolvedAgentName);
  next = markNodeStatus(next, agentNode.id, "running");
  const toolDetail = summarizeArgs(args);
  const toolFingerprint = buildToolFingerprint(agentNode.id, toolName, toolDetail);
  const existingRunningTool = [...next.nodes]
    .reverse()
    .find((node) => (
      node.kind === "tool"
      && node.parentId === agentNode.id
      && node.status === "running"
      && node.meta?.toolFingerprint === toolFingerprint
    ));

  if (existingRunningTool) {
    return {
      ...next,
      currentAgentName: resolvedAgentName,
    };
  }

  const toolNode = createNode(
    "tool",
    humanizeIdentifier(toolName),
    "running",
    agentNode.id,
    toolDetail,
    { toolName, toolFingerprint },
  );

  return {
    ...next,
    currentAgentName: resolvedAgentName,
    nodes: [...next.nodes, toolNode],
  };
}

export function recordTaskTreeToolEnd(tree: TaskTreeState, toolName?: string, succeeded: boolean = true): TaskTreeState {
  const matchingNode = [...tree.nodes]
    .reverse()
    .find((node) => node.kind === "tool" && node.status === "running" && (!toolName || node.meta?.toolName === toolName));

  if (!matchingNode) return tree;

  const next = markNodeStatus(tree, matchingNode.id, succeeded ? "completed" : "failed");
  return settleFamilyAndAgentStatuses(next);
}

export function queueTaskTreeSubmission(tree: TaskTreeState | null, preview: string, kind: "follow-up" | "steer"): TaskTreeState | null {
  if (!tree) return tree;
  const label = kind === "steer" ? "Steering update queued" : "Follow-up queued";
  const existing = findNode(tree.nodes, (node) => node.kind === "queue" && node.label === label && node.status === "queued");
  if (existing) {
    return markNodeStatus(tree, existing.id, "queued", shorten(preview, 64));
  }
  const queueNode = createNode("queue", label, "queued", tree.rootId, shorten(preview, 64));
  return {
    ...tree,
    nodes: [...tree.nodes, queueNode],
  };
}

export function dequeueTaskTreeSubmission(tree: TaskTreeState | null): TaskTreeState | null {
  if (!tree) return tree;
  const queueNode = findNode(tree.nodes, (node) => node.kind === "queue" && node.status === "queued");
  if (!queueNode) return tree;
  return markNodeStatus(tree, queueNode.id, "completed", queueNode.detail);
}

function finalizeTree(tree: TaskTreeState, status: "completed" | "cancelled" | "failed", detail?: string): TaskTreeState {
  let next = completeActiveToolNodes(tree);
  next = settleFamilyAndAgentStatuses(next);
  const routing = getRoutingNode(next);
  if (routing && routing.status === "running") {
    next = markNodeStatus(next, routing.id, "completed", routing.detail);
  }

  next = {
    ...next,
    nodes: next.nodes.map((node) => {
      if (node.id === next.rootId) {
        return {
          ...node,
          status,
          detail: detail ?? node.detail,
          endedAt: Date.now(),
        };
      }
      if (node.kind === "queue" && node.status === "queued" && status !== "completed") {
        return { ...node, status, endedAt: Date.now() };
      }
      if (node.status === "running" || node.status === "pending") {
        return {
          ...node,
          status: status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "completed",
          endedAt: Date.now(),
        };
      }
      return node;
    }),
  };

  return settleFamilyAndAgentStatuses(next);
}

export function completeTaskTree(tree: TaskTreeState | null, detail?: string): TaskTreeState | null {
  if (!tree) return null;
  return finalizeTree(tree, "completed", detail);
}

export function cancelTaskTree(tree: TaskTreeState | null, detail?: string): TaskTreeState | null {
  if (!tree) return null;
  return finalizeTree(tree, "cancelled", detail ?? "Run stopped");
}

export function failTaskTree(tree: TaskTreeState | null, detail?: string): TaskTreeState | null {
  if (!tree) return null;
  return finalizeTree(tree, "failed", detail ?? "Run failed");
}
