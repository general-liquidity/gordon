# Internal Boundaries

Gordon should scale like an internal platform without forcing a monorepo/package split too early.

## Current Seams

- `src/app`
  - TUI surfaces and user interaction policies
- `src/core`
  - trading domain logic, runtime, execution, risk, monitoring
- `src/infra`
  - integrations, providers, tools, storage, routing, telemetry
- `src/gateway`
  - daemon, IPC, scheduler, runtime ownership
- `src/sdk`
  - programmatic scaffolding and templates

## Boundary Rules

- UI policy belongs in `src/app`, not scattered through `App.tsx`.
- Prompt truth belongs in one dedicated prompt-truth seam, not duplicated across agent strings.
- Execution and market semantics belong in `core` or `infra`, not in UI copy.
- High-churn surfaces should expose facades before they are split into packages.

## Facades Added In This Pass

- `src/app/index.ts`
  - stable app/TUI surface export
- `src/infra/agents/capabilityTruth.ts`
  - single source of truth for prompt-facing product positioning
- `src/app/threadDensity.ts`
  - transcript density and visible-window policy
- `src/app/tuiSemantics.ts`
  - semantic loader and task-tree presentation rules

## Why Not A Pi-Style Package Split Yet

- Gordon already has meaningful top-level layers.
- The current problem is boundary drift, not package publishing.
- A package split now would add import churn and tooling complexity before the internal seams are stable.

The right next step is to keep tightening facades and policies inside the current repo. Package extraction should only happen if Gordon needs separate build, reuse, or embedding boundaries that the current structure cannot support.
