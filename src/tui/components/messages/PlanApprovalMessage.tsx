import React from "react";
import { Box, Text } from "../../ink-custom";
import type { Message } from "./MessageBubble.tsx";
import {
  isPlanRubricEnabled,
  RUBRIC_DIMENSIONS,
  type RubricDimension,
} from "../../../infra/safety/planRubric.ts";

// PlanApprovalMessage — plan ready for human review.
// Renders a cyanBright-bordered box:
//   ◈ PLAN READY FOR REVIEW
//     {content}
//     [6-dimension rubric bars when present]
//     [Enter] to approve in chat

const DIMENSION_LABELS: Record<RubricDimension, string> = {
  correctness: "Correctness",
  verification: "Verification",
  scopeDiscipline: "Scope",
  reliability: "Reliability",
  maintainability: "Maintain",
  handoffReadiness: "Handoff",
};

function scoreBar(score: number): string {
  const filled = "▓".repeat(score);
  const empty = "░".repeat(2 - score);
  return `${filled}${empty}`;
}

function verdictColor(verdict: string): string {
  if (verdict === "accept") return "green";
  if (verdict === "revise") return "yellow";
  return "red";
}

function PlanApprovalMessageInner({ message }: { message: Message }) {
  const rubricPayload = message.planRubric;
  const showRubric = isPlanRubricEnabled() && rubricPayload;

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderColor="cyanBright"
      paddingX={2}
    >
      <Box>
        <Text color="cyanBright" bold>{"◈ PLAN READY FOR REVIEW"}</Text>
      </Box>
      {message.content ? (
        <Box paddingLeft={2}>
          <Text>{message.content}</Text>
        </Box>
      ) : null}
      {showRubric ? (
        <Box flexDirection="column" paddingLeft={2} marginTop={1}>
          <Text dimColor>Plan rubric ({rubricPayload.total}/12)</Text>
          {RUBRIC_DIMENSIONS.map((dim) => (
            <Box key={dim}>
              <Text dimColor>{`${DIMENSION_LABELS[dim].padEnd(12)} `}</Text>
              <Text>{scoreBar(rubricPayload.rubric[dim])}</Text>
              <Text dimColor>{` ${rubricPayload.rubric[dim]}/2`}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text color={verdictColor(rubricPayload.verdict)} bold>
              {`Verdict: ${rubricPayload.verdict.toUpperCase()}`}
            </Text>
          </Box>
          {rubricPayload.verdict !== "accept" && rubricPayload.blockingDimensions.length > 0 ? (
            <Box>
              <Text dimColor>
                {`Blocking: ${rubricPayload.blockingDimensions.join(", ")}`}
              </Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
      <Box paddingLeft={2}>
        <Text dimColor>{"[Enter] to approve in chat"}</Text>
      </Box>
    </Box>
  );
}

export const PlanApprovalMessage = React.memo(
  PlanApprovalMessageInner,
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.planRubric?.total === next.message.planRubric?.total &&
    prev.message.planRubric?.verdict === next.message.planRubric?.verdict,
);