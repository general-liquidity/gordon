/**
 * FeedbackSurvey — Post-trade outcome rating
 *
 * After a trade closes, prompts: "Rate this trade outcome (1-5)"
 * with Select + optional TextInput for notes.
 * Saves feedback to the memory system.
 *
 * Phase 17 of the TUI rebuild.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "../ink-custom";
import { Select, TextInput } from "@inkjs/ui";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Types
// ============================================================================

export interface TradeFeedback {
  tradeId: string;
  symbol: string;
  rating: number;
  notes: string;
  timestamp: string;
}

interface Props {
  tradeId: string;
  symbol: string;
  pnl?: number;
  pnlPercent?: number;
  onComplete: (feedback: TradeFeedback) => void;
  onSkip: () => void;
}

// ============================================================================
// Persistence
// ============================================================================

const FEEDBACK_DIR = path.join(os.homedir(), ".gordon", "feedback");

function saveFeedback(feedback: TradeFeedback): void {
  try {
    if (!fs.existsSync(FEEDBACK_DIR)) {
      fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
    }
    const filePath = path.join(
      FEEDBACK_DIR,
      `${feedback.symbol}-${feedback.tradeId}.json`,
    );
    fs.writeFileSync(filePath, JSON.stringify(feedback, null, 2), "utf-8");
  } catch {
    // Best-effort persistence
  }
}

// ============================================================================
// Component
// ============================================================================

export function FeedbackSurvey({
  tradeId,
  symbol,
  pnl,
  pnlPercent,
  onComplete,
  onSkip,
}: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<"rating" | "notes" | "done">("rating");

  useInput((_, key) => {
    if (key.escape) onSkip();
  });

  const handleRating = useCallback((value: string) => {
    const num = Number(value);
    setRating(num);
    setPhase("notes");
  }, []);

  const handleNotesSubmit = useCallback(
    (value: string) => {
      const feedback: TradeFeedback = {
        tradeId,
        symbol,
        rating: rating!,
        notes: value,
        timestamp: new Date().toISOString(),
      };
      saveFeedback(feedback);
      setPhase("done");
      onComplete(feedback);
    },
    [tradeId, symbol, rating, onComplete],
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box>
        <Text bold color="yellow">TRADE FEEDBACK</Text>
        <Text dimColor> — {symbol}</Text>
      </Box>

      {/* P&L summary */}
      {pnl != null && (
        <Box paddingLeft={2}>
          <Text>
            P&L:{" "}
            <Text bold color={pnl >= 0 ? "green" : "red"}>
              {pnl >= 0 ? "+" : ""}
              {pnl.toFixed(2)}
            </Text>
            {pnlPercent != null && (
              <Text dimColor>
                {" "}({pnlPercent >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}%)
              </Text>
            )}
          </Text>
        </Box>
      )}
      <Text> </Text>

      {/* Rating phase */}
      {phase === "rating" && (
        <Box flexDirection="column">
          <Text>Rate this trade outcome (1-5):</Text>
          <Text> </Text>
          <Select
            options={[
              { label: "\u2605 1 — Poor", value: "1" },
              { label: "\u2605\u2605 2 — Below average", value: "2" },
              { label: "\u2605\u2605\u2605 3 — Average", value: "3" },
              { label: "\u2605\u2605\u2605\u2605 4 — Good", value: "4" },
              { label: "\u2605\u2605\u2605\u2605\u2605 5 — Excellent", value: "5" },
            ]}
            onChange={handleRating}
          />
        </Box>
      )}

      {/* Notes phase */}
      {phase === "notes" && (
        <Box flexDirection="column">
          <Text>
            Rating: <Text bold color="yellow">{rating}/5</Text>
          </Text>
          <Text> </Text>
          <Text dimColor>Add notes (optional, Enter to submit):</Text>
          <Box paddingLeft={2}>
            <Text color="yellow">{"\u25B6"} </Text>
            <TextInput
              placeholder="What went well or poorly..."
              onSubmit={handleNotesSubmit}
            />
          </Box>
        </Box>
      )}

      {/* Done */}
      {phase === "done" && (
        <Text color="green">{"\u2713"} Feedback saved</Text>
      )}

      <Text> </Text>
      <Text dimColor>Esc to skip</Text>
    </Box>
  );
}
