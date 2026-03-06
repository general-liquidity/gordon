import React, { useEffect, useMemo, useState } from "react";

export const GORDON_GLYPH_FRAMES = ["◆", "◇", "▲", "△"] as const;

const BASE_GORDON_LOADING_PHRASES = [
  "Reading the tape",
  "Checking liquidity pockets",
  "Sizing the risk",
  "Watching order flow",
  "Stress-testing the setup",
  "Looking for asymmetric edge",
];

const STARTUP_LOADING_PHRASES = [
  "Wiring venues and rails",
  "Opening the desk",
  "Checking the market stack",
];

export function getGordonLoadingPhrases(options?: {
  currentTool?: string | null;
  activityStatus?: string | null;
  variant?: "startup" | "streaming" | "response";
}): string[] {
  const variant = options?.variant ?? "response";
  const status = options?.activityStatus?.trim();
  const tool = options?.currentTool?.trim();

  const phrases = [
    ...(tool
      ? [
          `Routing through ${tool}`,
          `Watching ${tool} fill in the blanks`,
          `Reconciling ${tool} output`,
        ]
      : []),
    ...(variant === "startup" ? STARTUP_LOADING_PHRASES : []),
    ...BASE_GORDON_LOADING_PHRASES,
    ...(status ? [status] : []),
  ];

  return Array.from(new Set(phrases.filter(Boolean)));
}

export function useGordonLoader(options?: {
  enabled?: boolean;
  phrases?: string[];
  glyphIntervalMs?: number;
  phraseIntervalMs?: number;
  cursorIntervalMs?: number;
}) {
  const enabled = options?.enabled ?? true;
  const phrases = useMemo(
    () => (options?.phrases && options.phrases.length > 0 ? options.phrases : BASE_GORDON_LOADING_PHRASES),
    [options?.phrases]
  );
  const glyphIntervalMs = options?.glyphIntervalMs ?? 240;
  const phraseIntervalMs = options?.phraseIntervalMs ?? 1800;
  const cursorIntervalMs = options?.cursorIntervalMs ?? 450;

  const [glyphIndex, setGlyphIndex] = useState(0);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const glyphInterval = setInterval(() => {
      setGlyphIndex((prev) => (prev + 1) % GORDON_GLYPH_FRAMES.length);
    }, glyphIntervalMs);

    return () => clearInterval(glyphInterval);
  }, [enabled, glyphIntervalMs]);

  useEffect(() => {
    if (!enabled || phrases.length <= 1) {
      return;
    }

    const phraseInterval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % phrases.length);
    }, phraseIntervalMs);

    return () => clearInterval(phraseInterval);
  }, [enabled, phraseIntervalMs, phrases]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const cursorInterval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, cursorIntervalMs);

    return () => clearInterval(cursorInterval);
  }, [enabled, cursorIntervalMs]);

  useEffect(() => {
    setPhraseIndex(0);
  }, [phrases]);

  return {
    glyph: GORDON_GLYPH_FRAMES[glyphIndex] ?? GORDON_GLYPH_FRAMES[0],
    phrase: phrases[phraseIndex] ?? phrases[0] ?? BASE_GORDON_LOADING_PHRASES[0],
    cursorVisible,
  };
}
