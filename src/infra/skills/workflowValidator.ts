/**
 * Skill-Workflow Validator (B3)
 *
 * Validates a declarative `SkillWorkflowManifest` for two independent
 * kinds of integrity:
 *
 *   1. Skill-reference integrity — every step's `skillId` must resolve
 *      to a real skill in the registry. A workflow that references a
 *      renamed/deleted skill is a lie about capability (memory:
 *      port-by-capability), so this is an ERROR.
 *
 *   2. Data-contract integrity — walking the steps in order, every field
 *      a step `consumes` must already be available: either declared as a
 *      workflow-level input or `produces`d by an earlier step, AND the
 *      producer's type must match the consumer's declared type. A missing
 *      or type-mismatched handoff is an ERROR.
 *
 * The validator is deterministic and dependency-free — it never touches
 * the network or the model. It's the author-time gate that makes the
 * growing skill set composable instead of an untyped pile.
 */

import type {
  DataContract,
  DataContractField,
  SkillWorkflowCadence,
  SkillWorkflowManifest,
  WorkflowValidationIssue,
  WorkflowValidationResult,
} from "./types.ts";

const VALID_CADENCES: ReadonlySet<SkillWorkflowCadence> = new Set([
  "on-demand",
  "session-start",
  "daily",
  "weekly",
  "pre-trade",
  "post-trade",
]);

const VALID_FIELD_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "object",
  "array",
]);

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validate the shape of a single data contract (field names + types).
 * Populates `issues` with any problems, scoped to `stepId`.
 */
function validateContractShape(
  contract: DataContract | undefined,
  stepId: string | undefined,
  role: "inputs" | "consumes" | "produces",
  issues: WorkflowValidationIssue[],
): void {
  if (!contract) return;
  const seen = new Set<string>();
  for (const field of contract) {
    if (!field.name || field.name.trim().length === 0) {
      issues.push({
        severity: "error",
        step: stepId,
        message: `${role} contains a field with an empty name`,
      });
      continue;
    }
    if (seen.has(field.name)) {
      issues.push({
        severity: "error",
        step: stepId,
        field: field.name,
        message: `${role} declares duplicate field '${field.name}'`,
      });
    }
    seen.add(field.name);
    if (!VALID_FIELD_TYPES.has(field.type)) {
      issues.push({
        severity: "error",
        step: stepId,
        field: field.name,
        message: `${role} field '${field.name}' has invalid type '${field.type}'`,
      });
    }
  }
}

/**
 * Validate one workflow manifest against the set of skills that resolve.
 *
 * @param manifest          the workflow to check
 * @param availableSkillIds skill IDs known to the registry (array or Set)
 */
export function validateWorkflowManifest(
  manifest: SkillWorkflowManifest,
  availableSkillIds: Iterable<string>,
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  const skillSet =
    availableSkillIds instanceof Set
      ? (availableSkillIds as Set<string>)
      : new Set(availableSkillIds);

  // ── Manifest-level shape ──────────────────────────────────────
  if (!manifest.id || !ID_PATTERN.test(manifest.id)) {
    issues.push({
      severity: "error",
      field: "id",
      message: `workflow id '${manifest.id}' must be kebab-case [a-z0-9-]`,
    });
  }
  if (!manifest.description || manifest.description.trim().length === 0) {
    issues.push({ severity: "error", field: "description", message: "description is required" });
  }
  if (!VALID_CADENCES.has(manifest.cadence)) {
    issues.push({
      severity: "error",
      field: "cadence",
      message: `cadence '${manifest.cadence}' is not a recognized cadence`,
    });
  }
  if (!Array.isArray(manifest.steps) || manifest.steps.length === 0) {
    issues.push({
      severity: "error",
      field: "steps",
      message: "workflow must declare at least one step",
    });
    return { workflowId: manifest.id, ok: false, issues };
  }

  validateContractShape(manifest.inputs, undefined, "inputs", issues);

  // ── Data-contract walk ────────────────────────────────────────
  // `available` maps a field name to its declared type; seeded with the
  // workflow inputs and grown by each step's produces.
  const available = new Map<string, string>();
  for (const field of manifest.inputs ?? []) {
    if (field.name) available.set(field.name, field.type);
  }

  const seenSteps = new Set<string>();
  for (const step of manifest.steps) {
    const stepId = step.skillId;

    if (!skillSet.has(stepId)) {
      issues.push({
        severity: "error",
        step: stepId,
        message: `step references skill '${stepId}' which does not resolve in the registry`,
      });
    }
    if (seenSteps.has(stepId)) {
      issues.push({
        severity: "warning",
        step: stepId,
        message: `skill '${stepId}' appears more than once in the chain`,
      });
    }
    seenSteps.add(stepId);

    validateContractShape(step.consumes, stepId, "consumes", issues);
    validateContractShape(step.produces, stepId, "produces", issues);

    // Consumed fields must already be available with a matching type.
    for (const need of step.consumes ?? []) {
      const required = need.required !== false;
      const producedType = available.get(need.name);
      if (producedType === undefined) {
        if (required) {
          issues.push({
            severity: "error",
            step: stepId,
            field: need.name,
            message: `consumes '${need.name}' but no upstream step or workflow input produces it`,
          });
        } else {
          issues.push({
            severity: "warning",
            step: stepId,
            field: need.name,
            message: `optional field '${need.name}' has no upstream producer`,
          });
        }
        continue;
      }
      if (producedType !== need.type) {
        issues.push({
          severity: "error",
          step: stepId,
          field: need.name,
          message: `consumes '${need.name}' as ${need.type} but upstream produces it as ${producedType}`,
        });
      }
    }

    // Publish this step's outputs for downstream steps.
    for (const out of step.produces ?? []) {
      if (out.name) available.set(out.name, out.type);
    }
  }

  const ok = !issues.some((i) => i.severity === "error");
  return { workflowId: manifest.id, ok, issues };
}

/**
 * Validate a batch of manifests. Also flags duplicate workflow IDs across
 * the batch (a registry-integrity error the single-manifest check can't see).
 */
export function validateWorkflowManifests(
  manifests: SkillWorkflowManifest[],
  availableSkillIds: Iterable<string>,
): WorkflowValidationResult[] {
  const skillSet = new Set(availableSkillIds);
  const results = manifests.map((m) => validateWorkflowManifest(m, skillSet));

  const seenIds = new Set<string>();
  for (let i = 0; i < manifests.length; i++) {
    const id = manifests[i]!.id;
    if (seenIds.has(id)) {
      results[i]!.issues.push({
        severity: "error",
        field: "id",
        message: `duplicate workflow id '${id}' in the manifest set`,
      });
      results[i]!.ok = false;
    }
    seenIds.add(id);
  }
  return results;
}

/** Convenience: field helper so manifests read declaratively. */
export function field(
  name: string,
  type: DataContractField["type"],
  opts: { required?: boolean; description?: string } = {},
): DataContractField {
  return { name, type, ...opts };
}
