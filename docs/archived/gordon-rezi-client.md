# Gordon Rezi Client

This document replaces the aborted Charm-client direction.

It defines the new frontend boundary for Gordon after choosing to keep the cockpit TypeScript-native and rebuild it on Rezi.

---

## 1. Decision

Gordon should not split the visible terminal into a Go frontend and a TypeScript backend.

Gordon should keep:

- TypeScript
- the existing runtime/orchestration/backend system
- Bun/Node compatibility

And rebuild the cockpit on:

- `Rezi`

This keeps the system native to the repository while moving away from Ink's weaker fullscreen workstation model.

---

## 2. Why Rezi

Rezi is a better fit than Ink for the Gordon cockpit because it is closer to the product Gordon actually wants to be:

- fullscreen
- table-heavy
- overlay-heavy
- state-driven
- dense
- instrument-like

The important Rezi properties are:

- TypeScript-native
- native-backed rendering
- stronger built-in support for tables, virtual lists, overlays, focus zones, and visual density
- animation support that can be used for a premium terminal feel without leaving TS

---

## 3. Why Not Charm

The Charm path was directionally coherent, but wrong for Gordon's implementation context.

It introduced:

- a second language
- a second toolchain
- a bridge boundary too early
- more debugging surface area
- more migration complexity than needed

That cost is not justified while a TypeScript-native alternative exists.

So the Charm-client tree should be treated as abandoned scaffolding, not the path forward.

---

## 4. Backend Seam

The backend seam remains structured and explicit.

The new Rezi client should talk to Gordon through:

- runtime/session services
- daemon IPC
- gateway command envelopes
- structured JSON/typed snapshot actions where needed

Relevant existing files:

- [src/cli.ts](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/cli.ts)
- [src/gateway/cli-commands.ts](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/gateway/cli-commands.ts)
- [src/gateway/protocol/commands.ts](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/gateway/protocol/commands.ts)
- [src/gateway/daemon/ipc.ts](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/gateway/daemon/ipc.ts)
- [src/runtime](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/runtime)

The important distinction is:

- structured seam: yes
- cross-language bridge: no

---

## 5. Native Gordon Components

We should not import `ticker` as a product dependency and try to wrap it.

We should build Gordon-native Rezi components inspired by `ticker`:

- `WatchTable`
- `BlotterTable`
- `OrderBookLadder`
- `CompareMatrix`
- `MiniChartCell`
- `TicketSheet`
- `ReviewDrawer`

These components should be:

- Gordon-owned
- Gordon-styled
- Gordon-keybound
- Gordon-data-native

That is what “native ticker component” means in Gordon:

- not embedding ticker
- building Gordon's own market primitives in TypeScript using Rezi

---

## 6. Runtime Choice Summary

Current runtime ranking for Gordon:

1. `Rezi`
   - best product fit while staying TypeScript-native
2. `Ink`
   - safest legacy option, but too weak for the cockpit we want
3. `OpenTUI`
   - promising infrastructure, but not the best immediate choice for Gordon's v2 rewrite
4. `Glyph`
   - too close to the same React-renderer family we are trying to escape

---

## 7. Immediate Next Steps

The next implementation tranche should be:

1. remove the Charm-client scaffold from the active plan
2. define the Rezi app shell and state model
3. build the Rezi shell primitives:
   - `InterlockStrip`
   - `TranscriptPane`
   - `InspectorPane`
   - `LiveRail`
   - `CommandBar`
4. build Gordon-native ticker-style Rezi components
5. wire them into real Gordon runtime state
