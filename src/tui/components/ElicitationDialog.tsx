import React, { useState } from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// ElicitationDialog — Dynamic form from field definitions
// ============================================================================

export interface FormField { id: string; label: string; type: "text" | "select" | "boolean" | "number"; options?: string[]; required?: boolean; defaultValue?: any; }
interface Props { fields: FormField[]; onSubmit: (values: Record<string, any>) => void; onCancel: () => void; title?: string; }

export function ElicitationDialog({ fields, onSubmit, onCancel, title }: Props) {
  const [focusedField, setFocusedField] = useState(0);
  const [values, setValues] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const f of fields) init[f.id] = f.defaultValue ?? (f.type === "boolean" ? false : f.type === "number" ? 0 : "");
    return init;
  });

  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.tab) setFocusedField((p) => (p + 1) % fields.length);
    else if (key.return) {
      const missing = fields.filter((f) => f.required && !values[f.id]);
      if (missing.length === 0) onSubmit(values);
    }
    else {
      const field = fields[focusedField]!;
      if (field.type === "text" || field.type === "number") {
        if (key.backspace) setValues((p) => ({ ...p, [field.id]: String(p[field.id] ?? "").slice(0, -1) }));
        else if (input) setValues((p) => ({ ...p, [field.id]: (p[field.id] ?? "") + input }));
      } else if (field.type === "boolean") {
        if (input === " " || key.return) setValues((p) => ({ ...p, [field.id]: !p[field.id] }));
      } else if (field.type === "select" && field.options) {
        const curr = field.options.indexOf(values[field.id]);
        if (key.upArrow) setValues((p) => ({ ...p, [field.id]: field.options![(curr - 1 + field.options!.length) % field.options!.length] }));
        if (key.downArrow) setValues((p) => ({ ...p, [field.id]: field.options![(curr + 1) % field.options!.length] }));
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {title ? <Text bold color="cyanBright">{title}</Text> : null}
      {fields.map((field, i) => (
        <Box key={field.id}>
          <Text color={i === focusedField ? "cyanBright" : undefined} bold={i === focusedField}>
            {i === focusedField ? "\u25B8 " : "  "}{field.label}: </Text>
          <Text>{field.type === "boolean" ? (values[field.id] ? "[x]" : "[ ]") : String(values[field.id] ?? "")}</Text>
          {i === focusedField ? <Text color="cyanBright">{"\u2588"}</Text> : null}
          {field.required ? <Text color="red"> *</Text> : null}
        </Box>
      ))}
      <Text dimColor>Tab to next {"\u00B7"} Enter to submit {"\u00B7"} Esc to cancel</Text>
    </Box>
  );
}
