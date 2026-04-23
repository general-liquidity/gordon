import { useState } from "react";

// ============================================================================
// useSelectState — Index + value state for a list of options
// ============================================================================

export interface SelectState<T> {
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  selectedValue: T | undefined;
  selectNext: () => void;
  selectPrev: () => void;
  reset: () => void;
}

export function useSelectState<T>(
  options: Array<{ value: T }>,
  initialIndex = 0,
): SelectState<T> {
  const clamp = (i: number) => Math.max(0, Math.min(options.length - 1, i));

  const [selectedIndex, setSelectedIndexRaw] = useState<number>(() =>
    options.length === 0 ? 0 : clamp(initialIndex),
  );

  const setSelectedIndex = (i: number) => {
    if (options.length === 0) return;
    setSelectedIndexRaw(clamp(i));
  };

  const selectNext = () => {
    if (options.length === 0) return;
    setSelectedIndexRaw((prev) => (prev < options.length - 1 ? prev + 1 : 0));
  };

  const selectPrev = () => {
    if (options.length === 0) return;
    setSelectedIndexRaw((prev) => (prev > 0 ? prev - 1 : options.length - 1));
  };

  const reset = () => setSelectedIndexRaw(options.length === 0 ? 0 : clamp(initialIndex));

  const selectedValue = options[selectedIndex]?.value;

  return {
    selectedIndex,
    setSelectedIndex,
    selectedValue,
    selectNext,
    selectPrev,
    reset,
  };
}
