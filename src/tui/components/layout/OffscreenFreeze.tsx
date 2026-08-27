import { useRef, type ReactNode } from "react";

// ============================================================================
// OffscreenFreeze — Performance optimization via cached renders
//
// When frozen=true, returns the last cached render instead of re-rendering
// children. Prevents offscreen spinners, timers, and animations from
// consuming CPU.
// ============================================================================

interface Props {
  frozen: boolean;
  children: ReactNode;
}

export function OffscreenFreeze({ frozen, children }: Props) {
  const cachedRef = useRef<ReactNode>(children);

  if (!frozen) {
    cachedRef.current = children;
  }

  return <>{cachedRef.current}</>;
}
