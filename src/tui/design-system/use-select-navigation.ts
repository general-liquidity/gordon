import { useState } from "react";
import { useInput } from "../ink-custom";

// ============================================================================
// useSelectNavigation — Arrow-key navigation with wrap-around and Enter-to-select
// ============================================================================

interface UseSelectNavigationOptions {
  itemCount: number;
  isActive?: boolean;
  onSelect?: (index: number) => void;
}

interface UseSelectNavigationResult {
  index: number;
  setIndex: (i: number) => void;
}

export function useSelectNavigation({
  itemCount,
  isActive = true,
  onSelect,
}: UseSelectNavigationOptions): UseSelectNavigationResult {
  const [index, setIndexRaw] = useState(0);

  const setIndex = (i: number) => {
    if (itemCount === 0) return;
    setIndexRaw(Math.max(0, Math.min(itemCount - 1, i)));
  };

  useInput((_input, key) => {
    if (!isActive || itemCount === 0) return;

    if (key.upArrow) {
      setIndexRaw((prev) => (prev > 0 ? prev - 1 : itemCount - 1));
    } else if (key.downArrow) {
      setIndexRaw((prev) => (prev < itemCount - 1 ? prev + 1 : 0));
    } else if (key.return) {
      if (onSelect) {
        setIndexRaw((prev) => {
          onSelect(prev);
          return prev;
        });
      }
    }
  });

  return { index, setIndex };
}
