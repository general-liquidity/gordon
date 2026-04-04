import React, { useState } from "react";
import { Box, useInput } from "ink";
import { SearchBox } from "../design-system/SearchBox.js";
import type { ScrollBoxHandle } from "./ScrollBox.js";
import { useOverlayState } from "../context/overlayContext.js";

// ============================================================================
// ScrollKeybindingHandler — Vim-style scroll navigation
//
// j/k: line up/down, Ctrl+D/U: half page, g/G: top/bottom
// /: enter search mode, n/N: next/prev match, Escape: exit search
// ============================================================================

interface Props {
  scrollRef: React.RefObject<ScrollBoxHandle | null>;
  pageSize: number;
  onSearch?: (query: string) => void;
  onNextMatch?: () => void;
  onPrevMatch?: () => void;
  enabled?: boolean;
}

export function ScrollKeybindingHandler({
  scrollRef,
  pageSize,
  onSearch,
  onNextMatch,
  onPrevMatch,
  enabled = true,
}: Props) {
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { hasModalOverlay } = useOverlayState();

  useInput(
    (input, key) => {
      if (!enabled || hasModalOverlay) return;
      const handle = scrollRef.current;
      if (!handle) return;

      if (searchActive) {
        // Search mode handled by SearchBox
        return;
      }

      if (input === "j" || key.downArrow) {
        handle.scrollBy(1);
      } else if (input === "k" || key.upArrow) {
        handle.scrollBy(-1);
      } else if (key.ctrl && input === "d") {
        handle.scrollBy(Math.floor(pageSize / 2));
      } else if (key.ctrl && input === "u") {
        handle.scrollBy(-Math.floor(pageSize / 2));
      } else if (input === "G" || (key.shift && input === "g")) {
        handle.scrollToBottom();
      } else if (input === "g" && !key.shift) {
        handle.scrollTo(0);
      } else if (input === "/" && onSearch) {
        setSearchActive(true);
        setSearchQuery("");
      } else if (input === "n" && onNextMatch) {
        onNextMatch();
      } else if (input === "N" && onPrevMatch) {
        onPrevMatch();
      }
    },
  );

  if (!searchActive) return null;

  return (
    <Box>
      <SearchBox
        value={searchQuery}
        onChange={(val) => {
          setSearchQuery(val);
          onSearch?.(val);
        }}
        onSubmit={() => {
          onSearch?.(searchQuery);
          setSearchActive(false);
        }}
        onCancel={() => {
          setSearchActive(false);
          setSearchQuery("");
          onSearch?.("");
        }}
        placeholder="Search transcript..."
      />
    </Box>
  );
}
