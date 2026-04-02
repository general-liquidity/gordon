import React from "react";
import { Text } from "ink";

import type { CockpitLineItem } from "../../cockpitModels.ts";
import { COLORS } from "../../theme.ts";
import { DeskPanel, getDeskToneColor, type DeskTone } from "../desk/DeskPanel.tsx";

export const CockpitLines: React.FC<{
  eyebrow: string;
  title: string;
  subtitle: string;
  lines: CockpitLineItem[];
  tone?: DeskTone;
}> = ({ eyebrow, title, subtitle, lines, tone = "brand" }) => (
  <DeskPanel eyebrow={eyebrow} title={title} subtitle={subtitle} tone={tone}>
    {lines.map((line) => (
      <Text key={`${line.label}:${line.value}`} color={getDeskToneColor(line.tone ?? "neutral")}>
        {line.label}
        <Text color={COLORS.DIM}> · {line.value}</Text>
        {line.detail ? <Text color={COLORS.DIM}> · {line.detail}</Text> : null}
      </Text>
    ))}
  </DeskPanel>
);
