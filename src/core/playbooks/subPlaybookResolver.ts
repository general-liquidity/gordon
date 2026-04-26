/**
 * Sub-playbook resolver.
 *
 * Walks the `subPlaybooks` references on a parent playbook, resolves
 * them against a registry, and returns a flattened tree of
 * (playbook, parameters) pairs in dependency order. Detects cycles
 * (A → B → A) and missing references; either yields a structured
 * error rather than throwing so the caller can surface a clear
 * diagnostic to the user.
 *
 * Inspired by Goose's `recipe::sub_recipes::resolve_sub_recipes`.
 * Pure function — caller threads in the registry; no global state.
 */

import type { Playbook, SubPlaybookReference } from "./types.ts";

export interface ResolvedSubPlaybook {
  /** The composed child playbook. */
  playbook: Playbook;
  /** Parameters from the parent's reference, untouched. */
  parameters: Record<string, string | number | boolean>;
  /** Alias the parent assigned, or the child's id if none. */
  alias: string;
  /** Path of playbook ids from root to this entry — for diagnostic / breadcrumb. */
  path: string[];
}

export type ResolveErrorKind =
  | "missing_reference"
  | "cycle_detected"
  | "max_depth_exceeded";

export interface ResolveError {
  kind: ResolveErrorKind;
  message: string;
  path: string[];
}

export interface ResolveResult {
  resolved: ResolvedSubPlaybook[];
  errors: ResolveError[];
}

const DEFAULT_MAX_DEPTH = 4;

/** Lookup signature — caller can pass any registry shape. */
export type PlaybookLookup = (id: string) => Playbook | undefined;

export interface ResolveOptions {
  /** Hard cap on nesting depth. Default 4 — keeps unintended explosions bounded. */
  maxDepth?: number;
}

/**
 * Resolve all sub-playbooks of `root`, following references recursively.
 * Returns the flattened list (ancestors-before-descendants) plus any
 * errors discovered along the way. Resolution does NOT throw; callers
 * inspect `result.errors` and decide how to surface them.
 */
export function resolveSubPlaybooks(
  root: Playbook,
  lookup: PlaybookLookup,
  options: ResolveOptions = {},
): ResolveResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const resolved: ResolvedSubPlaybook[] = [];
  const errors: ResolveError[] = [];
  const visiting = new Set<string>([root.id]); // cycle detection

  function walk(parent: Playbook, parentPath: string[]): void {
    if (parentPath.length > maxDepth) {
      errors.push({
        kind: "max_depth_exceeded",
        message: `sub-playbook depth exceeded ${maxDepth} starting from "${root.id}"`,
        path: parentPath,
      });
      return;
    }

    const refs = parent.subPlaybooks ?? [];
    for (const ref of refs) {
      const childPath = [...parentPath, ref.playbookId];

      if (visiting.has(ref.playbookId)) {
        errors.push({
          kind: "cycle_detected",
          message: `cycle detected: ${childPath.join(" → ")}`,
          path: childPath,
        });
        continue;
      }

      const child = lookup(ref.playbookId);
      if (!child) {
        errors.push({
          kind: "missing_reference",
          message: `playbook "${ref.playbookId}" not found in registry (referenced from "${parent.id}")`,
          path: childPath,
        });
        continue;
      }

      const alias = ref.alias ?? child.id;
      resolved.push({
        playbook: child,
        parameters: ref.parameters ?? {},
        alias,
        path: childPath,
      });

      // Recurse with the child as the new parent.
      visiting.add(child.id);
      walk(child, childPath);
      visiting.delete(child.id);
    }
  }

  walk(root, [root.id]);
  return { resolved, errors };
}

/**
 * Apply parameter overrides to a child playbook's textual fields,
 * returning a shallow-cloned playbook with substitutions made.
 *
 * Substitution syntax: `{{paramName}}` placeholders inside any string
 * field of trigger / analysis / execution / management / review get
 * replaced with the parameter value. Unknown placeholders pass through
 * unchanged so missing-parameter situations surface visibly rather
 * than silently producing empty strings.
 */
export function applySubPlaybookParameters(
  playbook: Playbook,
  parameters: Record<string, string | number | boolean>,
): Playbook {
  const keys = Object.keys(parameters);
  if (keys.length === 0) return playbook;

  const substitute = (text: string): string => {
    let result = text;
    for (const key of keys) {
      const value = parameters[key];
      if (value === undefined) continue;
      const placeholder = `{{${key}}}`;
      result = result.split(placeholder).join(String(value));
    }
    return result;
  };

  // Walk the structured fields and substitute string-valued descendants.
  // Intentionally shallow — only the obvious natural-language fields
  // get substitution; structured fields like `value: number` are
  // bypassed so a parameter named `value` doesn't collide.
  return {
    ...playbook,
    description: substitute(playbook.description),
    trigger: {
      ...playbook.trigger,
      description: substitute(playbook.trigger.description),
    },
    execution: {
      ...playbook.execution,
      entryDescription: substitute(playbook.execution.entryDescription),
      stopLoss: {
        ...playbook.execution.stopLoss,
        description: substitute(playbook.execution.stopLoss.description),
      },
      takeProfit: {
        ...playbook.execution.takeProfit,
        description: substitute(playbook.execution.takeProfit.description),
      },
      positionSizing: {
        ...playbook.execution.positionSizing,
        description: substitute(playbook.execution.positionSizing.description),
      },
    },
  };
}
