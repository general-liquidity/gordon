// ============================================================================
// useSelectInput — Filter options by query string (case-insensitive substring)
// ============================================================================

export interface SelectInputOption {
  label: string;
  value: string;
  description?: string;
}

export function useSelectInput(
  query: string,
  options: SelectInputOption[],
  opts?: { caseSensitive?: boolean },
): SelectInputOption[] {
  if (!query) return options;

  const caseSensitive = opts?.caseSensitive ?? false;
  const needle = caseSensitive ? query : query.toLowerCase();

  return options.filter((opt) => {
    const label = caseSensitive ? opt.label : opt.label.toLowerCase();
    const desc = opt.description
      ? caseSensitive
        ? opt.description
        : opt.description.toLowerCase()
      : "";
    return label.includes(needle) || desc.includes(needle);
  });
}
