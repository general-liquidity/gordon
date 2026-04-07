import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { Select, TextInput } from "@inkjs/ui";

/**
 * ConfigEditor — Interactive config form
 *
 * Shows configurable settings as a navigable list.
 * Select a setting → see current value → edit inline.
 */

interface ConfigItem {
  key: string;
  label: string;
  category: string;
  currentValue: string;
  type: "text" | "select" | "boolean" | "number";
  options?: Array<{ label: string; value: string }>;
  description?: string;
}

interface Props {
  items: ConfigItem[];
  onSave: (key: string, value: string) => void;
  onCancel: () => void;
}

export function ConfigEditor({ items, onSave, onCancel }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.escape) {
      if (editingKey) setEditingKey(null);
      else onCancel();
    }
    if (!editingKey) {
      if (key.upArrow) setSelectedIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelectedIdx((i) => Math.min(items.length - 1, i + 1));
      if (key.return) {
        const item = items[selectedIdx];
        if (item) setEditingKey(item.key);
      }
    }
  });

  const editingItem = editingKey ? items.find((i) => i.key === editingKey) : null;

  if (editingItem) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyanBright">EDIT: {editingItem.label}</Text>
        {editingItem.description && <Text dimColor>{editingItem.description}</Text>}
        <Text dimColor>Current: {editingItem.currentValue}</Text>
        <Box marginTop={1}>
          {editingItem.type === "select" && editingItem.options ? (
            <Select
              options={editingItem.options}
              onChange={(v) => { onSave(editingItem.key, v); setEditingKey(null); }}
            />
          ) : editingItem.type === "boolean" ? (
            <Select
              options={[
                { label: "true", value: "true" },
                { label: "false", value: "false" },
              ]}
              onChange={(v) => { onSave(editingItem.key, v); setEditingKey(null); }}
            />
          ) : (
            <TextInput
              placeholder={editingItem.currentValue}
              onSubmit={(v) => { onSave(editingItem.key, v); setEditingKey(null); }}
            />
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel edit</Text>
        </Box>
      </Box>
    );
  }

  // Group by category
  const categories = [...new Set(items.map((i) => i.category))];
  let globalIdx = 0;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">CONFIGURATION</Text>
        <Text dimColor>  ({items.length} settings)</Text>
      </Box>

      {categories.map((cat) => {
        const catItems = items.filter((i) => i.category === cat);
        return (
          <Box key={cat} flexDirection="column" marginBottom={1}>
            <Text dimColor>{"  \u2500\u2500 "}{cat.toLowerCase()}{" \u2500\u2500"}</Text>
            {catItems.map((item) => {
              const idx = globalIdx++;
              const isFocused = idx === selectedIdx;
              return (
                <Box key={item.key}>
                  <Text color={isFocused ? "cyanBright" : undefined}>
                    {isFocused ? " \u25B8" : "  "}
                  </Text>
                  <Text color={isFocused ? "cyanBright" : undefined} bold={isFocused}>
                    {" "}{item.label.padEnd(24)}
                  </Text>
                  <Text dimColor={!isFocused}>{item.currentValue}</Text>
                </Box>
              );
            })}
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>{"\u2191\u2193"} navigate {"\u00B7"} Enter edit {"\u00B7"} Esc close</Text>
      </Box>
    </Box>
  );
}
