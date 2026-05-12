import type { RuntimeApprovalRequest } from "../../runtime/contracts/types.ts";
import type { ChatMessage } from "./chatTypes.ts";
import { getRuntimeApprovalShortId } from "../runtime/runtimeApprovalId.ts";

function formatApprovalTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatApprovalTicketContent(approval: RuntimeApprovalRequest, shortId: string): string {
  const detailParts = [
    approval.permissionScope ? `Scope \`${approval.permissionScope}\`` : null,
    approval.riskClass ? `Risk \`${approval.riskClass}\`` : null,
    approval.sideEffectLevel ? `Effect \`${approval.sideEffectLevel}\`` : null,
  ].filter(Boolean);

  const lines = [
    `Approval required before Gordon can route \`${approval.toolName}\`.`,
    detailParts.length > 0 ? detailParts.join(" · ") : null,
    approval.reason ? approval.reason : null,
    "",
    `Approve: \`approve ${shortId}\` or \`/runtime-approve ${shortId}\``,
    `Persist: \`approve ${shortId} persist\``,
    `Deny: \`deny ${shortId} reason\``,
    `Persist deny: \`deny ${shortId} persist reason\``,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

export function buildPendingApprovalMessages(approvals: RuntimeApprovalRequest[]): ChatMessage[] {
  return approvals.map((approval) => {
    const shortId = getRuntimeApprovalShortId(approval.id);
    return {
      role: "gordon",
      variant: "approval",
      badge: shortId,
      content: formatApprovalTicketContent(approval, shortId),
      timestamp: formatApprovalTimestamp(approval.requestedAt),
    };
  });
}

export function appendPendingApprovalMessages(
  messages: ChatMessage[],
  approvals: RuntimeApprovalRequest[],
): ChatMessage[] {
  if (approvals.length === 0) {
    return messages;
  }

  return [...messages, ...buildPendingApprovalMessages(approvals)];
}

export function hasConversationMomentum(messages: ChatMessage[]): boolean {
  const substantiveMessages = messages.filter((message) => message.content.trim().length > 0);
  return substantiveMessages.length >= 2;
}

export function shouldShowInlineQuickActions(input: {
  disabled: boolean;
  busy: boolean;
  value: string;
  hasConversationMomentum: boolean;
}): boolean {
  return !input.disabled
    && !input.busy
    && input.value.trim() === ""
    && !input.hasConversationMomentum;
}
