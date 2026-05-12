import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Divider } from "../layout/Divider.tsx";

// ============================================================================
// MCPStdioServerMenu — Step-by-step form to add a local stdio MCP server
//
// Steps: name → command → confirm
// The command string is split on whitespace to derive args[].
// ============================================================================

interface Props {
  onAdd: (config: { name: string; command: string; args?: string[] }) => void;
  onClose: () => void;
}

type Step = "name" | "command" | "confirm";

const STEP_ORDER: Step[] = ["name", "command", "confirm"];

const STEP_LABEL: Record<Step, string> = {
  name: "Server Name",
  command: "Command",
  confirm: "",
};

const STEP_PLACEHOLDER: Record<Step, string> = {
  name: "e.g. CoinGecko MCP",
  command: "e.g. npx -y @coingecko/coingecko-mcp",
  confirm: "",
};

function parseCommand(raw: string): { command: string; args?: string[] } {
  const parts = raw.trim().split(/\s+/);
  const [command, ...rest] = parts;
  return {
    command: command ?? raw,
    args: rest.length > 0 ? rest : undefined,
  };
}

export function MCPStdioServerMenu({ onAdd, onClose }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState<Record<Step, string>>({
    name: "",
    command: "",
    confirm: "",
  });
  const [input, setInput] = useState("");
  const [confirmFocus, setConfirmFocus] = useState<"add" | "cancel">("add");

  const step = STEP_ORDER[stepIdx] ?? "name";
  const parsed = parseCommand(values.command || "");

  useInput((char, key) => {
    if (key.escape) {
      if (stepIdx === 0) {
        onClose();
      } else {
        const prevStep = STEP_ORDER[stepIdx - 1]!;
        setInput(values[prevStep]);
        setStepIdx((i) => i - 1);
      }
      return;
    }

    if (step === "confirm") {
      if (key.leftArrow || key.rightArrow) {
        setConfirmFocus((f) => (f === "add" ? "cancel" : "add"));
      } else if (key.return) {
        if (confirmFocus === "add") {
          onAdd({
            name: values.name,
            command: parsed.command,
            args: parsed.args,
          });
        } else {
          onClose();
        }
      }
      return;
    }

    if (key.return) {
      if (input.trim() === "") return;
      setValues((v) => ({ ...v, [step]: input.trim() }));
      setInput("");
      setStepIdx((i) => i + 1);
      return;
    }

    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
      return;
    }

    if (char && !key.ctrl && !key.meta && char.length === 1) {
      setInput((s) => s + char);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">ADD LOCAL MCP SERVER</Text>
        <Text dimColor>  (stdio)</Text>
      </Box>

      <Divider />

      {/* Completed fields summary */}
      <Box flexDirection="column" marginTop={1}>
        {STEP_ORDER.slice(0, stepIdx).map((s) => {
          if (s === "confirm") return null;
          return (
            <Box key={s}>
              <Text dimColor>  {STEP_LABEL[s].padEnd(16)}</Text>
              <Text color="green">{values[s] || "(blank)"}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Current input step */}
      {step !== "confirm" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{STEP_LABEL[step]}:</Text>
          <Box marginTop={1}>
            <Text color="cyanBright">❯ </Text>
            <Text>{input}</Text>
            <Text color="cyanBright">█</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>{STEP_PLACEHOLDER[step]}</Text>
          </Box>
          {input.trim() === "" && (
            <Text color="yellow">  (required)</Text>
          )}
        </Box>
      )}

      {/* Confirm step */}
      {step === "confirm" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Ready to add:</Text>
          <Box>
            <Text dimColor>  {"Name".padEnd(16)}</Text>
            <Text>{values.name}</Text>
          </Box>
          <Box>
            <Text dimColor>  {"Command".padEnd(16)}</Text>
            <Text>{parsed.command}</Text>
          </Box>
          {parsed.args && parsed.args.length > 0 && (
            <Box>
              <Text dimColor>  {"Args".padEnd(16)}</Text>
              <Text dimColor>{parsed.args.join(" ")}</Text>
            </Box>
          )}

          <Box marginTop={1} gap={3}>
            <Box>
              <Text
                color={confirmFocus === "add" ? "green" : undefined}
                bold={confirmFocus === "add"}
                inverse={confirmFocus === "add"}
              >
                {confirmFocus === "add" ? " Add Server " : "[ Add Server ]"}
              </Text>
            </Box>
            <Box>
              <Text
                color={confirmFocus === "cancel" ? "red" : undefined}
                bold={confirmFocus === "cancel"}
                inverse={confirmFocus === "cancel"}
              >
                {confirmFocus === "cancel" ? " Cancel " : "[ Cancel ]"}
              </Text>
            </Box>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {step === "confirm"
            ? "←→ select  Enter confirm  Esc back"
            : "Type value  Enter next  Esc back"}
        </Text>
      </Box>
    </Box>
  );
}
