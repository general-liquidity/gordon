/**
 * Paginated Output Component
 * Displays long outputs with page navigation
 */

import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { COLORS } from "../theme.ts";
import { DeskPanel } from "./desk/DeskPanel.tsx";
import { TicketCard } from "./desk/TicketCard.tsx";

interface PaginatedOutputProps<T> {
  /** The items to paginate */
  items: T[];
  /** Number of items per page (default: 20) */
  pageSize?: number;
  /** Render function for each item */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Optional header to show above items */
  header?: React.ReactNode;
  /** Optional footer to show below items */
  footer?: React.ReactNode;
  /** Whether navigation is active (for keyboard input) */
  isActive?: boolean;
  /** Callback when page changes */
  onPageChange?: (page: number, totalPages: number) => void;
  /** Show keyboard hints */
  showHints?: boolean;
  /** Title for the paginated content */
  title?: string;
  /** Empty state message */
  emptyMessage?: string;
}

export function PaginatedOutput<T>({
  items,
  pageSize = 20,
  renderItem,
  header,
  footer,
  isActive = true,
  onPageChange,
  showHints = true,
  title,
  emptyMessage = "No items to display",
}: PaginatedOutputProps<T>): React.ReactElement {
  const [currentPage, setCurrentPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // Get items for current page
  const pageItems = useMemo(() => {
    const startIndex = currentPage * pageSize;
    return items.slice(startIndex, startIndex + pageSize);
  }, [items, currentPage, pageSize]);

  // Navigation handlers
  const goToPage = useCallback((page: number) => {
    const newPage = Math.max(0, Math.min(page, totalPages - 1));
    if (newPage !== currentPage) {
      setCurrentPage(newPage);
      onPageChange?.(newPage + 1, totalPages);
    }
  }, [currentPage, totalPages, onPageChange]);

  const nextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const prevPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const firstPage = useCallback(() => {
    goToPage(0);
  }, [goToPage]);

  const lastPage = useCallback(() => {
    goToPage(totalPages - 1);
  }, [totalPages, goToPage]);

  // Keyboard navigation
  useInput((input, key) => {
    if (!isActive) return;

    // Page navigation
    if (key.rightArrow || input === "n" || input === " ") {
      nextPage();
    } else if (key.leftArrow || input === "p" || input === "b") {
      prevPage();
    } else if (key.pageDown) {
      nextPage();
    } else if (key.pageUp) {
      prevPage();
    } else if (input === "g" || key.home) {
      firstPage();
    } else if (input === "G" || key.end) {
      lastPage();
    }

    // Number keys for direct page access (1-9)
    const pageNum = parseInt(input, 10);
    if (pageNum >= 1 && pageNum <= 9 && pageNum <= totalPages) {
      goToPage(pageNum - 1);
    }
  }, { isActive });

  // Empty state
  if (items.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <DeskPanel eyebrow="Output" title={title || "Paginated output"} subtitle={emptyMessage} tone="info" compact />
      </Box>
    );
  }

  // Calculate item indices for display
  const startIndex = currentPage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, items.length);

  return (
    <Box flexDirection="column">
      {/* Header */}
      {(title || header) && (
        <Box flexDirection="column" marginBottom={1}>
          {title && (
            <Box justifyContent="space-between">
              <Text color={COLORS.WHITE} bold>{title}</Text>
              <Text color={COLORS.DIM}>
                {items.length} item{items.length !== 1 ? "s" : ""}
              </Text>
            </Box>
          )}
          {header}
        </Box>
      )}

      {/* Page info */}
      <TicketCard
        eyebrow="Page"
        title={`${currentPage + 1} of ${totalPages}`}
        subtitle={`Showing ${startIndex + 1}-${endIndex} of ${items.length}`}
        tone="info"
      />

      {/* Items */}
      <Box flexDirection="column" paddingX={1}>
        {pageItems.map((item, index) => (
          <Box key={`item-${startIndex + index}`}>
            {renderItem(item, startIndex + index)}
          </Box>
        ))}
      </Box>

      {/* Navigation bar */}
      <Box
        marginTop={1}
        justifyContent="space-between"
      >
        {/* Previous button */}
        <Box>
          {currentPage > 0 ? (
            <Text color={COLORS.ACCENT}>
              <Text color={COLORS.HIGHLIGHT}>[</Text>
              <Text color={COLORS.WHITE}>{"<"}</Text>
              <Text color={COLORS.HIGHLIGHT}>]</Text>
              {" "}Previous
            </Text>
          ) : (
            <Text color={COLORS.MUTED}>{"   "}Previous</Text>
          )}
        </Box>

        {/* Page indicators with text for accessibility */}
        <Box gap={1}>
          {/* Always show page X of Y as text for screen readers */}
          <Text color={COLORS.DIM}>
            Page {currentPage + 1}/{totalPages}
          </Text>
          {totalPages <= 10 ? (
            // Show all page indicators if 10 or fewer pages
            // Visual dots complement the text indicator above
            Array.from({ length: totalPages }, (_, i) => (
              <Text
                key={`page-${i}`}
                color={i === currentPage ? COLORS.HIGHLIGHT : COLORS.DIM}
                bold={i === currentPage}
              >
                {i === currentPage ? "●" : "○"}
              </Text>
            ))
          ) : (
            // Condensed view for many pages
            <>
              <Text color={currentPage === 0 ? COLORS.HIGHLIGHT : COLORS.DIM}>
                {currentPage === 0 ? "●" : "○"}
              </Text>
              {currentPage > 1 && currentPage < totalPages - 2 && (
                <>
                  <Text color={COLORS.DIM}>...</Text>
                  <Text color={COLORS.HIGHLIGHT} bold>●</Text>
                  <Text color={COLORS.DIM}>...</Text>
                </>
              )}
              {currentPage === 1 && (
                <>
                  <Text color={COLORS.HIGHLIGHT} bold>●</Text>
                  <Text color={COLORS.DIM}>...</Text>
                </>
              )}
              {currentPage === totalPages - 2 && (
                <>
                  <Text color={COLORS.DIM}>...</Text>
                  <Text color={COLORS.HIGHLIGHT} bold>●</Text>
                </>
              )}
              <Text color={currentPage === totalPages - 1 ? COLORS.HIGHLIGHT : COLORS.DIM}>
                {currentPage === totalPages - 1 ? "●" : "○"}
              </Text>
            </>
          )}
        </Box>

        {/* Next button */}
        <Box>
          {currentPage < totalPages - 1 ? (
            <Text color={COLORS.ACCENT}>
              Next{" "}
              <Text color={COLORS.HIGHLIGHT}>[</Text>
              <Text color={COLORS.WHITE}>{">"}</Text>
              <Text color={COLORS.HIGHLIGHT}>]</Text>
            </Text>
          ) : (
            <Text color={COLORS.MUTED}>Next{"   "}</Text>
          )}
        </Box>
      </Box>

      {/* Keyboard hints */}
      {showHints && (
        <Box paddingX={1} marginTop={1}>
          <Text color={COLORS.DIM}>
            <Text color={COLORS.HIGHLIGHT}>Left/Right</Text> or{" "}
            <Text color={COLORS.HIGHLIGHT}>n/p</Text> navigate |{" "}
            <Text color={COLORS.HIGHLIGHT}>g/G</Text> first/last |{" "}
            <Text color={COLORS.HIGHLIGHT}>1-9</Text> go to page
          </Text>
        </Box>
      )}

      {/* Footer */}
      {footer && (
        <Box marginTop={1}>
          {footer}
        </Box>
      )}
    </Box>
  );
}

/**
 * Simple text pagination for string content
 */
interface PaginatedTextProps {
  /** The text content to paginate */
  content: string;
  /** Lines per page (default: 20) */
  linesPerPage?: number;
  /** Whether navigation is active */
  isActive?: boolean;
  /** Title for the content */
  title?: string;
}

export function PaginatedText({
  content,
  linesPerPage = 20,
  isActive = true,
  title,
}: PaginatedTextProps): React.ReactElement {
  const lines = useMemo(() => content.split("\n"), [content]);

  return (
    <PaginatedOutput
      items={lines}
      pageSize={linesPerPage}
      renderItem={(line, index) => (
        <Box key={index}>
          <Text color={COLORS.DIM}>{String(index + 1).padStart(4, " ")} </Text>
          <Text color={COLORS.WHITE}>{line}</Text>
        </Box>
      )}
      isActive={isActive}
      title={title}
    />
  );
}

/**
 * Hook for managing pagination state externally
 */
export function usePagination<T>(items: T[], pageSize: number = 20) {
  const [currentPage, setCurrentPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // Reset to first page when items change
  React.useEffect(() => {
    if (currentPage >= totalPages) {
      setCurrentPage(Math.max(0, totalPages - 1));
    }
  }, [items.length, totalPages, currentPage]);

  const pageItems = useMemo(() => {
    const startIndex = currentPage * pageSize;
    return items.slice(startIndex, startIndex + pageSize);
  }, [items, currentPage, pageSize]);

  return {
    currentPage,
    totalPages,
    pageItems,
    setPage: (page: number) => setCurrentPage(Math.max(0, Math.min(page, totalPages - 1))),
    nextPage: () => setCurrentPage(p => Math.min(p + 1, totalPages - 1)),
    prevPage: () => setCurrentPage(p => Math.max(p - 1, 0)),
    firstPage: () => setCurrentPage(0),
    lastPage: () => setCurrentPage(totalPages - 1),
    hasNext: currentPage < totalPages - 1,
    hasPrev: currentPage > 0,
    startIndex: currentPage * pageSize,
    endIndex: Math.min((currentPage + 1) * pageSize, items.length),
  };
}

export default PaginatedOutput;
