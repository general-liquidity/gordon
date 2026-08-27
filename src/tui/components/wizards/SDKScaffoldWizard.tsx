/**
 * SDKScaffoldWizard — Interactive project scaffolding.
 *
 * 4 steps: template, project name, output directory, confirm.
 */

import React, { useState, type Dispatch, type SetStateAction } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { MultiStepPicker, type PickerStep } from "../../design-system/MultiStepPicker.tsx";
import { useTheme } from "../../themes/ThemeProvider.tsx";

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

const TEMPLATES: { type: TemplateType; name: string; description: string }[] = [
  {
    type: "agent-ts",
    name: "Agent (TypeScript)",
    description: "Trading agent with event loop and strategy hooks",
  },
  {
    type: "strategy-ts",
    name: "Strategy (TypeScript)",
    description: "Custom strategy with backtest harness",
  },
];

interface TemplateStepProps {
  cursor: number;
  setCursor: Dispatch<SetStateAction<number>>;
  onNext: () => void;
}

function TemplateStep({ cursor, setCursor, onNext }: TemplateStepProps): React.ReactElement {
  const theme = useTheme();

  useInput((_input, key) => {
    if (key.upArrow) setCursor((current) => Math.max(0, current - 1));
    if (key.downArrow) setCursor((current) => Math.min(TEMPLATES.length - 1, current + 1));
    if (key.return) onNext();
  });

  return (
    <Box flexDirection="column">
      <Text bold>Select Template:</Text>
      {TEMPLATES.map((template, index) => {
        const isFocused = index === cursor;
        return (
          <Box key={template.type} paddingLeft={2} flexDirection="column">
            <Box>
              <Text color={isFocused ? theme.uiBrand : undefined}>
                {isFocused ? "\u25B8 " : "  "}
                {template.name}
              </Text>
            </Box>
            {isFocused ? (
              <Box paddingLeft={4}>
                <Text dimColor>{template.description}</Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
      <Text> </Text>
      <Text dimColor>
        {"\u2191\u2193"} select {"\u00b7"} Enter next
      </Text>
    </Box>
  );
}

interface TextFieldStepProps {
  label: string;
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  placeholder: string;
  allowEmpty?: boolean;
  hint: string;
  onNext: () => void;
}

function TextFieldStep({
  label,
  value,
  setValue,
  placeholder,
  allowEmpty = true,
  hint,
  onNext,
}: TextFieldStepProps): React.ReactElement {
  const theme = useTheme();

  useInput((input, key) => {
    if (key.return && (allowEmpty || value.length > 0)) {
      onNext();
      return;
    }
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }
    if (input && !key.upArrow && !key.downArrow) {
      setValue((current) => current + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{label}: </Text>
        <Text>{value || placeholder}</Text>
        <Text color={theme.uiBrand}>{"\u2588"}</Text>
      </Box>
      <Text> </Text>
      <Text dimColor>
        {hint} {"\u00b7"} Enter next
      </Text>
    </Box>
  );
}

interface ConfirmStepProps {
  config: ScaffoldConfig;
  templateName: string;
  onComplete: () => void;
}

function ConfirmStep({ config, templateName, onComplete }: ConfirmStepProps): React.ReactElement {
  const theme = useTheme();

  useInput((_input, key) => {
    if (key.return) onComplete();
  });

  return (
    <Box flexDirection="column">
      <Text bold>Confirm Scaffold:</Text>
      <Text> </Text>
      <Box paddingLeft={2} flexDirection="column">
        <Box>
          <Text dimColor>Template: </Text>
          <Text bold>{templateName}</Text>
        </Box>
        <Box>
          <Text dimColor>Project: </Text>
          <Text bold>{config.projectName}</Text>
        </Box>
        <Box>
          <Text dimColor>Directory: </Text>
          <Text>{config.outputDir}</Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold color={theme.riskSafe}>
        Press Enter to scaffold
      </Text>
    </Box>
  );
}

export function SDKScaffoldWizard({ onComplete, onCancel }: Props) {
  const [templateIdx, setTemplateIdx] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [outputDir, setOutputDir] = useState("./");

  const config: ScaffoldConfig = {
    template: TEMPLATES[templateIdx]!.type,
    projectName: projectName || "my-project",
    outputDir: outputDir || "./",
  };

  const steps: Record<string, PickerStep<ScaffoldConfig>> = {
    template: {
      title: "Step 1: Template",
      render: (ctx) => (
        <TemplateStep
          cursor={templateIdx}
          setCursor={setTemplateIdx}
          onNext={() => ctx.go("project-name")}
        />
      ),
    },
    "project-name": {
      title: "Step 2: Project name",
      render: (ctx) => (
        <TextFieldStep
          label="Project Name"
          value={projectName}
          setValue={setProjectName}
          placeholder="..."
          allowEmpty={false}
          hint="Type project name"
          onNext={() => ctx.go("output-dir")}
        />
      ),
    },
    "output-dir": {
      title: "Step 3: Output directory",
      render: (ctx) => (
        <TextFieldStep
          label="Output Directory"
          value={outputDir}
          setValue={setOutputDir}
          placeholder="./"
          hint="Type directory"
          onNext={() => ctx.go("confirm")}
        />
      ),
    },
    confirm: {
      title: "Step 4: Confirm",
      render: () => (
        <ConfirmStep
          config={config}
          templateName={TEMPLATES[templateIdx]!.name}
          onComplete={() => onComplete(config)}
        />
      ),
    },
  };

  return (
    <MultiStepPicker<ScaffoldConfig>
      title="SDK SCAFFOLD"
      steps={steps}
      initialStep="template"
      onComplete={onComplete}
      onCancel={onCancel}
      showProgress
    />
  );
}
