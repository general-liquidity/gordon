import { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

export interface EditablePlan {
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  sizeUsd: number;
  confidence: number;
}

type FieldKey = "entry" | "stopLoss" | "takeProfit" | "sizeUsd";

interface Props {
  plan: EditablePlan;
  onSave: (edited: EditablePlan) => void;
  onCancel: () => void;
  onApprove: (edited: EditablePlan) => void;
}

export function PlanEditor({ plan, onSave, onCancel, onApprove }: Props) {
  const [draft, setDraft] = useState<EditablePlan>({ ...plan });
  const [focused, setFocused] = useState<FieldKey>("entry");
  const [editValue, setEditValue] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);

  const fields: Array<{
    key: FieldKey;
    label: string;
    value: number;
    format: (n: number) => string;
  }> = [
    { key: "entry", label: "Entry", value: draft.entry, format: (n) => `$${n.toFixed(2)}` },
    {
      key: "stopLoss",
      label: "Stop Loss",
      value: draft.stopLoss,
      format: (n) => `$${n.toFixed(2)}`,
    },
    {
      key: "takeProfit",
      label: "Take Profit",
      value: draft.takeProfit,
      format: (n) => `$${n.toFixed(2)}`,
    },
    {
      key: "sizeUsd",
      label: "Size (USD)",
      value: draft.sizeUsd,
      format: (n) => `$${n.toFixed(0)}`,
    },
  ];

  const currentIdx = fields.findIndex((f) => f.key === focused);

  useInput((input, key) => {
    if (isEditing) {
      if (key.return) {
        const num = parseFloat(editValue);
        if (!Number.isNaN(num) && num > 0) {
          setDraft({ ...draft, [focused]: num });
        }
        setIsEditing(false);
        setEditValue("");
      } else if (key.escape) {
        setIsEditing(false);
        setEditValue("");
      } else if (key.backspace) {
        setEditValue((v) => v.slice(0, -1));
      } else if (input && /[\d.]/.test(input)) {
        setEditValue((v) => v + input);
      }
      return;
    }

    if (key.escape) onCancel();
    else if (key.upArrow) setFocused(fields[(currentIdx - 1 + fields.length) % fields.length]!.key);
    else if (key.downArrow) setFocused(fields[(currentIdx + 1) % fields.length]!.key);
    else if (input === "e") {
      setIsEditing(true);
      setEditValue(String(draft[focused]));
    } else if (key.return) onApprove(draft);
    else if (input === "s") onSave(draft);
  });

  // Compute risk/reward preview
  const riskAmount = (Math.abs(draft.entry - draft.stopLoss) / draft.entry) * draft.sizeUsd;
  const rewardAmount = (Math.abs(draft.takeProfit - draft.entry) / draft.entry) * draft.sizeUsd;
  const rr = riskAmount > 0 ? rewardAmount / riskAmount : 0;

  return (
    <Pane title={`EDIT PLAN — ${draft.symbol} ${draft.side}`} tone="warning">
      <Box flexDirection="column">
        {fields.map((f) => {
          const isFocused = f.key === focused;
          return (
            <Box key={f.key}>
              <Text color={isFocused ? "cyanBright" : undefined}>{isFocused ? "▸ " : "  "}</Text>
              <Text bold={isFocused}>{f.label.padEnd(14)}</Text>
              {isEditing && isFocused ? (
                <Text color="cyanBright">{editValue}█</Text>
              ) : (
                <Text>{f.format(f.value)}</Text>
              )}
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text dimColor>Risk: </Text>
          <Text color="red">${riskAmount.toFixed(0)}</Text>
          <Text dimColor> Reward: </Text>
          <Text color="green">${rewardAmount.toFixed(0)}</Text>
          <Text dimColor> R:R </Text>
          <Text bold color={rr >= 2 ? "green" : rr >= 1 ? "yellow" : "red"}>
            {rr.toFixed(1)}:1
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>↑↓ select · [e] edit · [s] save · Enter approve · Esc cancel</Text>
        </Box>
      </Box>
    </Pane>
  );
}
