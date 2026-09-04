# Gordon documentation

Gordon is a local-first trading agent for crypto, equities, options, and futures. This index starts with the task you are trying to complete, then points to the source of truth for deeper behavior and safety details.

## Start here

| I want to | Read |
|---|---|
| Install Gordon and reach a safe first session | [Getting started](./getting-started.md) |
| Understand why Gordon is built around plans, approvals, and deterministic gates | [Why Gordon](./why-gordon.md) |
| See the complete analysis, execution, memory, evaluation, and autonomy inventory | [Capabilities](./capabilities.md) |
| Understand the three-agent split and runtime boundaries | [Architecture](./architecture.md) |
| Connect an exchange, broker, model, data source, or editor | [Integrations](./integrations.md) |
| Run Gordon headlessly, as a daemon, over ACP or MCP, or on a schedule | [Operations](./operations.md) |
| Configure permissions, risk controls, kill switches, and process hardening | [Security and safety](./security/README.md) |
| Contribute or build Gordon from source | [Contributing](../CONTRIBUTING.md) |

## Safety references

These documents describe narrow parts of the safety model in more detail:

- [Permission profiles](./security/PERMISSION-PROFILES.md) explains the optional `read_only`, `paper_trading`, and `live_trading` profile chain.
- [Risk taxonomy](./security/RISK-TAXONOMY.md) maps failure classes to the controls that own them.
- [Process hardening](./security/PROCESS-HARDENING.md) covers core dumps, diagnostic reports, and debugger exposure.
- [Subprocess sandbox](./security/SUBPROCESS-SANDBOX.md) describes the opt-in confinement wrapper for third-party child processes.
- [Security policy](../SECURITY.md) defines supported versions, threat scope, and private reporting.
- [Disclaimer](../DISCLAIMER.md) and [terms](../TERMS.md) apply before live trading.

## Reference material

| Reference | Purpose |
|---|---|
| [Environment example](../.env.example) | Complete credential, provider, data-source, and advanced override catalog |
| [Generated action catalog](./generated/actions.md) | Canonical cross-surface actions generated from the runtime registry |
| [Library adoption catalog](./library-adoption/README.md) | Research and implementation notes for adopted quantitative libraries |
| [Release guide](../RELEASE.md) | Maintainer release process |
| [Scripts guide](../scripts/README.md) | Build, audit, generation, and maintenance scripts |

## Historical documents

[`docs/archived/`](./archived/) contains completed plans, design explorations, migration notes, and dated audits. They preserve decisions, but they do not override the runtime, the root README, or the maintained guides above. [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) is a completed 2026 audit backlog and should be read as a historical snapshot.

## Documentation contract

The runtime is the authority for inventories and safety behavior. Public documents should link to the owning source instead of copying large registries. `bun run check:docs` binds counts and descriptions in the entry-point documents above to source, and also checks their local links, heading order, empty sections, and no-em-dash style rule.
