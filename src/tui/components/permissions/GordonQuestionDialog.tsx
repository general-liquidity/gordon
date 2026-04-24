import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { GordonSelect as Select } from "../../design-system/GordonSelect.js";

// ============================================================================
// GordonQuestionDialog — Gordon asks the user a clarifying question mid-task.
//
// If options are provided: render GordonSelect
// If no options: show a text-input hint (simplified: press Enter to skip or
//   indicate a default answer)
// Optional countdown for auto-dismiss (timeoutMs).
// ============================================================================

interface Props {
  question: string;
  options?: string[];
  timeoutMs?: number;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
}

export function GordonQuestionDialog({ question, options, timeoutMs, onAnswer, onSkip }: Props) {
  const [remainingMs, setRemainingMs] = useState(timeoutMs ?? 0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!timeoutMs || timeoutMs <= 0) return;
    const interval = setInterval(() => {
      setRemainingMs((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          clearInterval(interval);
          setTimedOut(true);
          onSkip();
        }
        return Math.max(0, next);
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timeoutMs, onSkip]);

  useInput((_, key) => {
    if (key.escape) onSkip();
  });

  if (timedOut) return null;

  const countdownSecs = Math.ceil(remainingMs / 1000);

  const selectOptions = options?.map((o) => ({ label: o, value: o })) ?? [];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyanBright"
        paddingX={2}
        paddingY={1}
      >
        <Text color="cyanBright" bold>{"?"} Gordon needs clarification</Text>
        <Text> </Text>
        <Text>{"  "}{question}</Text>
        <Text> </Text>
        {options && options.length > 0 ? (
          <Box paddingLeft={2}>
            <Select options={selectOptions} onChange={(v) => onAnswer(v)} />
          </Box>
        ) : (
          <Box paddingLeft={2} flexDirection="column">
            <Text dimColor>Type your answer and press Enter, or Esc to skip.</Text>
            <TextInput onSubmit={onAnswer} onSkip={onSkip} />
          </Box>
        )}
        {timeoutMs != null && timeoutMs > 0 && (
          <Text dimColor>{"  "}Auto-skip in {countdownSecs}s...</Text>
        )}
      </Box>
    </Box>
  );
}

// Minimal inline text input
function TextInput({ onSubmit, onSkip }: { onSubmit: (v: string) => void; onSkip: () => void }) {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
    } else if (key.escape) {
      onSkip();
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
    }
  });

  return (
    <Box>
      <Text color="cyanBright">{">"} </Text>
      <Text>{value}</Text>
      <Text color="cyanBright" inverse>{" "}</Text>
    </Box>
  );
}
