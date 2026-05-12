/**
 * SDKScaffoldWizard — Interactive project scaffolding
 *
 * 4 steps: template, project name, output directory, confirm.
 * Uses Dialog wrapper.
 *
 * Pattern: Claude Code project creation wizard.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Dialog } from "../../design-system/Dialog.js";

// ============================================================================
// Types
// ============================================================================

export type TemplateType = "agent-ts" | "strategy-ts";

export interface ScaffoldConfig {
  template: TemplateType;
  projectName: string;
  outputDir: string;
}

interface Props {
  onComplete: (config: ScaffoldConfig) => void;
  onCancel: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const TEMPLATES: { type: TemplateType; name: string; description: string }[] = [
  { type: "agent-ts", name: "Agent (TypeScript)", description: "Trading agent with event loop and strategy hooks" },
  { type: "strategy-ts", name: "Strategy (TypeScript)", description: "Custom strategy with backtest harness" },
];

const STEPS = ["Template", "Project Name", "Output Dir", "Confirm"];

// ============================================================================
// Component
// ============================================================================

export function SDKScaffoldWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [templateIdx, setTemplateIdx] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [outputDir, setOutputDir] = useState("./");

  useInput((input, key) => {
    if (key.escape) {
      if (step > 0) {
        setStep((s) => s - 1);
      } else {
        onCancel();
      }
      return;
    }

    // Step 0: Template
    if (step === 0) {
      if (key.upArrow) setTemplateIdx((c) => Math.max(0, c - 1));
      if (key.downArrow) setTemplateIdx((c) => Math.min(TEMPLATES.length - 1, c + 1));
      if (key.return) setStep(1);
      return;
    }

    // Step 1: Project name
    if (step === 1) {
      if (key.return && projectName.length > 0) {
        setStep(2);
        return;
      }
      if (key.backspace || key.delete) {
        setProjectName((s) => s.slice(0, -1));
        return;
      }
      if (input && !key.upArrow && !key.downArrow) {
        setProjectName((s) => s + input);
      }
      return;
    }

    // Step 2: Output dir
    if (step === 2) {
      if (key.return) {
        setStep(3);
        return;
      }
      if (key.backspace || key.delete) {
        setOutputDir((s) => s.slice(0, -1));
        return;
      }
      if (input && !key.upArrow && !key.downArrow) {
        setOutputDir((s) => s + input);
      }
      return;
    }

    // Step 3: Confirm
    if (step === 3) {
      if (key.return) {
        onComplete({
          template: TEMPLATES[templateIdx]!.type,
          projectName: projectName || "my-project",
          outputDir: outputDir || "./",
        });
      }
    }
  });

  return (
    <Dialog
      title="SDK SCAFFOLD"
      subtitle={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}
      color="cyan"
      onClose={onCancel}
    >
      {/* Progress */}
      <Box>
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <Text dimColor> {"\u2500"} </Text>}
            <Text
              color={i === step ? "cyanBright" : i < step ? "green" : undefined}
              dimColor={i > step}
            >
              {i < step ? "\u25CF" : i === step ? "\u25C9" : "\u25CB"} {s}
            </Text>
          </React.Fragment>
        ))}
      </Box>
      <Text> </Text>

      {/* Step 0: Template */}
      {step === 0 && (
        <Box flexDirection="column">
          <Text bold>Select Template:</Text>
          {TEMPLATES.map((t, i) => {
            const isFocused = i === templateIdx;
            return (
              <Box key={t.type} paddingLeft={2} flexDirection="column">
                <Box>
                  <Text color={isFocused ? "cyanBright" : undefined}>
                    {isFocused ? "\u25B8 " : "  "}{t.name}
                  </Text>
                </Box>
                {isFocused && (
                  <Box paddingLeft={4}>
                    <Text dimColor>{t.description}</Text>
                  </Box>
                )}
              </Box>
            );
          })}
          <Text> </Text>
          <Text dimColor>{"\u2191\u2193"} select {"\u00b7"} Enter next</Text>
        </Box>
      )}

      {/* Step 1: Project name */}
      {step === 1 && (
        <Box flexDirection="column">
          <Box>
            <Text bold>Project Name: </Text>
            <Text>{projectName || "..."}</Text>
            <Text color="cyanBright">{"\u2588"}</Text>
          </Box>
          <Text> </Text>
          <Text dimColor>Type project name {"\u00b7"} Enter next {"\u00b7"} Esc back</Text>
        </Box>
      )}

      {/* Step 2: Output dir */}
      {step === 2 && (
        <Box flexDirection="column">
          <Box>
            <Text bold>Output Directory: </Text>
            <Text>{outputDir}</Text>
            <Text color="cyanBright">{"\u2588"}</Text>
          </Box>
          <Text> </Text>
          <Text dimColor>Type directory {"\u00b7"} Enter next {"\u00b7"} Esc back</Text>
        </Box>
      )}

      {/* Step 3: Confirm */}
      {step === 3 && (
        <Box flexDirection="column">
          <Text bold>Confirm Scaffold:</Text>
          <Text> </Text>
          <Box paddingLeft={2} flexDirection="column">
            <Box><Text dimColor>Template:  </Text><Text bold>{TEMPLATES[templateIdx]!.name}</Text></Box>
            <Box><Text dimColor>Project:   </Text><Text bold>{projectName || "my-project"}</Text></Box>
            <Box><Text dimColor>Directory: </Text><Text>{outputDir || "./"}</Text></Box>
          </Box>
          <Text> </Text>
          <Text bold color="green">Press Enter to scaffold</Text>
          <Text dimColor>Esc go back</Text>
        </Box>
      )}
    </Dialog>
  );
}
