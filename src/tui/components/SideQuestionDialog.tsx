import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Dialog } from "../design-system/Dialog.js";
import type { SideQuestion } from "../services/sideQuestion.js";

// ============================================================================
// SideQuestionDialog — UI for mid-analysis clarification questions
//
// If question has options: numbered list with arrow key selection
// If no options: text input for free-text answer
// Shows context: "While analyzing BTC/USDT, the agent needs to know:"
// ============================================================================

interface Props {
  question: SideQuestion;
  onAnswer: (response: string) => void;
  onDismiss: () => void;
}

export function SideQuestionDialog({ question, onAnswer, onDismiss }: Props) {
  const hasOptions = question.options && question.options.length > 0;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [freeText, setFreeText] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      onDismiss();
      return;
    }

    if (hasOptions) {
      const opts = question.options!;
      if (key.upArrow) {
        setSelectedIndex((p) => (p - 1 + opts.length) % opts.length);
      } else if (key.downArrow) {
        setSelectedIndex((p) => (p + 1) % opts.length);
      } else if (key.return) {
        onAnswer(opts[selectedIndex]!);
      }
    } else {
      if (key.return && freeText.length > 0) {
        onAnswer(freeText);
      } else if (key.backspace || key.delete) {
        setFreeText((p) => p.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setFreeText((p) => p + input);
      }
    }
  });

  return (
    <Dialog title="Agent Question" color="cyan" onClose={onDismiss}>
      {question.context ? (
        <Text dimColor>While {question.context}, the agent needs to know:</Text>
      ) : null}

      <Box marginTop={1}>
        <Text bold color="cyanBright">{question.question}</Text>
      </Box>

      {hasOptions ? (
        <Box flexDirection="column" marginTop={1}>
          {question.options!.map((opt, i) => (
            <Box key={opt}>
              <Text color={i === selectedIndex ? "cyanBright" : undefined} bold={i === selectedIndex}>
                {i === selectedIndex ? "\u25B8 " : "  "}{i + 1}. {opt}
              </Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>{"> "}</Text>
          <Text>{freeText}</Text>
          <Text color="cyanBright">{"\u2588"}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {hasOptions ? "\u2191\u2193 to select \u00B7 Enter to confirm" : "Type answer \u00B7 Enter to submit"}
          {" \u00B7 Esc to dismiss"}
        </Text>
      </Box>
    </Dialog>
  );
}
