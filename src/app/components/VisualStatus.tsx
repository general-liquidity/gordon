/**
 * Visual Status Hierarchy Component
 * Provides size + color + animation for urgency levels
 *
 * Urgency Levels:
 * - info: Small, static, blue
 * - warning: Medium, subtle pulse, yellow
 * - critical: Large, urgent blink, red
 * - success: Medium, static, green
 *
 * Features:
 * - Animated indicators for urgent alerts
 * - Size variation based on importance
 * - Consistent visual language across the app
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../theme.ts";
import { DeskPanel } from "./desk/DeskPanel.tsx";
import { TicketCard } from "./desk/TicketCard.tsx";

// ============================================================================
// Types
// ============================================================================

export type UrgencyLevel = "info" | "success" | "warning" | "critical";

export interface VisualStatusProps {
  /** Urgency level determines size, color, and animation */
  level: UrgencyLevel;
  /** Main message to display */
  message: string;
  /** Optional secondary details */
  details?: string;
  /** Icon to display (defaults based on level) */
  icon?: string;
  /** Whether to animate (defaults true for warning/critical) */
  animate?: boolean;
  /** Custom animation speed in ms (default: 500) */
  animationSpeed?: number;
}

export interface StatusBadgeProps {
  /** Urgency level */
  level: UrgencyLevel;
  /** Label text */
  label: string;
  /** Show animation */
  animate?: boolean;
}

export interface AlertBannerProps {
  /** Urgency level */
  level: UrgencyLevel;
  /** Alert title */
  title: string;
  /** Alert message */
  message: string;
  /** Optional action hint */
  action?: string;
  /** Whether to auto-dismiss (critical alerts don't auto-dismiss) */
  autoDismiss?: boolean;
  /** Auto-dismiss delay in ms (default: 5000) */
  dismissDelay?: number;
}

// ============================================================================
// Configuration
// ============================================================================

const LEVEL_CONFIG: Record<UrgencyLevel, {
  icon: string;
  color: string;
  bgColor: string;
  size: "small" | "medium" | "large";
  animate: boolean;
  animationType: "pulse" | "blink" | "none";
  prefix: string;
}> = {
  info: {
    icon: "ℹ",
    color: COLORS.DISCOVER,
    bgColor: "#12363c",
    size: "small",
    animate: false,
    animationType: "none",
    prefix: "INFO",
  },
  success: {
    icon: "✓",
    color: COLORS.GREEN,
    bgColor: "#1a3d1a",
    size: "medium",
    animate: false,
    animationType: "none",
    prefix: "SUCCESS",
  },
  warning: {
    icon: "⚠",
    color: COLORS.YELLOW,
    bgColor: "#3d3d1a",
    size: "medium",
    animate: true,
    animationType: "pulse",
    prefix: "WARNING",
  },
  critical: {
    icon: "✕",
    color: COLORS.RED,
    bgColor: "#3d1a1a",
    size: "large",
    animate: true,
    animationType: "blink",
    prefix: "CRITICAL",
  },
};

const SIZE_CONFIG = {
  small: { paddingX: 1, paddingY: 0, textSize: "normal" as const },
  medium: { paddingX: 2, paddingY: 1, textSize: "normal" as const },
  large: { paddingX: 3, paddingY: 1, textSize: "bold" as const },
};

// ============================================================================
// Animation Hooks
// ============================================================================

/**
 * Hook for pulsing animation (subtle brightness change)
 */
function usePulseAnimation(enabled: boolean, speed: number = 500): boolean {
  const [isBright, setIsBright] = useState(true);

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      setIsBright((prev) => !prev);
    }, speed);

    return () => clearInterval(interval);
  }, [enabled, speed]);

  return isBright;
}

/**
 * Hook for blinking animation (urgent on/off)
 */
function useBlinkAnimation(enabled: boolean, speed: number = 300): boolean {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      setIsVisible((prev) => !prev);
    }, speed);

    return () => clearInterval(interval);
  }, [enabled, speed]);

  return isVisible;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Visual Status Indicator
 * Main component for displaying status with visual hierarchy
 *
 * @example
 * ```tsx
 * <VisualStatus level="critical" message="Connection lost" details="Check API keys" />
 * <VisualStatus level="warning" message="Rate limit approaching" />
 * <VisualStatus level="info" message="Scan complete" details="Found 5 opportunities" />
 * ```
 */
export const VisualStatus: React.FC<VisualStatusProps> = ({
  level,
  message,
  details,
  icon,
  animate,
  animationSpeed,
}) => {
  const config = LEVEL_CONFIG[level];
  const size = SIZE_CONFIG[config.size];
  const shouldAnimate = animate ?? config.animate;

  // Use appropriate animation based on level
  const isPulseBright = usePulseAnimation(
    shouldAnimate && config.animationType === "pulse",
    animationSpeed ?? 600
  );
  const isBlinkVisible = useBlinkAnimation(
    shouldAnimate && config.animationType === "blink",
    animationSpeed ?? 300
  );

  // Determine display state
  const displayIcon = icon ?? config.icon;
  const displayColor = config.color;
  const isDimmed = shouldAnimate && config.animationType === "pulse" && !isPulseBright;

  // Don't render if blinking and currently off
  if (shouldAnimate && config.animationType === "blink" && !isBlinkVisible) {
    return null;
  }

  return (
    <DeskPanel
      tone={level === "critical" ? "danger" : level === "warning" ? "warning" : level === "success" ? "success" : "info"}
      compact={config.size === "small"}
    >
      <Box>
        <Text
          color={isDimmed ? COLORS.MUTED : displayColor}
          bold={size.textSize === "bold"}
        >
          {displayIcon} [{config.prefix}]
        </Text>
        <Text
          color={isDimmed ? COLORS.MUTED : COLORS.WHITE}
          bold={size.textSize === "bold"}
        >
          {" "}{message}
        </Text>
      </Box>
      {details && (
        <Box marginTop={size.paddingY > 0 ? 1 : 0} marginLeft={3}>
          <Text color={COLORS.DIM}>{details}</Text>
        </Box>
      )}
    </DeskPanel>
  );
};

/**
 * Status Badge
 * Compact status indicator for inline use
 *
 * @example
 * ```tsx
 * <StatusBadge level="critical" label="ARMED" />
 * <StatusBadge level="warning" label="Rate Limited" animate />
 * ```
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  level,
  label,
  animate,
}) => {
  const config = LEVEL_CONFIG[level];
  const shouldAnimate = animate ?? config.animate;

  const isPulseBright = usePulseAnimation(
    shouldAnimate && config.animationType === "pulse",
    600
  );
  const isBlinkVisible = useBlinkAnimation(
    shouldAnimate && config.animationType === "blink",
    300
  );

  if (shouldAnimate && config.animationType === "blink" && !isBlinkVisible) {
    return <Text> </Text>; // Preserve space while blinking
  }

  const displayColor = shouldAnimate && config.animationType === "pulse" && !isPulseBright
    ? COLORS.MUTED
    : config.color;

  // Size-based styling
  const padding = config.size === "large" ? " " : "";
  const brackets = config.size === "large" ? ["[", "]"] : ["", ""];

  return (
    <Text color={displayColor} bold={config.size === "large"}>
      {brackets[0]}{padding}{label}{padding}{brackets[1]}
    </Text>
  );
};

/**
 * Alert Banner
 * Full-width alert for important notifications
 *
 * @example
 * ```tsx
 * <AlertBanner
 *   level="critical"
 *   title="Trading Halted"
 *   message="Maximum drawdown exceeded"
 *   action="Review positions with /portfolio"
 * />
 * ```
 */
export const AlertBanner: React.FC<AlertBannerProps> = ({
  level,
  title,
  message,
  action,
  autoDismiss,
  dismissDelay = 5000,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const config = LEVEL_CONFIG[level];

  // Auto-dismiss for non-critical alerts
  useEffect(() => {
    if (autoDismiss && level !== "critical") {
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, dismissDelay);
      return () => clearTimeout(timer);
    }
  }, [autoDismiss, dismissDelay, level]);

  const isBlinkVisible = useBlinkAnimation(
    config.animate && config.animationType === "blink",
    300
  );

  if (!isVisible) return null;
  if (config.animate && config.animationType === "blink" && !isBlinkVisible) {
    return <Box height={config.size === "large" ? 3 : 2} />; // Preserve space
  }

  const size = SIZE_CONFIG[config.size];

  return (
    <Box width="100%">
      <TicketCard
        eyebrow={config.prefix}
        title={title.toUpperCase()}
        subtitle={message}
        tone={level === "critical" ? "danger" : level === "warning" ? "warning" : level === "success" ? "success" : "info"}
        actions={action ? [`Action: ${action}`] : undefined}
      />
    </Box>
  );
};

/**
 * Trading Mode Indicator
 * Specialized component for SAFE/ARMED mode display with user-facing labels
 */
export interface TradingModeIndicatorProps {
  mode: "SAFE" | "ARMED";
  /** Time remaining when armed (in minutes) */
  timeRemaining?: number;
  /** Whether to show animation when armed */
  animate?: boolean;
}

export const TradingModeIndicator: React.FC<TradingModeIndicatorProps> = ({
  mode,
  timeRemaining,
  animate = true,
}) => {
  const isArmed = mode === "ARMED";
  const level: UrgencyLevel = isArmed ? "critical" : "success";
  const config = LEVEL_CONFIG[level];

  const isBlinkVisible = useBlinkAnimation(
    animate && isArmed,
    400
  );

  const label = isArmed
    ? timeRemaining
      ? `Live enabled (${timeRemaining}m)`
      : "Live enabled"
    : "Read-only";

  if (isArmed && animate && !isBlinkVisible) {
    return <Text color={COLORS.MUTED}>{label}</Text>;
  }

  return (
    <Text color={config.color} bold>
      {label}
    </Text>
  );
};

/**
 * Connection Status with Visual Hierarchy
 */
export interface ConnectionStatusProps {
  status: "connected" | "disconnected" | "connecting" | "error";
  service: string;
  /** Show animation on error */
  animate?: boolean;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  status,
  service,
  animate = true,
}) => {
  const levelMap: Record<typeof status, UrgencyLevel> = {
    connected: "success",
    disconnected: "critical",
    connecting: "info",
    error: "warning",
  };

  const level = levelMap[status];
  const config = LEVEL_CONFIG[level];

  const isPulseBright = usePulseAnimation(
    animate && status === "connecting",
    400
  );

  const displayColor = status === "connecting" && !isPulseBright
    ? COLORS.MUTED
    : config.color;

  const labels: Record<typeof status, string> = {
    connected: "●",
    disconnected: "○",
    connecting: "◐",
    error: "◑",
  };

  return (
    <Box>
      <Text color={displayColor}>{labels[status]}</Text>
      <Text color={COLORS.DIM}> {service}</Text>
    </Box>
  );
};

/**
 * Progress Indicator with Visual Status
 */
export interface ProgressStatusProps {
  /** Current progress (0-100) */
  progress: number;
  /** Status level */
  level?: UrgencyLevel;
  /** Operation name */
  operation: string;
  /** Show percentage */
  showPercentage?: boolean;
}

export const ProgressStatus: React.FC<ProgressStatusProps> = ({
  progress,
  level = "info",
  operation,
  showPercentage = true,
}) => {
  const config = LEVEL_CONFIG[level];
  const filled = Math.round(progress / 5); // 20 segments
  const empty = 20 - filled;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={config.color}>{config.icon}</Text>
        <Text color={COLORS.WHITE}> {operation}</Text>
        {showPercentage && (
          <Text color={COLORS.DIM}> {progress.toFixed(0)}%</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={config.color}>{"█".repeat(filled)}</Text>
        <Text color={COLORS.MUTED}>{"░".repeat(empty)}</Text>
      </Box>
    </Box>
  );
};

// ============================================================================
// Export
// ============================================================================

export default {
  VisualStatus,
  StatusBadge,
  AlertBanner,
  TradingModeIndicator,
  ConnectionStatus,
  ProgressStatus,
};
