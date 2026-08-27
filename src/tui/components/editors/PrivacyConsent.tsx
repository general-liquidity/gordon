/**
 * PrivacyConsent — First-run privacy/consent wizard
 *
 * Shows once on the very first session. Asks the user to make explicit
 * choices about anonymous telemetry and research data collection. Both
 * default to OFF unless the user explicitly opts in.
 *
 * After the user makes their choices, sets `onboardingComplete: true` in
 * config so this never shows again. Users can change their minds via
 * `/telemetry enable|disable|research-enable|research-disable` later.
 *
 * Claude Code pattern: explicit first-run consent (Grove dialog) for
 * analytics opt-in, with the ability to change later.
 */

import { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";

export interface PrivacyChoices {
  telemetryEnabled: boolean;
  researchDataEnabled: boolean;
}

interface Props {
  onComplete: (choices: PrivacyChoices) => void;
}

type Step = "intro" | "telemetry" | "research" | "summary";

export function PrivacyConsent({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("intro");
  const [telemetry, setTelemetry] = useState(false);
  const [research, setResearch] = useState(false);

  useInput((input, key) => {
    if (step === "intro") {
      if (key.return) setStep("telemetry");
      return;
    }

    if (step === "telemetry") {
      if (input === "y" || input === "Y") {
        setTelemetry(true);
        setStep("research");
      } else if (input === "n" || input === "N" || key.return) {
        setTelemetry(false);
        setStep("research");
      }
      return;
    }

    if (step === "research") {
      if (input === "y" || input === "Y") {
        setResearch(true);
        setStep("summary");
      } else if (input === "n" || input === "N" || key.return) {
        setResearch(false);
        setStep("summary");
      }
      return;
    }

    if (step === "summary") {
      if (key.return) {
        onComplete({ telemetryEnabled: telemetry, researchDataEnabled: research });
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Gordon CLI — Privacy & Data
        </Text>
      </Box>

      {step === "intro" && (
        <Box flexDirection="column">
          <Text>Gordon runs locally on your machine. Your trades, balances, API keys,</Text>
          <Text>and config never leave this device.</Text>
          <Text> </Text>
          <Text>Two optional data streams help us improve Gordon. Both are OFF by</Text>
          <Text>default and you can change your mind any time via /telemetry.</Text>
          <Text> </Text>
          <Text dimColor>Press Enter to continue...</Text>
        </Box>
      )}

      {step === "telemetry" && (
        <Box flexDirection="column">
          <Text bold>1. Anonymous usage telemetry</Text>
          <Text> </Text>
          <Text>What it sends: command names, agent routing, error codes, OS, version.</Text>
          <Text>What it does NOT send: trades, balances, prompts, code, addresses, keys.</Text>
          <Text>Identification: random per-install ID, not tied to any account or email.</Text>
          <Text>Endpoint: telemetry.gordon.sh (batched every 5 min, 3-second timeout)</Text>
          <Text> </Text>
          <Text bold>Enable anonymous telemetry?</Text>
          <Text dimColor>[Y] yes [N/Enter] no</Text>
        </Box>
      )}

      {step === "research" && (
        <Box flexDirection="column">
          <Text bold>2. Anonymized research data</Text>
          <Text> </Text>
          <Text>What it sends: trade outcomes (% PnL only, never $ amounts), strategy</Text>
          <Text>names, market context (RSI bucket, regime), backtest metrics.</Text>
          <Text>Anonymization: prices normalized to %, IDs hashed, $ amounts stripped,</Text>
          <Text>timestamps rounded to nearest hour.</Text>
          <Text>Storage: written locally first, uploaded only when you run /telemetry</Text>
          <Text>research-upload. You always control what leaves your machine.</Text>
          <Text> </Text>
          <Text bold>Enable research data collection?</Text>
          <Text dimColor>[Y] yes [N/Enter] no</Text>
        </Box>
      )}

      {step === "summary" && (
        <Box flexDirection="column">
          <Text bold>Your choices</Text>
          <Text> </Text>
          <Text>
            Anonymous telemetry:{" "}
            <Text color={telemetry ? "green" : "gray"}>{telemetry ? "ENABLED" : "DISABLED"}</Text>
          </Text>
          <Text>
            Research data:{" "}
            <Text color={research ? "green" : "gray"}>{research ? "ENABLED" : "DISABLED"}</Text>
          </Text>
          <Text> </Text>
          <Text dimColor>You can change these later via /telemetry enable|disable|</Text>
          <Text dimColor>research-enable|research-disable.</Text>
          <Text> </Text>
          <Text dimColor>Use /telemetry export to see what's been collected.</Text>
          <Text dimColor>
            Use /telemetry forget to wipe all local data and reset your install ID.
          </Text>
          <Text> </Text>
          <Text dimColor>Press Enter to continue to Gordon.</Text>
        </Box>
      )}
    </Box>
  );
}
