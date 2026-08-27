/**
 * StatusNotices — Stacked overlay notice banners for urgent trading alerts.
 *
 * Appears above the input area (NOT in the chat stream). Supports four
 * variants: error, warning, info, success. Dismissible notices show a
 * [D] hint; pressing 'd' dismisses the topmost dismissible notice.
 *
 * Max 5 notices rendered at once (oldest hidden when exceeded).
 */

import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// Types
// ============================================================================

export interface StatusNotice {
  id: string;
  message: string;
  variant: "error" | "warning" | "info" | "success";
  dismissible?: boolean;
}

interface Props {
  notices: StatusNotice[];
  onDismiss: (id: string) => void;
}

// ============================================================================
// Variant config
// ============================================================================

const VARIANT_CONFIG = {
  error: { icon: "✗", color: "red" },
  warning: { icon: "⚠", color: "yellow" },
  info: { icon: "ℹ", color: "cyan" },
  success: { icon: "✓", color: "green" },
} as const;

// ============================================================================
// Component
// ============================================================================

export function StatusNotices({ notices, onDismiss }: Props) {
  const visible = notices.slice(0, 5);

  useInput((input) => {
    if (input === "d" || input === "D") {
      // Dismiss the first dismissible notice
      const target = visible.find((n) => n.dismissible);
      if (target) onDismiss(target.id);
    }
  });

  if (visible.length === 0) return null;

  return (
    <Box flexDirection="column">
      {visible.map((notice) => {
        const cfg = VARIANT_CONFIG[notice.variant];
        return (
          <Box key={notice.id} paddingX={1}>
            <Text color={cfg.color}>
              {cfg.icon} {notice.message}
            </Text>
            {notice.dismissible && <Text dimColor>{"  [D] dismiss"}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
