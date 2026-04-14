import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { MessageBubble, type Message } from "./MessageBubble.js";
import { UnseenDivider } from "./UnseenDivider.js";
import {
  useVirtualScroll,
  getScrollAction,
} from "../hooks/useVirtualScroll.js";

// ============================================================================
// VirtualMessageList — Renders only visible messages via virtual scroll
//
// Replaces <Static> + manual slicing for large conversations.
// Supports j/k, Ctrl+D/U, G/g for scroll navigation.
// Shows "N new" indicator when not at bottom and messages arrive.
// ============================================================================

interface Props {
  messages: Message[];
  viewportHeight: number;
  /** Height per message row in terminal lines (default 3) */
  itemHeight?: number;
  /** Whether input focus should be on scroll keys (disable during typing) */
  scrollEnabled?: boolean;
}

const DEFAULT_ITEM_HEIGHT = 3;

export function VirtualMessageList({
  messages,
  viewportHeight,
  itemHeight = DEFAULT_ITEM_HEIGHT,
  scrollEnabled = true,
}: Props) {
  const [unseenCount, setUnseenCount] = useState(0);
  const prevMessageCount = useRef(messages.length);

  const {
    startIndex,
    endIndex,
    isAtBottom,
    scrollToBottom,
    scrollTo,
    onScroll,
  } = useVirtualScroll({
    totalItems: messages.length,
    viewportHeight,
    itemHeight,
    overscan: 3,
  });

  // Track unseen messages when not at bottom
  useEffect(() => {
    const newCount = messages.length - prevMessageCount.current;
    if (newCount > 0 && !isAtBottom) {
      setUnseenCount((prev) => prev + newCount);
    }
    if (isAtBottom) {
      setUnseenCount(0);
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, isAtBottom]);

  // Auto-scroll to bottom when new messages arrive and already at bottom
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [messages.length, isAtBottom, scrollToBottom]);

  // Keyboard scroll bindings
  useInput(
    (input, key) => {
      if (!scrollEnabled) return;

      const action = getScrollAction(input, key, viewportHeight, itemHeight);
      if (!action) return;

      if (action.delta === "bottom") {
        scrollToBottom();
        setUnseenCount(0);
      } else if (action.delta === "top") {
        scrollTo(0);
      } else if (action.delta === "pageUp") {
        onScroll(-viewportHeight);
      } else if (action.delta === "pageDown") {
        onScroll(viewportHeight);
      } else {
        onScroll(action.delta);
      }
    },
    { isActive: scrollEnabled },
  );

  const handleJumpToBottom = useCallback(() => {
    scrollToBottom();
    setUnseenCount(0);
  }, [scrollToBottom]);

  // Message collapsing pipeline (Claude Code pattern): group consecutive
  // tool results. Keyed on (messages.length, last id, last content length)
  // instead of messages array identity — when only the last message's
  // content changes during streaming we still hit the cache because the
  // id is stable and the collapse structure doesn't depend on content.
  const lastMsg = messages[messages.length - 1];
  const collapseKey = `${messages.length}:${lastMsg?.id ?? ""}:${(lastMsg?.content ?? "").length}`;
  const collapsedMessages = useMemo(() => {
    const result: Message[] = [];
    let toolGroup: Message[] = [];

    for (const msg of messages) {
      if (msg.variant === "tool" || msg.variant === "hook_progress") {
        toolGroup.push(msg);
      } else {
        // Flush tool group
        if (toolGroup.length > 3) {
          result.push({
            id: `collapsed-tools-${toolGroup[0]!.id}`,
            role: "system",
            content: `${toolGroup.length} tool results`,
            variant: "compact",
            timestamp: toolGroup[0]!.timestamp,
          });
        } else {
          result.push(...toolGroup);
        }
        toolGroup = [];
        result.push(msg);
      }
    }
    // Flush remaining
    if (toolGroup.length > 3) {
      result.push({
        id: `collapsed-tools-${toolGroup[0]!.id}`,
        role: "system",
        content: `${toolGroup.length} tool results`,
        variant: "compact",
        timestamp: toolGroup[0]!.timestamp,
      });
    } else {
      result.push(...toolGroup);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey]);

  // Slice visible messages
  const visibleMessages = collapsedMessages.slice(startIndex, endIndex);

  // Message selection state — subtle background highlight
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  useInput((input, key) => {
    if (!scrollEnabled) return;
    // Ctrl+Up/Down for message selection
    if (key.ctrl && key.upArrow) {
      setSelectedIdx((prev) => prev == null ? visibleMessages.length - 1 : Math.max(0, prev - 1));
    } else if (key.ctrl && key.downArrow) {
      setSelectedIdx((prev) => prev == null ? 0 : Math.min(visibleMessages.length - 1, prev + 1));
    } else if (key.escape && selectedIdx != null) {
      setSelectedIdx(null);
    }
  }, { isActive: scrollEnabled });

  return (
    <Box flexDirection="column" height={viewportHeight}>
      {/* Rendered message subset */}
      {visibleMessages.map((msg, i) => (
        <Box key={msg.id} {...(i === selectedIdx ? { borderStyle: "single" as const, borderColor: "gray" } : {})}>
          <MessageBubble message={msg} />
        </Box>
      ))}

      {/* Unseen indicator */}
      {unseenCount > 0 && !isAtBottom && (
        <UnseenDivider count={unseenCount} onJumpToBottom={handleJumpToBottom} />
      )}
    </Box>
  );
}
