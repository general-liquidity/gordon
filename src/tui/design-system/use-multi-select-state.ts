import { useState } from "react";

// ============================================================================
// useMultiSelectState — Toggle-based multi-selection state
// ============================================================================

export interface MultiSelectState<T> {
  selected: T[];
  toggle: (value: T) => void;
  selectAll: (values: T[]) => void;
  clearAll: () => void;
  isSelected: (value: T) => boolean;
}

export function useMultiSelectState<T>(initialSelected?: T[]): MultiSelectState<T> {
  const [selected, setSelected] = useState<T[]>(initialSelected ?? []);

  const toggle = (value: T) => {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  const selectAll = (values: T[]) => {
    setSelected((prev) => {
      const merged = [...prev];
      for (const v of values) {
        if (!merged.includes(v)) merged.push(v);
      }
      return merged;
    });
  };

  const clearAll = () => setSelected([]);

  const isSelected = (value: T) => selected.includes(value);

  return { selected, toggle, selectAll, clearAll, isSelected };
}
