import React from "react";
import { Text } from "../ink-custom";

// Stash notice — shows when input is stashed during history navigation
interface Props {
  visible: boolean;
}

export function StashNotice({ visible }: Props) {
  if (!visible) return null;
  return <Text dimColor>  Stashed — auto-restores after submit</Text>;
}
