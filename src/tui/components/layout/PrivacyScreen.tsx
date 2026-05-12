/**
 * PrivacyScreen — Masks dollar amounts when active
 *
 * When enabled, replaces dollar amounts ($123.45, $1,234) with $***.
 * Wraps children and transforms all Text output containing dollar signs.
 *
 * Phase 17 of the TUI rebuild.
 */

import React, { createContext, useContext, type ReactNode } from "react";
import { Text } from "../../ink-custom";

// ============================================================================
// Dollar masking regex
// ============================================================================

/**
 * Matches dollar amounts: $1, $12.34, $1,234.56, -$500, etc.
 * Captures the dollar sign and replaces the numeric portion with ***.
 */
const DOLLAR_PATTERN = /(-?\$[\d,]+(?:\.\d{1,2})?)/g;

function maskDollars(text: string): string {
  return text.replace(DOLLAR_PATTERN, "$***");
}

// ============================================================================
// Context — lets children query privacy state
// ============================================================================

interface PrivacyContextValue {
  privacyActive: boolean;
  mask: (text: string) => string;
}

const PrivacyContext = createContext<PrivacyContextValue>({
  privacyActive: false,
  mask: (t) => t,
});

export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext);
}

// ============================================================================
// Component
// ============================================================================

interface Props {
  active: boolean;
  children: ReactNode;
}

/**
 * Wraps child tree with privacy masking context. Components that render
 * dollar amounts can call `usePrivacy().mask(text)` to conditionally
 * redact values.
 *
 * @example
 *   <PrivacyScreen active={privacyMode}>
 *     <ChatView />
 *   </PrivacyScreen>
 */
export function PrivacyScreen({ active, children }: Props) {
  const mask = active ? maskDollars : (t: string) => t;

  return (
    <PrivacyContext.Provider value={{ privacyActive: active, mask }}>
      {children}
    </PrivacyContext.Provider>
  );
}

// ============================================================================
// PrivacyText — convenience wrapper that auto-masks
// ============================================================================

interface PrivacyTextProps {
  children: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

/**
 * Drop-in replacement for Ink <Text> that automatically masks dollar
 * amounts when privacy mode is active.
 */
export function PrivacyText({ children, ...rest }: PrivacyTextProps) {
  const { mask } = usePrivacy();
  return <Text {...rest}>{mask(children)}</Text>;
}
