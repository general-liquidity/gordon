import React, { createContext, isValidElement, type ReactNode, useContext } from "react";
import { Box, Text } from "../ink-custom";
import type { GordonTheme } from "../themes/themes.ts";
import { useTheme } from "../themes/ThemeProvider.tsx";

// ============================================================================
// OrderedList / OrderedListItem: auto-numbered, column-aligned, nestable list
//
//  1. First item          (markers right-aligned so the dots line up)
//  2. Second item
//    2.1. Nested item      (dotted prefix composed via React context)
//    2.2. Nested item
// 10. Tenth item           (marker column widens automatically at 2 digits)
//
// Markers derive from child position; the width comes from the item count so
// single- and multi-digit lists stay aligned. Marker colour is the active
// theme's uiMuted token: UI chrome, never a money/risk colour.
// ============================================================================

const OrderedListContext = createContext<{ marker: string }>({ marker: "" });
const OrderedListItemContext = createContext<{ marker: string }>({ marker: "" });

/**
 * Right-aligned, dot-suffixed marker for `index` (0-based) within a list of
 * `count` items, prefixed by any parent-list marker so nesting composes:
 * a parent marker of "1." yields "1.1.", "1.2.", … for the child list.
 */
export function orderedListMarker(index: number, count: number, parentMarker = ""): string {
  const width = String(count).length;
  const padded = `${String(index + 1).padStart(width)}.`;
  return `${parentMarker}${padded}`;
}

/** Marker colour: muted UI chrome, kept off the money/risk palette. */
export function orderedMarkerColor(theme: GordonTheme): string {
  return theme.uiMuted;
}

interface OrderedListItemProps {
  children: ReactNode;
}

export function OrderedListItem({ children }: OrderedListItemProps) {
  const { marker } = useContext(OrderedListItemContext);
  const theme = useTheme();

  return (
    <Box gap={1}>
      <Text color={orderedMarkerColor(theme)}>{marker}</Text>
      <Box flexDirection="column">{children}</Box>
    </Box>
  );
}

interface OrderedListProps {
  children: ReactNode;
}

function OrderedListComponent({ children }: OrderedListProps) {
  const { marker: parentMarker } = useContext(OrderedListContext);

  let count = 0;
  for (const child of React.Children.toArray(children)) {
    if (isValidElement(child) && child.type === OrderedListItem) count++;
  }

  return (
    <Box flexDirection="column">
      {React.Children.map(children, (child, index) => {
        if (!isValidElement(child) || child.type !== OrderedListItem) return child;
        const marker = orderedListMarker(index, count, parentMarker);
        return (
          <OrderedListContext.Provider value={{ marker }}>
            <OrderedListItemContext.Provider value={{ marker }}>
              {child}
            </OrderedListItemContext.Provider>
          </OrderedListContext.Provider>
        );
      })}
    </Box>
  );
}

export const OrderedList = Object.assign(OrderedListComponent, { Item: OrderedListItem });
