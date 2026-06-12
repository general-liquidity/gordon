import React, { useMemo, useState, type ReactNode } from "react";
import { Box, Text, useInput } from "../ink-custom";
import { useTheme } from "../themes/ThemeProvider.tsx";
import { KeyboardHints } from "./KeyboardHints.tsx";

export interface PickerStepContext<TData> {
  data: Partial<TData>;
  set: <K extends keyof TData>(key: K, value: TData[K]) => void;
  go: (stepId: string) => void;
  done: () => void;
  cancel: () => void;
}

export interface PickerStep<TData> {
  title?: string;
  hint?: string;
  render: (ctx: PickerStepContext<TData>) => ReactNode;
}

export interface MultiStepPickerProps<TData> {
  title: string;
  titleNote?: string;
  steps: Record<string, PickerStep<TData>>;
  initialStep: string;
  onComplete: (data: TData) => void;
  onCancel: () => void;
  showProgress?: boolean;
}

export interface PickerMachineState {
  stepId: string;
  history: string[];
}

export type PickerMachineEvent =
  | { type: "go"; stepId: string }
  | { type: "back" };

export function pickerTransition(state: PickerMachineState, event: PickerMachineEvent): PickerMachineState {
  switch (event.type) {
    case "go":
      if (event.stepId === state.stepId) return state;
      return { stepId: event.stepId, history: [...state.history, state.stepId] };
    case "back": {
      const previous = state.history[state.history.length - 1];
      if (!previous) return state;
      return { stepId: previous, history: state.history.slice(0, -1) };
    }
  }
}

export function MultiStepPicker<TData>({
  title,
  titleNote,
  steps,
  initialStep,
  onComplete,
  onCancel,
  showProgress = false,
}: MultiStepPickerProps<TData>): React.ReactElement {
  const theme = useTheme();
  const [machine, setMachine] = useState<PickerMachineState>({ stepId: initialStep, history: [] });
  const [data, setData] = useState<Partial<TData>>({});
  const stepIds = useMemo(() => Object.keys(steps), [steps]);
  const current = steps[machine.stepId] ?? steps[initialStep];

  const ctx: PickerStepContext<TData> = {
    data,
    set: (key, value) => setData((prev) => ({ ...prev, [key]: value })),
    go: (stepId) => setMachine((prev) => pickerTransition(prev, { type: "go", stepId })),
    done: () => onComplete(data as TData),
    cancel: onCancel,
  };

  useInput((_input, key) => {
    if (!key.escape) return;
    if (machine.history.length === 0) {
      onCancel();
      return;
    }
    setMachine((prev) => pickerTransition(prev, { type: "back" }));
  });

  const index = Math.max(0, stepIds.indexOf(machine.stepId));

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color={theme.uiBrand}>
        {title}
        {titleNote ? <Text dimColor> {titleNote}</Text> : null}
      </Text>
      {showProgress && (
        <Text dimColor>
          Step {index + 1} of {stepIds.length} {" "}
          {stepIds.map((id) => id === machine.stepId ? "●" : "○").join(" ")}
        </Text>
      )}
      {current?.title ? <Text bold>{current.title}</Text> : null}
      {current?.hint ? <Text dimColor>{current.hint}</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {current?.render(ctx)}
      </Box>
      <Box marginTop={1}>
        <KeyboardHints
          hints={[
            { keys: "esc", label: machine.history.length > 0 ? "back" : "cancel" },
            { keys: "↑↓", label: "navigate" },
            { keys: "enter", label: "select" },
          ]}
        />
      </Box>
    </Box>
  );
}
