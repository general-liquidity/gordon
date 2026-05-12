/**
 * SettingsDialog — Full-screen settings UI with tabbed navigation
 *
 * Tabs: General, Trading, Risk, Exchange
 * Each tab shows key-value pairs editable via Select or TextInput.
 * Saves on change via SettingsProvider.
 *
 * Phase 16 of the TUI rebuild.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Select, TextInput } from "@inkjs/ui";
import {
  useSettings,
  type GordonSettings,
  type PermissionModeSetting,
  type RiskLevel,
  type ThemeSetting,
} from "../../state/SettingsProvider.js";

// ============================================================================
// Tab definitions
// ============================================================================

const TABS = ["General", "Trading", "Risk", "Exchange"] as const;
type Tab = (typeof TABS)[number];

// ============================================================================
// Field descriptors
// ============================================================================

interface SelectField {
  kind: "select";
  key: keyof GordonSettings;
  label: string;
  options: Array<{ label: string; value: string }>;
}

interface TextField {
  kind: "text";
  key: keyof GordonSettings;
  label: string;
  placeholder?: string;
}

type Field = SelectField | TextField;

const TAB_FIELDS: Record<Tab, Field[]> = {
  General: [
    {
      kind: "select",
      key: "permissionMode",
      label: "Permission Mode",
      options: [
        { label: "Auto — approve automatically", value: "auto" },
        { label: "Ask — prompt before actions", value: "ask" },
        { label: "Strict — require explicit approval", value: "strict" },
      ],
    },
    {
      kind: "select",
      key: "theme",
      label: "Theme",
      options: [
        { label: "Dark", value: "dark" },
        { label: "Light", value: "light" },
        { label: "System", value: "system" },
      ],
    },
  ],
  Trading: [
    {
      kind: "select",
      key: "maxConcurrentTrades",
      label: "Max Concurrent Trades",
      options: [
        { label: "1", value: "1" },
        { label: "3", value: "3" },
        { label: "5", value: "5" },
        { label: "10", value: "10" },
      ],
    },
    {
      kind: "text",
      key: "maxPositionSizePct",
      label: "Max Position Size (%)",
      placeholder: "5",
    },
  ],
  Risk: [
    {
      kind: "select",
      key: "riskLevel",
      label: "Risk Level",
      options: [
        { label: "Conservative (1% max)", value: "conservative" },
        { label: "Moderate (2% max)", value: "moderate" },
        { label: "Aggressive (5% max)", value: "aggressive" },
      ],
    },
    {
      kind: "text",
      key: "cashReservePercent",
      label: "Cash Reserve (%)",
      placeholder: "20",
    },
  ],
  Exchange: [
    {
      kind: "select",
      key: "defaultExchange",
      label: "Default Exchange",
      options: [
        { label: "None", value: "" },
        { label: "Binance", value: "binance" },
        { label: "Coinbase", value: "coinbase" },
        { label: "Kraken", value: "kraken" },
        { label: "Hyperliquid", value: "hyperliquid" },
      ],
    },
    {
      kind: "select",
      key: "defaultBroker",
      label: "Default Broker",
      options: [
        { label: "None", value: "" },
        { label: "Alpaca", value: "alpaca" },
        { label: "Schwab", value: "schwab" },
        { label: "Webull", value: "webull" },
        { label: "Interactive Brokers", value: "ibkr" },
        { label: "Tastytrade", value: "tastytrade" },
      ],
    },
  ],
};

// ============================================================================
// Props
// ============================================================================

interface Props {
  onClose: () => void;
}

// ============================================================================
// SettingsDialog
// ============================================================================

export function SettingsDialog({ onClose }: Props) {
  const { settings, update } = useSettings();
  const [activeTab, setActiveTab] = useState<Tab>("General");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [textValue, setTextValue] = useState("");

  // Tab navigation
  useInput((input, key) => {
    if (key.escape) {
      if (editingField) {
        setEditingField(null);
        return;
      }
      onClose();
      return;
    }
    if (key.tab || (key.ctrl && input === "n")) {
      const idx = TABS.indexOf(activeTab);
      setActiveTab(TABS[(idx + 1) % TABS.length]!);
      setEditingField(null);
    }
    if (key.shift && key.tab) {
      const idx = TABS.indexOf(activeTab);
      setActiveTab(TABS[(idx - 1 + TABS.length) % TABS.length]!);
      setEditingField(null);
    }
  });

  const fields = TAB_FIELDS[activeTab];

  const handleSelectChange = useCallback(
    (field: Field, value: string) => {
      const key = field.key;
      // Convert numeric string values back to numbers
      if (key === "maxConcurrentTrades" || key === "maxPositionSizePct" || key === "cashReservePercent") {
        update(key, Number(value));
      } else {
        update(key, value as any);
      }
    },
    [update],
  );

  const handleTextSubmit = useCallback(
    (field: Field, value: string) => {
      const key = field.key;
      if (key === "maxPositionSizePct" || key === "cashReservePercent" || key === "maxConcurrentTrades") {
        const num = Number(value);
        if (!Number.isNaN(num) && num >= 0) {
          update(key, num);
        }
      } else {
        update(key, value as any);
      }
      setEditingField(null);
    },
    [update],
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box justifyContent="center">
        <Text bold color="yellow">GORDON SETTINGS</Text>
      </Box>
      <Text> </Text>

      {/* Tab bar */}
      <Box gap={1}>
        {TABS.map((tab) => (
          <Box key={tab} paddingX={1}>
            {tab === activeTab ? (
              <Text bold color="yellow" underline>{tab}</Text>
            ) : (
              <Text dimColor>{tab}</Text>
            )}
          </Box>
        ))}
      </Box>
      <Text> </Text>

      {/* Fields */}
      <Box flexDirection="column" paddingLeft={1}>
        {fields.map((field) => {
          const currentValue = String(settings[field.key]);

          return (
            <Box key={field.key} flexDirection="column" marginBottom={1}>
              <Text bold>{field.label}</Text>
              <Text dimColor>  Current: {currentValue || "(not set)"}</Text>

              {field.kind === "select" ? (
                <Box paddingLeft={2}>
                  <Select
                    options={field.options}
                    onChange={(v) => handleSelectChange(field, v)}
                  />
                </Box>
              ) : editingField === field.key ? (
                <Box paddingLeft={2}>
                  <Text color="yellow">{"\u25B6"} </Text>
                  <TextInput
                    placeholder={field.placeholder ?? ""}
                    defaultValue={currentValue}
                    onSubmit={(v) => handleTextSubmit(field, v)}
                  />
                </Box>
              ) : (
                <Box paddingLeft={2}>
                  <Text
                    dimColor
                    color="cyan"
                  >
                    Press Enter to edit
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Footer */}
      <Text> </Text>
      <Text dimColor>
        Tab/Shift+Tab switch tabs {"\u00b7"} Esc close {"\u00b7"} Changes save automatically
      </Text>
    </Box>
  );
}
