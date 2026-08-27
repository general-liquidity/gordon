import { useState, useCallback } from "react";

// ============================================================================
// useSessionBackgrounding — Ctrl+B to background/foreground agent tasks
// ============================================================================

export function useSessionBackgrounding() {
  const [backgroundedTaskId, setBackgroundedTaskId] = useState<string | null>(null);

  const background = useCallback(() => {
    const taskId = `bg_${Date.now()}`;
    setBackgroundedTaskId(taskId);
    return taskId;
  }, []);

  const foreground = useCallback(
    (taskId: string) => {
      if (backgroundedTaskId === taskId) {
        setBackgroundedTaskId(null);
      }
    },
    [backgroundedTaskId],
  );

  return {
    backgroundedTaskId,
    isBackgrounded: backgroundedTaskId !== null,
    background,
    foreground,
  };
}
