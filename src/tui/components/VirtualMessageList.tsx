import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, useInput } from "ink";
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

  // Slice visible messages
  const visibleMessages = messages.slice(startIndex, endIndex);

  return (
    <Box flexDirection="column" height={viewportHeight}>
      {/* Rendered message subset */}
      {visibleMessages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Unseen indicator */}
      {unseenCount > 0 && !isAtBottom && (
        <UnseenDivider count={unseenCount} onJumpToBottom={handleJumpToBottom} />
      )}
    </Box>
  );
}
