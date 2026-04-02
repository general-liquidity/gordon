import React from "react";
import { Text } from "ink";

import { COLORS } from "../../theme.ts";
import { DeskPanel, type DeskTone } from "../desk/DeskPanel.tsx";

function renderLine(line: string, index: number): React.ReactElement {
  if (line.startsWith("## ")) {
    return <Text key={index} color={COLORS.BRASS} bold>{line.slice(3)}</Text>;
  }
  if (line.startsWith("# ")) {
    return <Text key={index} color={COLORS.BRASS} bold>{line.slice(2)}</Text>;
  }
  if (line.startsWith("- ")) {
    return (
      <Text key={index} color={COLORS.WHITE}>
        • <Text color={COLORS.DIM}>{line.slice(2)}</Text>
      </Text>
    );
  }
  if (line.trim().length === 0) {
    return <Text key={index}> </Text>;
  }
  return <Text key={index} color={COLORS.WHITE}>{line}</Text>;
}

export const MarkdownPane: React.FC<{
  eyebrow: string;
  title: string;
  subtitle: string;
  markdown: string;
  tone?: DeskTone;
}> = ({ eyebrow, title, subtitle, markdown, tone = "analysis" }) => (
  <DeskPanel eyebrow={eyebrow} title={title} subtitle={subtitle} tone={tone}>
    {markdown.split("\n").map((line, index) => renderLine(line, index))}
  </DeskPanel>
);
