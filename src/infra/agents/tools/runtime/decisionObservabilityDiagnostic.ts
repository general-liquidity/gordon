/**
 * Decision Observability Diagnostic Tools — DEC1 wrappers.
 *
 * Two agent-callable tools:
 *   - stamp_edit_prediction: produce a stamped record at edit-time
 *   - verify_edit_prediction: compare predicted vs realized after the window
 *
 * The caller (ACE Curator, eval harness, operator) persists the
 * stamped record however it wants. This tool surface does not write to
 * disk — it only computes the verdict.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  stampEditPrediction,
  verifyEditPrediction,
  stampedEditToPayload,
  verificationToPayload,
} from "../../../safety/anti-trap/decisionObservability.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

const EDIT_KIND = z.enum([
  "ace_lesson",
  "harness_edit",
  "config_change",
  "skill_update",
  "rule_adjustment",
  "other",
]);

const WINDOW_TYPE = z.enum(["trades", "days", "observations"]);
const DIRECTION = z.enum(["increase", "decrease"]);
const EDIT_STATUS = z.enum(["pending", "verified", "failed", "expired", "still_pending"]);

const PREDICTION_SCHEMA = z.object({
  metric: z.string().min(1),
  direction: DIRECTION,
  expectedDelta: z.number().positive(),
  baseline: z.number(),
  verificationWindow: z.object({
    type: WINDOW_TYPE,
    n: z.number().int().min(1),
  }),
});

const STAMPED_SCHEMA = z.object({
  editId: z.string(),
  editKind: EDIT_KIND,
  editDescription: z.string(),
  prediction: PREDICTION_SCHEMA,
  predictedThreshold: z.number(),
  rationale: z.string().optional(),
  stampedAt: z.string(),
  contractHash: z.string(),
  status: z.literal("pending"),
});

export const stampEditPredictionTool = createTool({
  id: "stamp_edit_prediction",
  description:
    "Stamp an edit (ACE-distilled lesson, harness change, config tweak) with a self-declared prediction at " +
    "edit-time. Returns a structured record with a contract hash that downstream verification can compare " +
    "against. Use whenever an edit claims to improve a measurable outcome — the prediction becomes the " +
    "falsifiable contract the edit must satisfy.",
  inputSchema: z.object({
    editId: z.string().min(1),
    editKind: EDIT_KIND,
    editDescription: z.string().min(10),
    prediction: PREDICTION_SCHEMA,
    rationale: z.string().optional(),
    stampedAt: z.string().optional(),
  }),
  outputSchema: z.object({
    record: STAMPED_SCHEMA,
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const record = stampEditPrediction({
      editId: input.editId,
      editKind: input.editKind,
      editDescription: input.editDescription,
      prediction: input.prediction,
      rationale: input.rationale,
      stampedAt: input.stampedAt,
    });
    recordStructuredObservation({
      eventType: "decision_observability.stamped",
      workflow: "harness_evolution",
      source: "agent_tool",
      component: "stamp_edit_prediction",
      toolName: "stamp_edit_prediction",
      outcome: "info",
      details: { ...(stampedEditToPayload(record) as Record<string, unknown>) },
    });
    const reasoning =
      `Stamped edit ${record.editId} (${record.editKind}): predicts ${record.prediction.metric} ` +
      `${record.prediction.direction} by ≥${record.prediction.expectedDelta} from ${record.prediction.baseline} ` +
      `(threshold ${record.predictedThreshold}) over ${record.prediction.verificationWindow.n} ` +
      `${record.prediction.verificationWindow.type}. Contract hash ${record.contractHash.slice(0, 8)}.`;
    return { record, reasoning, summary: reasoning };
  },
});

export const verifyEditPredictionTool = createTool({
  id: "verify_edit_prediction",
  description:
    "Verify a previously-stamped edit prediction against the realized metric. Returns verdict (verified / " +
    "failed / still_pending) plus directionality + magnitude + contract-integrity flags. Failed predictions " +
    "are the signal for the caller to revert or re-evaluate the edit. Call AFTER the verification window has " +
    "elapsed and the metric has been re-measured.",
  inputSchema: z.object({
    stamped: STAMPED_SCHEMA,
    observedValue: z.number(),
    windowElapsed: z.boolean(),
    originalStampInput: z
      .object({
        editId: z.string(),
        editKind: EDIT_KIND,
        editDescription: z.string(),
        prediction: PREDICTION_SCHEMA,
        rationale: z.string().optional(),
        stampedAt: z.string().optional(),
      })
      .optional()
      .describe(
        "Optionally pass the original stamp input. If supplied, the contract hash is recomputed to detect tampering between stamp and verify.",
      ),
  }),
  outputSchema: z.object({
    editId: z.string(),
    status: EDIT_STATUS,
    observedValue: z.number(),
    observedDelta: z.number(),
    predictedThreshold: z.number(),
    directionCorrect: z.boolean(),
    magnitudeMet: z.boolean(),
    contractIntact: z.boolean(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = verifyEditPrediction({
      stamped: input.stamped,
      observedValue: input.observedValue,
      windowElapsed: input.windowElapsed,
      originalStampInput: input.originalStampInput,
    });
    recordStructuredObservation({
      eventType: "decision_observability.verified",
      workflow: "harness_evolution",
      source: "agent_tool",
      component: "verify_edit_prediction",
      toolName: "verify_edit_prediction",
      outcome: "info",
      details: { ...(verificationToPayload(result) as Record<string, unknown>) },
    });
    return { ...result, summary: result.reasoning };
  },
});

export const decisionObservabilityTools = {
  stamp_edit_prediction: stampEditPredictionTool,
  verify_edit_prediction: verifyEditPredictionTool,
};
