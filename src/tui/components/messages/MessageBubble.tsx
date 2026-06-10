import React from "react";
import { Box, Text } from "../../ink-custom";
import { RichContent } from "./RichContent.js";
import { Byline } from "../layout/Byline.tsx";
import { NoSelect } from "../layout/NoSelect.tsx";

// Specialized renderers (Claude Code pattern: one component per message type)
import { UserMessage } from "./UserMessage.js";
import { AssistantMessage } from "./AssistantMessage.js";
import { SystemMessage } from "./SystemMessage.js";
import { TradeEventMessage } from "./TradeEventMessage.js";
import { ApprovalMessage } from "./ApprovalMessage.js";
import { ErrorMessage } from "./ErrorMessage.js";
import { HandoffMessage } from "./HandoffMessage.js";
import { ToolResultMessage } from "./ToolResultMessage.js";
import { CompactMessage } from "./CompactMessage.js";
import { PositionMessage } from "./PositionMessage.js";
import { OrderMessage } from "./OrderMessage.js";
import { RiskCheckMessage } from "./RiskCheckMessage.js";
import { BacktestMessage } from "./BacktestMessage.js";
import { ScanResultMessage } from "./ScanResultMessage.js";
import { HookProgressMessage } from "./HookProgressMessage.js";
import { RateLimitMessage } from "./RateLimitMessage.js";
import { ShutdownMessage } from "./ShutdownMessage.js";
import { PasteDetectionMessage } from "./PasteDetectionMessage.js";
import { ProactiveSuggestionMessage } from "./ProactiveSuggestionMessage.js";
import { AssistantThinkingMessage } from "./AssistantThinkingMessage.js";
import { AssistantRedactedThinkingMessage } from "./AssistantRedactedThinkingMessage.js";
import { InterruptedMessage } from "./InterruptedMessage.js";
import { CompactBoundaryMessage } from "./CompactBoundaryMessage.js";
import { UserToolSuccessMessage } from "./UserToolSuccessMessage.js";
import { UserToolErrorMessage } from "./UserToolErrorMessage.js";
import { UserToolCanceledMessage } from "./UserToolCanceledMessage.js";
import { UserToolRejectMessage } from "./UserToolRejectMessage.js";
import { RejectedPlanMessage } from "./RejectedPlanMessage.js";
import { TaskAssignmentMessage } from "./TaskAssignmentMessage.js";
import { PlanApprovalMessage } from "./PlanApprovalMessage.js";
import { AdvisorMessage } from "./AdvisorMessage.js";

// ============================================================================
// MessageBubble — Routes to specialized renderers by variant
//
// 18 specialized trading-adapted renderers + fallback.
// ============================================================================

export type MessageVariant =
  | "default" | "approval" | "system" | "tool" | "handoff"
  | "fill" | "stop" | "alert" | "strategy"
  | "error" | "compact" | "resume" | "welcome"
  | "position" | "order" | "risk_check" | "backtest" | "scan_result"
  | "hook_progress" | "rate_limit" | "shutdown" | "paste"
  | "proactive_suggestion"
  | "thinking" | "redacted_thinking" | "interrupted" | "compact_boundary"
  | "tool_success" | "tool_error" | "tool_canceled" | "tool_reject"
  | "rejected_plan" | "task_assignment" | "plan_approval" | "advisor";

export interface PlanRubricPayload {
  rubric: import("../../../infra/safety/planRubric.ts").PlanRubric;
  verdict: import("../../../infra/safety/planRubric.ts").RubricVerdict;
  total: number;
  blockingDimensions: import("../../../infra/safety/planRubric.ts").RubricDimension[];
}

export interface Message {
  id: string;
  role: "user" | "gordon" | "assistant" | "system";
  content: string;
  timestamp?: string;
  variant?: MessageVariant;
  agent?: string;
  badge?: string;
  /** Optional 6-dimension plan rubric when GORDON_PLAN_RUBRIC is on. */
  planRubric?: PlanRubricPayload;
  /** When true, this message is still being streamed — renders with cursor */
  streaming?: boolean;
}

interface Props {
  message: Message;
}

// Badge and color configuration per variant
// Trading badges (FILLED, STOP, ALERT) stay prominent — they're money events.
// Generic labels (gordon, you, system) use lowercase for clean hierarchy.
const VARIANT_CONFIG: Record<string, {
  getBadge: (msg: Message) => string;
  badgeColor: string;
  contentDim?: boolean;
  icon?: string;
  useHook?: boolean; // Show ⎿ left hook (Claude Code style)
}> = {
  default_user: {
    getBadge: () => "",
    badgeColor: "white",
  },
  default_gordon: {
    getBadge: () => "",
    badgeColor: "cyanBright",
    useHook: true,
  },
  approval: {
    getBadge: (m) => `APPROVAL${m.badge ? ` [${m.badge}]` : ""}`,
    badgeColor: "yellow",
    icon: "\u26A0",
    useHook: true,
  },
  system: {
    getBadge: () => "",
    badgeColor: "gray",
    contentDim: true,
  },
  tool: {
    getBadge: () => "tool",
    badgeColor: "gray",
    contentDim: true,
    useHook: true,
  },
  handoff: {
    getBadge: (m) => `\u2192 ${m.agent ?? "agent"}`,
    badgeColor: "cyanBright",
  },
  fill: {
    getBadge: () => "FILLED",
    badgeColor: "green",
    icon: "\u2713",
  },
  stop: {
    getBadge: () => "STOP",
    badgeColor: "red",
    icon: "\u26A0",
  },
  alert: {
    getBadge: () => "ALERT",
    badgeColor: "yellow",
    icon: "!",
  },
  strategy: {
    getBadge: (m) => `STRATEGY${m.agent ? ` \u00b7 ${m.agent}` : ""}`,
    badgeColor: "cyanBright",
    icon: "\u25C8",
  },
  error: {
    getBadge: () => "error",
    badgeColor: "red",
    icon: "\u2717",
  },
  compact: {
    getBadge: () => "\u273B conversation compacted",
    badgeColor: "gray",
    contentDim: true,
  },
  resume: {
    getBadge: () => "\u21BB session resumed",
    badgeColor: "gray",
    contentDim: true,
  },
};

// Claude Code pattern: React.memo with custom equality — only re-render when message content changes
function areMessagePropsEqual(prev: Props, next: Props): boolean {
  if (prev.message.id !== next.message.id) return false;
  if (prev.message.content !== next.message.content) return false;
  if (prev.message.streaming !== next.message.streaming) return false;
  if (prev.message.variant !== next.message.variant) return false;
  return true;
}

export const MessageBubble = React.memo(function MessageBubble({ message }: Props) {
  const { role, variant = "default" } = message;

  // Route to specialized renderers (Claude Code pattern)
  // User messages
  if (variant === "default" && role === "user") {
    return <UserMessage message={message} />;
  }

  // Assistant (gordon) messages
  if (variant === "default" && (role === "gordon" || role === "assistant")) {
    return <AssistantMessage message={message} />;
  }

  // Trade events — the user's money moving
  if (variant === "fill" || variant === "stop" || variant === "alert" || variant === "strategy") {
    return <TradeEventMessage message={message} />;
  }

  // Approvals — human-in-the-loop
  if (variant === "approval") {
    return <ApprovalMessage message={message} />;
  }

  // Errors
  if (variant === "error") {
    return <ErrorMessage message={message} />;
  }

  // System messages
  if (variant === "system" || (variant === "default" && role === "system")) {
    return <SystemMessage message={message} />;
  }

  // Tool results
  if (variant === "tool") {
    return <ToolResultMessage message={message} />;
  }

  // Handoffs
  if (variant === "handoff") {
    return <HandoffMessage message={message} />;
  }

  // Compact / resume
  if (variant === "compact" || variant === "resume") {
    return <CompactMessage message={message} />;
  }

  // Trading-specific variants
  if (variant === "position") {
    return <PositionMessage message={message} />;
  }
  if (variant === "order") {
    return <OrderMessage message={message} />;
  }
  if (variant === "risk_check") {
    return <RiskCheckMessage message={message} />;
  }
  if (variant === "backtest") {
    return <BacktestMessage message={message} />;
  }
  if (variant === "scan_result") {
    return <ScanResultMessage message={message} />;
  }

  // Hook progress
  if (variant === "hook_progress") {
    return <HookProgressMessage message={message} />;
  }

  // Rate limit
  if (variant === "rate_limit") {
    return <RateLimitMessage message={message} />;
  }

  // Shutdown
  if (variant === "shutdown") {
    return <ShutdownMessage message={message} />;
  }

  // Paste detection
  if (variant === "paste") {
    return <PasteDetectionMessage message={message} />;
  }

  // Proactive suggestion — unsolicited trading suggestions from proactive mode
  if (variant === "proactive_suggestion") {
    return <ProactiveSuggestionMessage message={message} />;
  }

  // Extended thinking variants
  if (variant === "thinking") return <AssistantThinkingMessage message={message} />;
  if (variant === "redacted_thinking") return <AssistantRedactedThinkingMessage message={message} />;

  // Interrupt
  if (variant === "interrupted") return <InterruptedMessage message={message} />;

  // Compaction boundary separator
  if (variant === "compact_boundary") return <CompactBoundaryMessage message={message} />;

  // Tool outcome variants
  if (variant === "tool_success") return <UserToolSuccessMessage message={message} />;
  if (variant === "tool_error") return <UserToolErrorMessage message={message} />;
  if (variant === "tool_canceled") return <UserToolCanceledMessage message={message} />;
  if (variant === "tool_reject") return <UserToolRejectMessage message={message} />;

  // Plan lifecycle variants
  if (variant === "rejected_plan") return <RejectedPlanMessage message={message} />;
  if (variant === "task_assignment") return <TaskAssignmentMessage message={message} />;
  if (variant === "plan_approval") return <PlanApprovalMessage message={message} />;

  // Advisory / proactive tips
  if (variant === "advisor") return <AdvisorMessage message={message} />;

  // Fallback — unknown variant, render with hook
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <NoSelect>{"\u231F  "}</NoSelect>
        <Box flexDirection="column" flexGrow={1}>
          <RichContent content={message.content} />
        </Box>
      </Box>
    </Box>
  );
}, areMessagePropsEqual);

function timeAgo(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return "";
  }
}
