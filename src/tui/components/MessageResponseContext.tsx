import React, { createContext, useContext, type ReactNode } from "react";
import { Box } from "ink";
import { NoSelect } from "./NoSelect.js";

// ============================================================================
// MessageResponseContext — Prevents nested ⎿ hook characters
//
// Claude Code pattern: when a MessageResponse is rendered inside another
// MessageResponse, the inner one skips the hook prefix to avoid ⎿⎿ doubling.
// ============================================================================

const IsInsideResponseContext = createContext(false);

export function useIsInsideResponse(): boolean {
  return useContext(IsInsideResponseContext);
}

interface Props {
  children: ReactNode;
}

export function MessageResponse({ children }: Props) {
  const isNested = useIsInsideResponse();

  if (isNested) {
    // Already inside a response — don't add another hook
    return <>{children}</>;
  }

  return (
    <IsInsideResponseContext.Provider value={true}>
      <Box>
        <NoSelect>{"\u231F  "}</NoSelect>
        <Box flexDirection="column" flexGrow={1}>
          {children}
        </Box>
      </Box>
    </IsInsideResponseContext.Provider>
  );
}
