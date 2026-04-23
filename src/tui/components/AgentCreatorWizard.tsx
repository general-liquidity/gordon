import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import { GordonSelect as Select } from "../design-system/GordonSelect.js";

// ============================================================================
// AgentCreatorWizard — Multi-step wizard for creating Gordon sub-agents
//
// Step 1: Role    — Scanner / Analyst / Executor / Monitor / Custom
// Step 2: Name    — Text input hint
// Step 3: Model   — claude-sonnet-4-6 / claude-haiku-4-5 / claude-opus-4-7
// Step 4: Risk    — Conservative / Moderate / Aggressive
// Step 5: Schedule — On demand / Every 5 min / Every hour / Custom cron
// Step 6: Confirm — Summary + [Create Agent] [Cancel]
// ============================================================================

export interface AgentConfig {
  name: string;
  role: "scanner" | "analyst" | "executor" | "monitor" | "custom";
  model: string;
  maxPositionSizePct: number;  // 0-100
  riskLevel: "conservative" | "moderate" | "aggressive";
  allowedTools: string[];
  schedule?: string;           // cron expression or undefined for on-demand
  description: string;
}

interface Props {
  onComplete: (config: AgentConfig) => void;
  onCancel: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const TOTAL_STEPS = 6;

// ── Data ──

const ROLE_OPTIONS = [
  { label: "Scanner    — market scanning and signal detection", value: "scanner" },
  { label: "Analyst    — deep analysis and research", value: "analyst" },
  { label: "Executor   — order execution and trade management", value: "executor" },
  { label: "Monitor    — portfolio and alert monitoring", value: "monitor" },
  { label: "Custom     — fully customizable agent", value: "custom" },
];

const MODEL_OPTIONS = [
  { label: "claude-sonnet-4-6  (recommended, balanced)", value: "claude-sonnet-4-6" },
  { label: "claude-haiku-4-5   (fast, lightweight)", value: "claude-haiku-4-5" },
  { label: "claude-opus-4-7    (most capable, slower)", value: "claude-opus-4-7" },
];

const RISK_OPTIONS = [
  { label: "Conservative  — max 2% position size", value: "conservative" },
  { label: "Moderate      — max 5% position size", value: "moderate" },
  { label: "Aggressive    — max 10% position size", value: "aggressive" },
];

const RISK_MAX_PCT: Record<string, number> = {
  conservative: 2,
  moderate: 5,
  aggressive: 10,
};

const SCHEDULE_OPTIONS = [
  { label: "On demand       — run when invoked", value: "" },
  { label: "Every 5 min     — */5 * * * *", value: "*/5 * * * *" },
  { label: "Every hour      — 0 * * * *", value: "0 * * * *" },
  { label: "Custom cron     — enter cron expression", value: "__custom__" },
];

const DEFAULT_TOOLS: Record<string, string[]> = {
  scanner: ["get_trending_tokens", "get_token_price", "get_market_data", "search_tokens"],
  analyst: ["get_token_price", "get_ohlcv", "get_market_data", "analyze_chart"],
  executor: ["place_market_order", "place_limit_order", "cancel_order", "get_balance"],
  monitor: ["get_portfolio", "get_positions", "get_alerts", "get_token_price"],
  custom: [],
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  scanner:  "Scans markets for opportunities and generates signals",
  analyst:  "Performs deep analysis on assets and market conditions",
  executor: "Executes trades and manages open positions",
  monitor:  "Monitors portfolio health and fires alerts",
  custom:   "Fully configurable agent with custom tools and behavior",
};

// ── Progress bar ──

function ProgressBar({ step, total }: { step: Step; total: number }) {
  const filled = Math.round((step / total) * 20);
  return (
    <Box>
      <Text dimColor>Step {step}/{total}  </Text>
      <Text color="cyanBright">{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(20 - filled)}</Text>
    </Box>
  );
}

// ── Wizard ──

export function AgentCreatorWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [role, setRole] = useState<AgentConfig["role"]>("scanner");
  const [name, setName] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [riskLevel, setRiskLevel] = useState<AgentConfig["riskLevel"]>("moderate");
  const [schedule, setSchedule] = useState<string>("");
  const [confirmFocus, setConfirmFocus] = useState<"create" | "cancel">("create");

  const goBack = () => {
    if (step === 1) {
      onCancel();
    } else {
      setStep((s) => (s - 1) as Step);
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      goBack();
    }
    // Step 6 confirm: left/right to switch button focus
    if (step === 6) {
      if (key.leftArrow || key.rightArrow || key.tab) {
        setConfirmFocus((f) => (f === "create" ? "cancel" : "create"));
      }
      if (key.return) {
        if (confirmFocus === "create") {
          handleCreate();
        } else {
          onCancel();
        }
      }
    }
  });

  function handleCreate() {
    const cfg: AgentConfig = {
      name: name.trim() || `my-${role}`,
      role,
      model,
      maxPositionSizePct: RISK_MAX_PCT[riskLevel] ?? 5,
      riskLevel,
      allowedTools: DEFAULT_TOOLS[role] ?? [],
      schedule: schedule === "" ? undefined : schedule,
      description: ROLE_DESCRIPTIONS[role] ?? "",
    };
    onComplete(cfg);
  }

  const wrapperProps = {
    flexDirection: "column" as const,
    borderStyle: "round" as const,
    borderColor: "cyanBright" as const,
    paddingX: 2,
    paddingY: 1,
  };

  // ── Step 1: Role ──
  if (step === 1) {
    return (
      <Box {...wrapperProps}>
        <ProgressBar step={1} total={TOTAL_STEPS} />
        <Box marginTop={1} marginBottom={1}>
          <Text bold color="cyanBright">SELECT AGENT ROLE</Text>
        </Box>
        <Select
          options={ROLE_OPTIONS}
          onChange={(v) => {
            setRole(v as AgentConfig["role"]);
            setStep(2);
          }}
        />
        <Box marginTop={1}>
          <Text dimColor>Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // ── Step 2: Name ──
  if (step === 2) {
    return (
      <Box {...wrapperProps}>
        <ProgressBar step={2} total={TOTAL_STEPS} />
        <Box marginTop={1} marginBottom={1}>
          <Text bold color="cyanBright">NAME YOUR AGENT</Text>
        </Box>
        <Text dimColor>Role: {role}</Text>
        <Box marginTop={1}>
          <Text>Enter a name for this agent, then press Enter.</Text>
        </Box>
        <Box marginTop={1}>
          <TextInput
            placeholder={`e.g., my-${role}`}
            onSubmit={(v) => {
              setName(v.trim() || `my-${role}`);
              setStep(3);
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // ── Step 3: Model ──
  if (step === 3) {
    return (
      <Box {...wrapperProps}>
        <ProgressBar step={3} total={TOTAL_STEPS} />
        <Box marginTop={1} marginBottom={1}>
          <Text bold color="cyanBright">SELECT MODEL</Text>
        </Box>
        <Text dimColor>Role: {role}  |  Name: {name || "(auto)"}</Text>
        <Box marginTop={1}>
          <Select
            options={MODEL_OPTIONS}
            onChange={(v) => {
              setModel(v);
              setStep(4);
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // ── Step 4: Risk ──
  if (step === 4) {
    return (
      <Box {...wrapperProps}>
        <ProgressBar step={4} total={TOTAL_STEPS} />
        <Box marginTop={1} marginBottom={1}>
          <Text bold color="cyanBright">SET RISK LEVEL</Text>
        </Box>
        <Text dimColor>Model: {model}</Text>
        <Box marginTop={1}>
          <Select
            options={RISK_OPTIONS}
            onChange={(v) => {
              setRiskLevel(v as AgentConfig["riskLevel"]);
              setStep(5);
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // ── Step 5: Schedule ──
  if (step === 5) {
    return (
      <Box {...wrapperProps}>
        <ProgressBar step={5} total={TOTAL_STEPS} />
        <Box marginTop={1} marginBottom={1}>
          <Text bold color="cyanBright">SET SCHEDULE</Text>
          <Text dimColor>  (optional)</Text>
        </Box>
        <Text dimColor>Risk: {riskLevel}  |  Max position: {RISK_MAX_PCT[riskLevel]}%</Text>
        <Box marginTop={1}>
          <Select
            options={SCHEDULE_OPTIONS}
            onChange={(v) => {
              if (v === "__custom__") {
                // Default to on-demand; user can edit later
                setSchedule("0 * * * *");
              } else {
                setSchedule(v);
              }
              setStep(6);
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  // ── Step 6: Confirm ──
  return (
    <Box {...wrapperProps}>
      <ProgressBar step={6} total={TOTAL_STEPS} />
      <Box marginTop={1} marginBottom={1}>
        <Text bold color="cyanBright">CONFIRM AGENT CONFIGURATION</Text>
      </Box>

      {/* Summary */}
      <Box flexDirection="column" gap={0}>
        <Box>
          <Text dimColor>{"  Role:       "}</Text>
          <Text bold>{role}</Text>
        </Box>
        <Box>
          <Text dimColor>{"  Name:       "}</Text>
          <Text bold>{name || `my-${role}`}</Text>
        </Box>
        <Box>
          <Text dimColor>{"  Model:      "}</Text>
          <Text>{model}</Text>
        </Box>
        <Box>
          <Text dimColor>{"  Risk:       "}</Text>
          <Text color={
            riskLevel === "conservative" ? "green" :
            riskLevel === "moderate" ? "yellow" : "red"
          }>
            {riskLevel}  (max {RISK_MAX_PCT[riskLevel]}% position)
          </Text>
        </Box>
        <Box>
          <Text dimColor>{"  Schedule:   "}</Text>
          <Text>{schedule === "" ? "On demand" : schedule}</Text>
        </Box>
        <Box>
          <Text dimColor>{"  Tools:      "}</Text>
          <Text dimColor>{(DEFAULT_TOOLS[role] ?? []).join(", ") || "none"}</Text>
        </Box>
        <Box>
          <Text dimColor>{"  About:      "}</Text>
          <Text dimColor>{ROLE_DESCRIPTIONS[role]}</Text>
        </Box>
      </Box>

      {/* Action buttons */}
      <Box marginTop={2} gap={3}>
        <Text
          color={confirmFocus === "create" ? "cyanBright" : undefined}
          bold={confirmFocus === "create"}
          inverse={confirmFocus === "create"}
        >
          {" Create Agent "}
        </Text>
        <Text
          color={confirmFocus === "cancel" ? "red" : undefined}
          bold={confirmFocus === "cancel"}
          inverse={confirmFocus === "cancel"}
        >
          {" Cancel "}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[{"←→"}] Switch  [Enter] Confirm  [Esc] Go back</Text>
      </Box>
    </Box>
  );
}
