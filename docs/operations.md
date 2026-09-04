# Operating Gordon

Gordon has one engine and several supported front ends. Choose the surface that matches the job, then keep the same permission, risk, and audit expectations across them.

## Run surfaces

| Surface | Start with | Best for |
|---|---|---|
| TUI | `gordon` | Interactive research, planning, approval, monitoring, and portfolio work |
| Headless | `gordon --headless "prompt"` | One prompt in and one response out for scripts and pipes |
| Daemon | `gordon daemon start` | Long-running IPC gateway, schedules, reconciliation, and circuit breakers |
| ACP | `npm run acp` | Editor and IDE clients using Agent Client Protocol over stdio |
| MCP | `npm run mcp` | Compatible hosts that call Gordon tools through Model Context Protocol |
| Schedules | `gordon schedule add ...` | Cron-style bounded mandates handled by the daemon |

These are front ends, not separate safety modes. Agent-issued exposure increases still pass through the same execution and audit spine.

## Supported launch boundary

Use one of these entry points:

```text
gordon
node bin/gordon.cjs
npm run acp
npm run mcp
```

Do not invoke `src/entry.ts`, `src/index.tsx`, `src/app/acp-entry.ts`, or `src/infra/ai/mcp/serveCli.ts` directly with Bun. A caller-controlled working directory can supply a `bunfig.toml` preload before Gordon's first source instruction. The supported wrapper chooses the intended runtime mode and disables implicit current-directory dotenv loading before Bun starts.

## TUI

The terminal interface organizes work into Desk, Market, Plan, Lab, and Monitor workspaces. It uses Gordon's custom Ink framebuffer, with vim-style navigation, interactive approvals, radar cards, and slash commands.

Common operator commands:

```text
/doctor       inspect runtime and integration health
/scan         search for current candidates
/analyze      examine one instrument
/plan         create a structured plan
/portfolio    inspect balances and exposure
/backtest     run historical evaluation
/killswitch   inspect, trip, or reset a scoped halt
/flags        inspect and persist operator settings
/telemetry    inspect or change telemetry consent
```

The generated [action catalog](./generated/actions.md) covers the canonical actions shared across surfaces. Use `/help` for the complete live slash-command registry.

## Headless runs

Headless mode is useful for automation that needs a single bounded turn:

```bash
gordon --headless "Review BTC and return a plan, but do not execute"
```

The prompt does not override the active permission mode. A script that asks for a trade is still subject to the same approval and risk decisions as the TUI.

## Daemon and schedules

The daemon hosts the gateway over authenticated local IPC and owns long-running work such as scheduled slots, reconciliation, and circuit-breaker checks.

```bash
gordon daemon start
gordon daemon status
gordon schedule add ...
```

CI starts the real daemon in a validation-only mode, authenticates over the actual IPC transport, runs a health command, proves unrelated persisted work did not execute, stops the process, and verifies the endpoint is gone. That path resolves no model, venue, or order.

Schedules are mandates, not unrestricted cron callbacks. Expiry, scope, permission, and execution gates still apply when a scheduled turn reaches a money-touching action.

## ACP

ACP exposes Gordon through a JSON-RPC stdio server for editors such as Zed and Athas:

```bash
npm run acp
```

ACP accepts text and attachment descriptors through its current string-only model boundary. `GORDON_ACP_VISION_PATH=blocks` is refused until native content blocks are wired.

Forwarded stdio MCP servers are refused unless the operator sets `GORDON_ACP_ALLOW_STDIO_MCP=1`. Forwarded HTTP and SSE endpoints are checked for DNS rebinding and local or private-address targets.

## MCP

MCP exposes Gordon tools to compatible hosts:

```bash
npm run mcp
```

Third-party MCP servers may need outbound network access and may execute their own code. Use the permission engine, network policy, and optional [subprocess sandbox](./security/SUBPROCESS-SANDBOX.md) according to the server's trust level.

## Settings and flags

`/flags` is the durable operator surface. It writes to `~/.gordon/settings.local.json`; environment variables remain useful for CI and one-run overrides.

The merged settings order is:

```text
CLI > session > signed policy > signed sync > local > project > profile > defaults
```

Safety-critical `flags` values are not accepted from `.gordon/settings.json` in the current project. A repository must not be able to disable the kill switch or widen risk limits for the process evaluating it.

Some settings are on by default and tune core behavior. Others are explicit opt-ins because they alter cross-session state, spawn behavior, or supervision:

| Setting | Effect |
|---|---|
| `GORDON_ACE_ENABLED=1` | Distill action-log lessons into later sessions |
| `GORDON_DYNAMIC_SUBAGENTS=1` | Allow operator-authored subagent profiles to spawn |
| `GORDON_DEFER_WORKING_MEMORY=1` | Buffer working-memory writes until session boundaries |
| `GORDON_MEMORY_WRITE_GUARD=1` | Block untrusted changes to sensitive memory fields |
| `GORDON_SPRINT_CONTRACT=1` | Record scope and actuals for autonomous-loop sessions |
| `GORDON_AGENT_READINESS_GATE=1` | Add readiness diagnostics to `/doctor`; it does not block agent spawn |
| `GORDON_RISK_ACK=1` | Require explicit risk enumeration on medium-or-higher execution |
| `GORDON_ALLOW_LIVE=1` | Permit implicit live routing on a venue with no sandbox when no explicit mode was supplied |

Run `/flags` for the live registry and current values. [`.env.example`](../.env.example) remains the complete advanced configuration catalog.

## Managed policy and synced settings

A managed deployment can provide a signed, high-priority `policy.json`. The HMAC key must come from `GORDON_POLICY_KEY` in the process environment and is not exposed through `/flags` or persisted in settings.

If a policy file exists but is unsigned, malformed, or fails verification, Gordon refuses the layer. Signed synced settings sit below organization policy and above local state, allowing cross-machine risk settings without giving them power over managed policy.

## Telemetry and data movement

Gordon is local-first, not offline.

Stored settings, memory, audit data, and local telemetry queues live on the operator's machine. Requests still leave the machine when required by a configured integration:

- Model prompts go to the selected model provider unless a local compatible host is used.
- Market and account requests go to selected exchanges, brokers, and data sources.
- Configured HTTP, SSE, and MCP integrations receive their requested payloads.

Anonymous Gordon usage telemetry is disabled by default and requires explicit consent. When enabled, events are queued locally and sent to Gordon's telemetry endpoint. Research-data sharing is a separate opt-in because it can involve financial data.

Use either variable to force usage telemetry off:

```bash
export DO_NOT_TRACK=1
# or
export GORDON_TELEMETRY_DISABLED=1
```

OpenTelemetry instrumentation and traces remain local; external OTLP export has been removed.

## External hooks

Operator-defined lifecycle hooks are opt-in:

```bash
export GORDON_EXTERNAL_HOOK_RUNNER=1
export GORDON_EXTERNAL_HOOKS_PATH="/absolute/path/to/hooks.json"
```

When the runner is enabled, the registry must exist, parse, and contain at least one hook. Gordon aborts startup on an absent, malformed, or empty registry rather than silently running without expected policy.

## Operational checks

```bash
bun run check:daemon-startup  # real IPC and scheduler lifecycle, no model or venue
bun run quality:brokers       # broker conformance and latency gate
bun run eval:burn-in -- --cycles 2 --k 2
bun run check:test-shards     # exact ownership for release test shards
bun run check:docs            # public documentation structure and source facts
```

## Failure expectations

- A missing credential should make the relevant integration unavailable, not invent data.
- A stale or changed approved plan should require a new approval.
- A tripped halt should refuse new risk while verified reductions stay available.
- An unknown permission profile should apply no profile and emit a warning.
- A configured but unverifiable managed policy should be refused.
- An unavailable opt-in subprocess sandbox currently warns and passes the child through unchanged; it is defense in depth, not a mandatory container boundary.

## Related guides

- [Getting started](./getting-started.md)
- [Integrations](./integrations.md)
- [Security and safety](./security/README.md)
- [Architecture](./architecture.md)
