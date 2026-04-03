# Gordon Charm Client

Deprecated: this direction is no longer active. Use [docs/gordon-rezi-client.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-rezi-client.md) instead.

This document defines the new frontend boundary for Gordon after the decision to rebuild the visible TUI on the Charm stack.

It exists so the repo does not drift back into the previous mixed React/Ink design path.

---

## 1. Goal

Keep Gordon's backend and runtime system.

Replace only the visible operator cockpit.

The new client owns:

- shell layout
- transcript rendering
- inspector rendering
- tables and blotters
- overlays
- command bar
- boot and motion
- color and visual grammar

The existing TypeScript system remains the source of truth for:

- agents
- tools
- runtime state
- permissions
- approvals
- brokers
- exchanges
- rails
- strategies
- backtests
- storage
- daemon

---

## 2. Chosen Stack

The new client is built on:

- `Bubble Tea`
- `Lip Gloss`
- Charm-style fullscreen terminal architecture

This choice is intentional.

We are no longer optimizing for:

- minimal migration effort
- React component reuse
- partial compatibility with the old app layer

We are optimizing for:

- one strong terminal grammar
- deterministic fullscreen behavior
- better pane and overlay discipline
- better table/blotter rendering
- better long-term coherence

---

## 3. Backend Seam

The safest seam is not a direct port of Gordon's TypeScript UI state.

The safest seam is the existing machine-facing boundary:

- CLI JSON output
- daemon IPC
- gateway command envelopes

Relevant current files:

- [src/cli.ts](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/cli.ts)
- [src/gateway/cli-commands.ts](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/gateway/cli-commands.ts)
- [src/gateway/protocol/commands.ts](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/gateway/protocol/commands.ts)
- [src/gateway/daemon/ipc.ts](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/gateway/daemon/ipc.ts)

### Initial contract

The Charm client should talk to Gordon through structured boundaries:

- `gordon --json`
- `gordon doctor --json`
- daemon IPC request/response messages
- future `ui.snapshot` and `ui.action` style gateway commands

### Important rule

Do not bind the Charm client directly to old app-layer React concepts.

Do not recreate:

- `AppStore` semantics as-is
- screen component boundaries as-is
- old overlay ownership as-is

The new client gets a fresh frontend model.

---

## 4. Current Scaffold

The repo now contains the first Charm-client scaffold:

- [go.mod](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/go.mod)
- [main.go](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/cmd/gordon-charm/main.go)
- [types.go](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/internal/charm/backend/types.go)
- [mock.go](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/internal/charm/backend/mock.go)
- [palette.go](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/internal/charm/theme/palette.go)
- [boot.go](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/internal/charm/ui/boot.go)
- [model.go](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/internal/charm/ui/model.go)
- [view.go](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/internal/charm/ui/view.go)

This is a real restart.

It does not reuse the old React/Ink app layer.

---

## 5. Visual Direction

The chosen palette family is:

- black
- graphite
- bone
- steel
- ice blue
- muted green
- deep red
- restrained amber

Orange is not a Gordon primary.

The target feel remains:

- vibe trading atmosphere
- Wall Street seriousness
- agentic Bloomberg-terminal energy
- restrained Evangelion interlock grammar

The difference is that this is now expressed through a narrower, more coherent stack.
