import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { getSprite } from "./sprites.js";
import { RARITY_COLORS, MOOD_COLORS, type Companion, type Mood } from "./types.js";

// ============================================================================
// CompanionSprite — Animated trading mascot with mood-based coloring
// ============================================================================

interface Props {
  companion: Companion;
  mood: Mood;
  showSpeechBubble?: boolean;
  speechText?: string;
}

export function CompanionSprite({ companion, mood, showSpeechBubble, speechText }: Props) {
  const [frame, setFrame] = useState(0);
  const [showSpeech, setShowSpeech] = useState(showSpeechBubble ?? false);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % 3);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (showSpeechBubble && speechText) {
      setShowSpeech(true);
      const timer = setTimeout(() => setShowSpeech(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [showSpeechBubble, speechText]);

  const spriteLines = getSprite(companion.species, frame);
  const color = MOOD_COLORS[mood];
  const rarityColor = RARITY_COLORS[companion.rarity];

  return (
    <Box flexDirection="column">
      {/* Speech bubble */}
      {showSpeech && speechText ? (
        <Box>
          <Text dimColor>{"\u256D"}{"\u2500".repeat(speechText.length + 2)}{"\u256E"}</Text>
        </Box>
      ) : null}
      {showSpeech && speechText ? (
        <Box>
          <Text dimColor>{"\u2502"} {speechText} {"\u2502"}</Text>
        </Box>
      ) : null}
      {showSpeech && speechText ? (
        <Box>
          <Text dimColor>{"\u2570"}{"\u2500".repeat(speechText.length + 2)}{"\u256F"}</Text>
        </Box>
      ) : null}

      {/* Sprite */}
      {spriteLines.map((line, i) => (
        <Box key={i}>
          <Text color={color}>{line}</Text>
        </Box>
      ))}

      {/* Name plate */}
      <Box>
        <Text color={rarityColor} bold={companion.rarity !== "Common"}>
          {companion.name}
        </Text>
        <Text dimColor> {"\u00B7"} {companion.species} {"\u00B7"} {companion.rarity}</Text>
        {companion.isShiny ? <Text color="yellowBright"> {"\u2728"}</Text> : null}
      </Box>
    </Box>
  );
}
