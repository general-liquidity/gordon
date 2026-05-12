/**
 * GordonOnboarding — Multi-step onboarding wizard for first-time users.
 *
 * Steps: welcome → exchange → broker → risk → first_scan → complete
 *
 * Shows a step indicator: "Step 2 of 5 ────────●────"
 * Each step in a cyanBright round-bordered box.
 * Enter advances, Escape skips the whole wizard.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// Types
// ============================================================================

export type OnboardingStep =
  | "welcome"
  | "exchange"
  | "broker"
  | "risk"
  | "first_scan"
  | "complete";

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

// ============================================================================
// Step definitions
// ============================================================================

interface StepDef {
  id: OnboardingStep;
  title: string;
  body: string;
  cta: string; // button label
}

const STEPS: StepDef[] = [
  {
    id: "welcome",
    title: "Welcome to Gordon!",
    body: "Let's get you set up in a few quick steps so you can start trading with your AI agent.",
    cta: "Next",
  },
  {
    id: "exchange",
    title: "Connect your exchange",
    body: "Use /exchange to add Binance, Coinbase, Kraken, Hyperliquid, or any supported venue.\nGordon will use it to execute trades and fetch live prices.",
    cta: "Next",
  },
  {
    id: "broker",
    title: "Connect a broker (optional)",
    body: "Use /broker to enable stock and options trading via Alpaca, Schwab, Tastytrade, or Interactive Brokers.\nYou can skip this if you only trade crypto.",
    cta: "Next",
  },
  {
    id: "risk",
    title: "Set your risk tolerance",
    body: "Use /risk to configure your max position size, drawdown limits, and cash reserve.\nGordon will always stay within these guardrails before executing any trade.",
    cta: "Next",
  },
  {
    id: "first_scan",
    title: "Try your first scan!",
    body: "Type:  /scan trending\n\nGordon will scan markets for momentum, volume, and opportunities based on your exchange and risk profile.",
    cta: "Let's go!",
  },
  {
    id: "complete",
    title: "You're all set!",
    body: "Gordon is ready to help you trade. You can always run /help to see available commands, or /settings to update your preferences.",
    cta: "Start trading",
  },
];

// ============================================================================
// Progress indicator
// ============================================================================

/**
 * Renders: "Step 2 of 5 ────────●────"
 * The filled dot marks the current step; dashes fill remaining width.
 */
function ProgressBar({ current, total }: { current: number; total: number }) {
  // Build a simple track: dashes before dot, dot, dashes after
  const trackLen = 16;
  const dotPos = Math.round(((current - 1) / Math.max(total - 1, 1)) * (trackLen - 1));
  const track = Array.from({ length: trackLen }, (_, i) =>
    i === dotPos ? "●" : "─",
  ).join("");

  return (
    <Box>
      <Text dimColor>{"Step "}</Text>
      <Text bold color="cyanBright">{current}</Text>
      <Text dimColor>{" of "}</Text>
      <Text dimColor>{total} </Text>
      <Text dimColor>{track}</Text>
    </Box>
  );
}

// ============================================================================
// Component
// ============================================================================

// Steps that have a "Next" flow (all except complete, which calls onComplete)
const FLOW_STEP_IDS: OnboardingStep[] = [
  "welcome",
  "exchange",
  "broker",
  "risk",
  "first_scan",
];
const TOTAL_FLOW_STEPS = FLOW_STEP_IDS.length; // 5 (complete is not counted)

export function GordonOnboarding({ onComplete, onSkip }: Props) {
  const [stepIndex, setStepIndex] = useState(0);

  const step = STEPS[stepIndex]!;
  const isComplete = step.id === "complete";

  // Which numbered step we're on (1-based, up to TOTAL_FLOW_STEPS)
  const flowStep = Math.min(stepIndex + 1, TOTAL_FLOW_STEPS);

  useInput((_, key) => {
    if (key.escape) {
      onSkip();
      return;
    }
    if (key.return) {
      if (isComplete) {
        onComplete();
      } else {
        setStepIndex((i) => i + 1);
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyanBright"
      paddingX={2}
      paddingY={1}
    >
      {/* Header: step indicator */}
      {!isComplete && (
        <Box marginBottom={1}>
          <ProgressBar current={flowStep} total={TOTAL_FLOW_STEPS} />
        </Box>
      )}

      {/* Step title */}
      <Text bold color="cyanBright">
        {step.title}
      </Text>
      <Text> </Text>

      {/* Body (supports \n for multi-line) */}
      {step.body.split("\n").map((line, i) => (
        <Text key={i} dimColor={line === ""}>
          {line || " "}
        </Text>
      ))}

      {/* CTA */}
      <Text> </Text>
      <Box>
        <Text bold color="cyanBright">{"[Enter]"}</Text>
        <Text> {step.cta}</Text>
        {!isComplete && (
          <>
            <Text dimColor>{"  ·  "}</Text>
            <Text dimColor>{"[Esc] Skip setup"}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
