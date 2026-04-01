# Gordon Desk UI Specification

This document defines the target UI and UX for Gordon as a premium operator-grade trading terminal.

It is intentionally opinionated. The goal is not to make Gordon "prettier" in the abstract. The goal is to make Gordon feel coherent, high-signal, high-discipline, and unmistakably financial.

This spec should be read together with:

- [docs/tui-design-system.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/tui-design-system.md)
- [docs/v0.9-architecture-roadmap.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/v0.9-architecture-roadmap.md)

## 1. Product Thesis

Gordon is not a generic AI shell.

Gordon is a trading desk.

The interface should communicate:

- authority
- restraint
- risk-awareness
- market speed
- operator control

The reference mood is:

- private trading floor
- expensive terminal
- old-money aggression
- live risk under control

The design should feel closer to a discretionary macro desk than to a cyberpunk hacker console.

## 2. Core Diagnosis

The current Gordon UI has strong identity but weak coherence.

Current strengths:

- [WelcomeBanner.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/WelcomeBanner.tsx) has a strong brand voice
- [StatusBar.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/StatusBar.tsx) communicates real operator state
- [ChatView.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/ChatView.tsx) is readable and stable
- [QuickStartMenu.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/QuickStartMenu.tsx) already organizes workflows

Current failures:

- different surfaces feel like different products
- borders, spacing, and panel weights are inconsistent
- too many important states are rendered as plain text
- transcript message types are under-differentiated
- approvals and runtime controls read like diagnostics instead of control surfaces
- onboarding and quick-start do not feel like opening a desk
- motion exists as isolated effects rather than a unified system

The problem is not "not enough animation."

The problem is the lack of a single visual and interaction grammar.

## 3. Design Principles

### 3.1 Authority Over Decoration

Every surface should feel intentional and expensive. Avoid novelty styling that does not increase confidence or legibility.

### 3.2 Density With Hierarchy

Trading software can be dense. Density is acceptable only when information is clearly ranked.

### 3.3 Desk, Not Dashboard

Gordon should feel like a workstation with live flows, tickets, blotters, and operator actions, not a generic widget dashboard.

### 3.4 Motion As Signal

Animation should indicate:

- live flow
- active run
- pending decision
- new queue activity
- desk opening

Animation should not be added for ornament.

### 3.5 One Shell, Many Modes

Welcome, onboarding, chat, runtime, approvals, and setup must all feel like the same product.

### 3.6 Operator Clarity

The user must always understand:

- what Gordon is doing
- what Gordon is waiting for
- what is queued
- what is risky
- what requires action

## 4. Gordon Visual Thesis

### 4.1 Emotional Tone

The product should feel:

- black
- warm
- metallic
- disciplined
- predatory
- deliberate

Avoid:

- rainbow UI
- neon cyberpunk
- playful terminal toy aesthetics
- generic SaaS softness
- hacker-movie noise

### 4.2 Color Strategy

The current theme in [theme.ts](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/theme.ts) is too neutral and too generic for the brand.

The target palette should be redefined around semantic desk roles.

#### Base palette

- `inkBlack`: near-black background
- `paperWhite`: warm off-white text
- `smoke`: muted secondary copy
- `brass`: premium accent for rails, labels, separators
- `moneyGreen`: execution, profit, approval, live buy-side confidence
- `riskRed`: armed state, execution danger, liquidation, denial
- `amber`: watch state, pending queue, warnings
- `iceBlue`: system and infrastructure surfaces
- `violetSlate`: analysis, critic, research, higher-order thought

#### Proposed semantic token families

- `desk.base`
- `desk.elevated`
- `desk.border`
- `desk.rule`
- `copy.primary`
- `copy.secondary`
- `copy.muted`
- `brand.brass`
- `brand.green`
- `brand.red`
- `brand.amber`
- `brand.ice`
- `brand.violet`

#### Role mapping

- user messages: restrained neutral
- Gordon messages: premium primary surface
- tool output: compressed technical surface
- approval cards: amber or red-framed tickets
- execution cards: green or red depending on state
- runtime/operator surfaces: ice or brass
- critic/auditor surfaces: violet or cool brass

### 4.3 Typography and Case

Ink is text-first, so typography is mostly case, spacing, and visual rhythm.

Use:

- uppercase micro-labels for section headers
- sentence case for explanatory copy
- terse title casing only where it feels institutional
- aligned labels instead of decorative symbols when possible

Avoid:

- random capitalization styles across surfaces
- excessive symbols with no semantic role

## 5. Shell Architecture

Gordon should adopt a stable three-zone shell.

### 5.1 Zone A: Market Rail

Top of screen.

Owned primarily by:

- [StatusBar.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/StatusBar.tsx)

Responsibilities:

- live mode
- venue
- model
- thread
- queue
- live price tape
- runtime run state

Design rules:

- flat horizontal rail
- high information density
- tight spacing
- no heavy boxing around every item
- ticker is separate from core operator line

### 5.2 Zone B: Transcript Canvas

Center of screen.

Owned primarily by:

- [ChatScreen.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/screens/ChatScreen.tsx)
- [ChatView.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/ChatView.tsx)

Responsibilities:

- user requests
- Gordon reasoning
- tool output
- plans
- signals
- system responses
- handoffs

Design rules:

- most spacious zone
- not every item needs a border
- primary thinking content should breathe
- technical output should compress
- critical decisions should expand visually

### 5.3 Zone C: Operator Rail

Lower or side panel depending on terminal width.

Owned primarily by:

- [RuntimeInspector.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/components/RuntimeInspector.tsx)
- [TaskTree.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/components/TaskTree.tsx)
- queue and background task surfaces in [ChatScreen.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/screens/ChatScreen.tsx)

Responsibilities:

- approvals
- runtime state
- queue
- background runs
- plugin and MCP status
- bridge status

Design rules:

- cards and tickets, not dump text
- the user should feel invited to act
- the rail should read as "control desk"

## 6. Component System

The current codebase uses too many ad hoc boxes and borders.

Introduce a small Gordon Desk primitive library.

### 6.1 Primitive Set

#### `DeskRail`

Use for:

- status lines
- ticker separators
- footer hints

Behavior:

- flat
- compact
- horizontal
- rule-based separation

#### `DeskPanel`

Use for:

- setup surfaces
- menus
- onboarding steps
- runtime summaries

Behavior:

- standard bordered container
- stable padding rules
- label slot
- optional accent strip

#### `TicketCard`

Use for:

- approvals
- trade plans
- signal summaries
- execution lifecycle
- queued tasks

Behavior:

- visually dominant
- stronger border
- headline, metadata row, actions, detail row

#### `BlotterRow`

Use for:

- tasks
- positions
- orders
- bridge entries
- plugin lifecycle

Behavior:

- compressed row format
- dense columns
- status-led

#### `TranscriptBlock`

Use for:

- conversation blocks
- tool blocks
- auditor blocks
- system strips

Behavior:

- variant-driven appearance
- borderless or lightly bordered depending on type
- standard meta row

### 6.2 Border Policy

The current use of `round` borders is too broad and soft.

New rule:

- `single`: default data and panel surfaces
- `round`: onboarding and welcome only, sparingly
- `double`: never default; reserve for critical approval or live execution states only
- no border: transcript system strips, inline state notices, subtle metadata

### 6.3 Spacing Policy

Create consistent spacing tiers:

- `space-0`: inline
- `space-1`: tight operational spacing
- `space-2`: standard panel padding
- `space-3`: major section separation

Current surfaces overuse one-off `marginX`, `marginBottom`, and `paddingX` combinations. These should be normalized by primitive.

## 7. Transcript Design

The transcript is the product.

The current chat surface in [ChatView.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/ChatView.tsx) is too uniform. It treats almost everything as the same bubble.

### 7.1 Transcript Types

Introduce explicit variants:

- `user`
- `gordon`
- `tool`
- `system`
- `approval`
- `signal`
- `execution`
- `critic`
- `auditor`
- `handoff`

### 7.2 Visual Rules Per Type

#### `user`

- right-aligned
- neutral border or no border
- short, restrained

#### `gordon`

- left-aligned
- primary narrative surface
- premium spacing

#### `tool`

- compressed
- technical
- cooler color family
- easier to skim than prose

#### `system`

- low-contrast strip
- no heavy border
- terse

#### `approval`

- card, not message bubble
- clear action line
- pending state prominent

#### `signal`

- structured market card
- symbol, direction, levels, confidence, rationale

#### `execution`

- lifecycle card
- entry, stop, target, fills, status

#### `critic` and `auditor`

- distinct from Gordon
- cooler, more forensic tone
- explicit role label

### 7.3 Streaming

The current streaming line in [ChatView.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/ChatView.tsx) is serviceable but too similar to ordinary assistant output.

Streaming should look like:

- live desk action
- visible cursor pulse
- secondary status line
- current tool or sub-run context

Streaming should never look identical to completed output.

## 8. Motion System

### 8.1 Motion Goals

Use motion to reinforce:

- desk boot
- active run
- queue advance
- approval arrival
- task progress

### 8.2 Allowed Motion

- ticker tape movement
- startup reveal
- cursor pulse
- live task-tree progression
- gentle card entrance for approvals and signals

### 8.3 Motion Restrictions

Do not animate:

- every panel
- static help screens
- every transcript line
- dense data rows

### 8.4 Gordon-Specific Use

[GlitchReveal.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/components/effects/GlitchReveal.tsx) is currently stronger than the rest of the product around it.

New rule:

- keep it only for first-run or explicit desk-open moments
- do not use glitch language as a recurring UI motif

[GordonLoader.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/components/GordonLoader.tsx) should evolve from "AI is thinking" into "desk is working":

- reading tape
- sizing risk
- routing execution
- reconciling tool output

## 9. Onboarding and First-Run UX

The current [Onboarding.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/Onboarding.tsx) is sensible but too much like setup copy plus a select box.

The target experience is "open the desk."

### 9.1 New Sequence

1. Desk opens
2. Gordon identity
3. Operating mode selection
4. Connection posture
5. First workflow selection
6. Land in live desk state

### 9.2 First-Run States

#### `QuickStart`

Goal:

- first value in minutes

Should configure:

- provider
- read-only posture
- one recommended workflow

Should not front-load:

- every rail
- every broker
- every chain
- every plugin

#### `Advanced`

Goal:

- full infrastructure wiring

Should feel like a control-room provisioning flow, not just a long questionnaire.

#### `Demo`

Goal:

- immediate exploration

Should feel intentionally premium, not like a degraded fallback.

### 9.3 Welcome Behavior

[WelcomeBanner.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/WelcomeBanner.tsx) should become:

- an opening sequence
- not the main persistent identity surface

The ASCII banner is strong, but it currently dominates too much of the shell relative to the rest of the visual system.

## 10. Quick Actions and Slash UX

The slash model is good. The problem is presentation and discoverability.

### 10.1 Quick Actions

[QuickStartMenu.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/QuickStartMenu.tsx) should become a "desk action palette," not a utility picker.

It should show:

- workflow groups
- live readiness
- recommended next action
- direct route back to transcript

### 10.2 Slash Commands

Slash commands do not need a conceptual overhaul.

They do need:

- better grouping by desk domain
- stronger visual display in help and overlays
- plugin and integration commands surfaced as first-class desk actions

### 10.3 Approval Actions

Approvals should not rely on text-instructions-first UX.

The current runtime approval guidance in [RuntimeInspector.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/components/RuntimeInspector.tsx) is useful, but too textual.

The operator should see:

- pending approval card
- action verbs
- risk level
- scope
- short reason

before seeing command syntax.

## 11. Runtime and Operator UX

[RuntimeInspector.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/components/RuntimeInspector.tsx) is one of the biggest current UX gaps.

It is informative, but it reads like an internal diagnostics dump.

The target is an operator rail with three stacked sections:

### 11.1 Approvals

- pending tickets first
- decisive color treatment
- short action labels
- recent decisions collapsed beneath

### 11.2 Runtime

- active run
- queue
- background work
- bridge status

### 11.3 Tooling and Integrations

- plugins
- MCP
- hot reload
- last sync

Most recent lists should become `BlotterRow` items, not loose bullet text.

## 12. Language System

The UI copy should sound like Gordon, not generic AI software.

Prefer:

- Desk
- Tape
- Queue
- Ticket
- Blotter
- Signal
- Exposure
- Mandate
- Run
- Rail
- Runtime
- Risk

Avoid overusing:

- assistant
- agentic platform
- workflow orchestration
- generic AI help language

The product can still explain itself in plain language, but primary surfaces should feel domain-native.

## 13. Current File Targets

### 13.1 Immediate refactor targets

- [src/app/theme.ts](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/theme.ts)
- [src/app/componentTheme.ts](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/componentTheme.ts)
- [src/app/StatusBar.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/StatusBar.tsx)
- [src/app/ChatView.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/ChatView.tsx)
- [src/app/screens/ChatScreen.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/screens/ChatScreen.tsx)
- [src/app/components/RuntimeInspector.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/components/RuntimeInspector.tsx)
- [src/app/QuickStartMenu.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/QuickStartMenu.tsx)
- [src/app/Onboarding.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/Onboarding.tsx)
- [src/app/WelcomeBanner.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/WelcomeBanner.tsx)
- [src/app/components/PromptPrimitives.tsx](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/src/app/components/PromptPrimitives.tsx)

### 13.2 New primitives to add

- `src/app/components/desk/DeskRail.tsx`
- `src/app/components/desk/DeskPanel.tsx`
- `src/app/components/desk/TicketCard.tsx`
- `src/app/components/desk/BlotterRow.tsx`
- `src/app/components/desk/TranscriptBlock.tsx`

## 14. Implementation Phases

### Phase 1: Theme and Primitives

Deliverables:

- new semantic token system
- desk primitives
- border and spacing normalization

Success criteria:

- no new ad hoc panels
- all new surfaces use shared primitives

### Phase 2: Shell Redesign

Deliverables:

- new market rail
- revised transcript canvas
- operator rail layout

Success criteria:

- top, center, and operator zones feel like one product

### Phase 3: Transcript Typing

Deliverables:

- typed transcript variants
- approval and execution cards
- distinct critic and auditor surfaces

Success criteria:

- transcript is scannable by message type without reading all copy

### Phase 4: Onboarding and Action Palette

Deliverables:

- desk-opening onboarding
- premium quick action palette
- better first-run routing

Success criteria:

- first-time user reaches a useful desk state quickly

### Phase 5: Motion and Final Polish

Deliverables:

- tightened intro
- consistent run-state motion
- refined approval/task transitions

Success criteria:

- motion feels expensive and functional

## 15. Acceptance Criteria

The redesign is successful when:

- Gordon feels like one desk, not several disconnected utilities
- the transcript becomes the strongest and clearest surface
- approvals become first-class actions, not instructions
- onboarding feels like opening a trading workstation
- the status rail becomes dense but elegant
- runtime and plugin surfaces feel operational instead of internal
- animation reinforces flow without becoming gimmicky

## 16. Anti-Goals

Do not turn Gordon into:

- a cyberpunk novelty terminal
- a widget-heavy dashboard
- a generic AI chat app
- a rainbow command palette
- a fake Bloomberg clone

The target is not imitation.

The target is a distinct Gordon desk: cinematic in tone, disciplined in layout, and credible in operation.
