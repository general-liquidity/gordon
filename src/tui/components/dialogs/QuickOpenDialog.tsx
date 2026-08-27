import { useState, useMemo } from "react";
import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// QuickOpenDialog — Ctrl+Shift+P fuzzy finder for strategies, playbooks,
// indicator configs, and memory files with content preview.
// ============================================================================

export interface QuickOpenItem {
  id: string;
  label: string;
  category: "strategy" | "playbook" | "indicator" | "memory" | "config";
  path?: string;
  preview?: string;
}

interface Props {
  items: QuickOpenItem[];
  onClose: () => void;
  onSelect?: (item: QuickOpenItem) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  strategy: "magenta",
  playbook: "cyan",
  indicator: "blue",
  memory: "green",
  config: "yellow",
};

export function QuickOpenDialog({ items, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return items.slice(0, 20);
    const lower = query.toLowerCase();
    return items
      .filter((item) => item.label.toLowerCase().includes(lower) || item.category.includes(lower))
      .slice(0, 20);
  }, [items, query]);

  useInput((input, key) => {
    if (key.escape) onClose();
    else if (key.return && filtered[selectedIndex]) onSelect?.(filtered[selectedIndex]!);
    else if (key.upArrow) setSelectedIndex((p) => Math.max(0, p - 1));
    else if (key.downArrow) setSelectedIndex((p) => Math.min(filtered.length - 1, p + 1));
    else if (key.backspace) {
      setQuery((p) => p.slice(0, -1));
      setSelectedIndex(0);
    } else if (input && !key.ctrl && !key.meta) {
      setQuery((p) => p + input);
      setSelectedIndex(0);
    }
  });

  const focused = filtered[selectedIndex];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyanBright" paddingX={1}>
      <Text bold color="cyanBright">
        QUICK OPEN
      </Text>
      <Box>
        <Text dimColor>&gt; </Text>
        <Text color="cyanBright">{query}</Text>
        <Text color="cyanBright">{"\u2588"}</Text>
        {!query && <Text dimColor>Type to search strategies, playbooks, configs...</Text>}
      </Box>
      <Box flexDirection="row">
        {/* Results list */}
        <Box flexDirection="column" flexGrow={1}>
          {filtered.map((item, i) => (
            <Box key={item.id}>
              <Text color={i === selectedIndex ? "cyanBright" : undefined}>
                {i === selectedIndex ? "\u25B8 " : "  "}
              </Text>
              <Text color={CATEGORY_COLORS[item.category]} bold>
                {item.category.slice(0, 4).toUpperCase().padEnd(5)}
              </Text>
              <Text bold={i === selectedIndex}>{item.label}</Text>
              {item.path ? <Text dimColor> {item.path}</Text> : null}
            </Box>
          ))}
          <Box justifyContent="flex-end">
            <Text dimColor>
              {filtered.length} of {items.length} {"\u00B7"} Enter to open {"\u00B7"} Esc to close
            </Text>
          </Box>
        </Box>
        {/* Preview pane */}
        {focused?.preview ? (
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor="gray"
            width={40}
            paddingX={1}
            marginLeft={1}
          >
            <Text dimColor>{focused.preview.slice(0, 300)}</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
