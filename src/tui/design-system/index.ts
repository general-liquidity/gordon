// ============================================================================
// Design System — Barrel Export
// ============================================================================

export { Pane } from "./Pane.js";
export { TitledBox, buildTopBorder, embedTitleInBorder, panelToneColor } from "./TitledBox.js";
export type { PanelAlign, PanelTone, PanelBorderStyle } from "./TitledBox.js";
export { Link, supportsHyperlinks, osc8Link, linkString } from "./Link.js";
export { ThemedBox } from "./ThemedBox.js";
export { ThemedText, toneColor } from "./ThemedText.js";
export type { TextTone } from "./ThemedText.js";
export { StatusIcon } from "./StatusIcon.js";
export { LoadingState } from "./LoadingState.js";
export { Tabs } from "./Tabs.js";
export { ProgressBar } from "./ProgressBar.js";
export { ListItem } from "./ListItem.js";
export { OrderedList, OrderedListItem, orderedListMarker, orderedMarkerColor } from "./OrderedList.js";
export { Dialog } from "./Dialog.js";
export { FuzzyPicker } from "./FuzzyPicker.js";
export type { PickerItem } from "./FuzzyPicker.js";
export { KeyboardShortcutHint, formatKeys } from "./KeyboardShortcutHint.js";
export { KeyboardHints } from "./KeyboardHints.js";
export type { KeyHint } from "./KeyboardHints.js";
export { Button, buttonVariantColor } from "./Button.js";
export type { ButtonVariant } from "./Button.js";
export { MultiStepPicker, pickerTransition } from "./MultiStepPicker.js";
export type {
  MultiStepPickerProps,
  PickerMachineEvent,
  PickerMachineState,
  PickerStep,
  PickerStepContext,
} from "./MultiStepPicker.js";
export { SearchBox } from "./SearchBox.js";
export {
  getAgentColor,
  getMoneyColor,
  getRiskColor,
  getSignalColor,
  useAgentColor,
  useMoneyColor,
  useRiskColor,
  useSignalColor,
} from "./colorMap.js";
export type { RiskLevel, SignalSide } from "./colorMap.js";

// Keyboard shortcut components
export { ConfigurableShortcutHint } from "./ConfigurableShortcutHint.js";
export { KeybindingWarnings } from "./KeybindingWarnings.js";

// Select hooks
export { useSelectState } from "./use-select-state.js";
export type { SelectState } from "./use-select-state.js";
export { useSelectInput } from "./use-select-input.js";
export type { SelectInputOption } from "./use-select-input.js";
export { useSelectNavigation } from "./use-select-navigation.js";
export { useMultiSelectState } from "./use-multi-select-state.js";
export type { MultiSelectState } from "./use-multi-select-state.js";
