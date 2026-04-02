import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

import type { GordonConfig } from "../types/index.ts";
import type { SetupWizardMode, SetupWizardSection } from "./setup-flow.ts";
import { COLORS } from "./theme.ts";
import { DeskPanel } from "./components/desk/DeskPanel.tsx";

function parseBrokerMode(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (["paper", "true", "1"].includes(normalized)) return true;
  if (["live", "false", "0"].includes(normalized)) return false;
  return null;
}

function getBrokerLabel(type: string): string {
  return type
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getBrokerInstructions(type: string): string[] {
  return [
    `Add ${getBrokerLabel(type)} credentials with /broker add ${type}.`,
    "Prefer paper mode until approvals and routing are verified.",
  ];
}

function generateBrokerId(
  type: string,
  existing: Array<Pick<GordonConfig["brokers"][number], "id">>,
): string {
  const used = new Set(existing.map((entry) => entry.id));
  if (!used.has(type)) return type;
  let suffix = 1;
  while (used.has(`${type}_${suffix}`)) suffix += 1;
  return `${type}_${suffix}`;
}

function parseRailsInput(input: string): {
  keys: Record<string, string>;
  errors: string[];
} {
  const keys: Record<string, string> = {};
  const errors: string[] = [];

  for (const chunk of input.split(/\s*;\s*/u).filter(Boolean)) {
    const [provider, rawValues] = chunk.split(/\s*:\s*/u);
    if (!provider || !rawValues) {
      errors.push(`Invalid rails segment: ${chunk}`);
      continue;
    }
    const values = rawValues.split(/\s*,\s*/u);
    switch (provider.trim().toLowerCase()) {
      case "helius":
        keys.heliusApiKey = values[0] ?? "";
        break;
      case "moonpay":
        keys.moonpayApiKey = values[0] ?? "";
        keys.moonpaySecretKey = values[1] ?? "";
        break;
      case "polygon":
        keys.polygonRecipient = values[0] ?? "";
        keys.polygonPrivateKey = values[1] ?? "";
        break;
      default:
        errors.push(`Unknown rails provider: ${provider}`);
        break;
    }
  }

  return { keys, errors };
}

function getFirstActionStep(mode: SetupWizardMode, section: SetupWizardSection | null): string {
  if (mode === "quickstart") return "llm";
  if (mode === "configure" && section) return `${section}-select`;
  return section ?? "exchange";
}

export const __setupWizardBrokerInternals = {
  parseBrokerMode,
  getBrokerLabel,
  getBrokerInstructions,
  generateBrokerId,
  parseRailsInput,
  getFirstActionStep,
};

const SECTIONS: SetupWizardSection[] = [
  "exchange",
  "broker",
  "chains",
  "rails",
  "mcp",
  "llm",
  "preferences",
];

export const SetupWizard: React.FC<{
  mode: SetupWizardMode;
  initialSection: SetupWizardSection | null;
  onComplete: () => void | Promise<void>;
}> = ({ mode, initialSection, onComplete }) => {
  const initialIndex = Math.max(0, initialSection ? SECTIONS.indexOf(initialSection) : 0);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const activeSection = useMemo(() => SECTIONS[selectedIndex] ?? "exchange", [selectedIndex]);

  useInput((input, key) => {
    if (key.upArrow) setSelectedIndex((current) => (current - 1 + SECTIONS.length) % SECTIONS.length);
    else if (key.downArrow) setSelectedIndex((current) => (current + 1) % SECTIONS.length);
    else if (key.return || key.escape) void onComplete();
    else if (/^[1-7]$/u.test(input)) {
      const index = Number.parseInt(input, 10) - 1;
      if (SECTIONS[index]) setSelectedIndex(index);
    }
  });

  return (
    <Box flexGrow={1} justifyContent="center" alignItems="center">
      <Box width={92}>
        <DeskPanel
          eyebrow="Setup"
          title={`Operator setup · ${mode}`}
          subtitle="The setup lane is being rebuilt around command-first configuration. This screen is the route map."
          tone="warning"
        >
          {SECTIONS.map((section, index) => {
            const active = index === selectedIndex;
            return (
              <Box
                key={section}
                borderStyle="single"
                borderColor={active ? COLORS.BRASS : COLORS.BRASS_DIM}
                paddingX={1}
                marginBottom={1}
              >
                <Text color={active ? COLORS.BRASS : COLORS.WHITE}>
                  {active ? ">" : " "} {index + 1}. {section}
                  <Text color={COLORS.DIM}> · first action {getFirstActionStep(mode, section)}</Text>
                </Text>
              </Box>
            );
          })}
          <Text color={COLORS.WHITE}>Active section: {activeSection}</Text>
          <Text color={COLORS.DIM}>Use /exchange, /broker, /config, /mcp, and /keyring after activation. Enter continues.</Text>
        </DeskPanel>
      </Box>
    </Box>
  );
};

