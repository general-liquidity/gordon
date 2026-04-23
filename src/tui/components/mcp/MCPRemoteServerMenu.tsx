import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Divider } from "../Divider.js";

// ============================================================================
// MCPRemoteServerMenu — Step-by-step form to add a remote HTTP/SSE MCP server
//
// Steps: name → url → apiKey (optional) → confirm
// ============================================================================

interface Props {
  onAdd: (config: { name: string; url: string; apiKey?: string }) => void;
  onClose: () => void;
}

type Step = "name" | "url" | "apiKey" | "confirm";

const STEP_ORDER: Step[] = ["name", "url", "apiKey", "confirm"];

const STEP_LABEL: Record<Step, string> = {
  name: "Server Name",
  url: "URL",
  apiKey: "API Key (optional)",
  confirm: "",
};

const STEP_PLACEHOLDER: Record<Step, string> = {
  name: "e.g. CoinGecko Prices",
  url: "e.g. https://mcp.example.com",
  apiKey: "leave blank to skip",
  confirm: "",
};

export function MCPRemoteServerMenu({ onAdd, onClose }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState<Record<Step, string>>({
    name: "",
    url: "",
    apiKey: "",
    confirm: "",
  });
  const [input, setInput] = useState("");
  const [confirmFocus, setConfirmFocus] = useState<"add" | "cancel">("add");

  const step = STEP_ORDER[stepIdx] ?? "name";

  useInput((char, key) => {
    if (key.escape) {
      if (stepIdx === 0) {
        onClose();
      } else {
        // Go back to previous step, restore previous input
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
            url: values.url,
            apiKey: values.apiKey || undefined,
          });
        } else {
          onClose();
        }
      }
      return;
    }

    if (key.return) {
      // Validate required fields
      if ((step === "name" || step === "url") && input.trim() === "") return;

      setValues((v) => ({ ...v, [step]: input.trim() }));
      setInput("");
      setStepIdx((i) => i + 1);
      return;
    }

    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
      return;
    }

    // Printable characters
    if (char && !key.ctrl && !key.meta && char.length === 1) {
      setInput((s) => s + char);
    }
  });

  const maskedInput = step === "apiKey" ? "•".repeat(input.length) : input;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyanBright">ADD REMOTE MCP SERVER</Text>
        <Text dimColor>  (HTTP / SSE)</Text>
      </Box>

      <Divider />

      {/* Completed fields summary */}
      <Box flexDirection="column" marginTop={1}>
        {STEP_ORDER.slice(0, stepIdx).map((s) => {
          if (s === "confirm") return null;
          const display =
            s === "apiKey" && values[s]
              ? "•".repeat(Math.min(values[s].length, 8)) + "..."
              : values[s] || "(blank)";
          return (
            <Box key={s}>
              <Text dimColor>  {STEP_LABEL[s].padEnd(20)}</Text>
              <Text color="green">{display}</Text>
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
            <Text>{maskedInput || ""}</Text>
            <Text color="cyanBright">█</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>{STEP_PLACEHOLDER[step]}</Text>
          </Box>
          {(step === "name" || step === "url") && input.trim() === "" && (
            <Text color="yellow">  (required)</Text>
          )}
          {step === "apiKey" && (
            <Text dimColor>  Press Enter to skip</Text>
          )}
        </Box>
      )}

      {/* Confirm step */}
      {step === "confirm" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Ready to add:</Text>
          <Box>
            <Text dimColor>  {"Name".padEnd(20)}</Text>
            <Text>{values.name}</Text>
          </Box>
          <Box>
            <Text dimColor>  {"URL".padEnd(20)}</Text>
            <Text>{values.url}</Text>
          </Box>
          {values.apiKey && (
            <Box>
              <Text dimColor>  {"API Key".padEnd(20)}</Text>
              <Text>{"•".repeat(Math.min(values.apiKey.length, 8))}...</Text>
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
