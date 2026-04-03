# Gordon Design Traceability Matrix

This document answers the strict question:

Does the current planning work actually cover what was requested in the original Gordon redesign brief?

The answer is not binary.
Some areas are covered well, some are only partially covered, and a few still need deeper specification or deeper research.

This document exists to prevent overclaiming.

It should be read together with:

- [docs/gordon-tui-master-plan.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-tui-master-plan.md)
- [docs/gordon-feature-census.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-feature-census.md)

---

## 1. Status Legend

- `Covered`
  - addressed directly and concretely in current docs
- `Partial`
  - direction exists, but not yet exhaustive enough to claim full coverage
- `Not covered`
  - still missing or only implied

---

## 2. Executive Answer

### Is the original design brief covered?

- Product architecture: `Covered`
- Repository grounding: `Covered`
- Trading-first workspace model: `Covered`
- Tone / vibe direction: `Covered`
- Full feature-to-surface mapping: `Covered`
- Full line-by-line requirement traceability: `Covered` by this document
- Exhaustive recursive review of every child repo in the large TUI lists: `Partial`
- Exhaustive every-file, every-component, every-state implementation-detail UI spec: `Partial`

### Honest bottom line

The planning work now covers the **core substance** of the original brief.

What it still does **not** honestly cover in a fully exhaustive sense:

- every single downstream repo linked inside the two large TUI lists
- every possible micro-state and interaction branch at implementation-detail granularity
- a literal one-line-per-file census of the entire Gordon repository

So:

- the planning is now strong enough to guide the reset
- it is still not honest to say "every possible reference and every possible file has been exhaustively mined"

---

## 3. Original Brief Traceability

### 3.1 "What you must do first"

| Original requirement | Status | Coverage location | Notes / remaining gap |
| --- | --- | --- | --- |
| Inspect repository structure in detail | Covered | [gordon-tui-master-plan.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-tui-master-plan.md) sections 2-3, [gordon-feature-census.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-feature-census.md) sections 1, 3, 6, 7 | Major layers and capability families are mapped |
| Read files relevant to CLI / Ink / rendering / commands / orchestration / memory / exchange / broker / strategy / backtest / approvals / risk / telemetry | Covered | same as above | Covered at major-surface level, not every file line-by-line |
| Build mental model of what Gordon can already do | Covered | master plan sections 2-3, census sections 3-7 | This is the main role of the current docs |
| Identify latent product surfaces underexposed by UI | Covered | master plan sections 4, 7-9; census sections 8-9 | Explicitly called out |
| Identify where UX is too chat-like / raw / dev-centric / flat / unstructured | Covered | master plan section 4; desk spec section 2 | Clearly diagnosed |

### 3.2 High-level mission

| Original requirement | Status | Coverage location | Notes / remaining gap |
| --- | --- | --- | --- |
| Translate coding-agent UX patterns into trading-native equivalents | Covered | master plan sections 5, 8-10; feature census sections 2-4, 10 | This is one of the central design moves |
| Respect that trading is not coding | Covered | master plan sections 5, 8; desk spec sections 1-3 | Repeated throughout the docs |
| Support stateful, time-sensitive financial workflows | Covered | master plan sections 1, 6-9, 12; feature census matrix | Explicitly reflected in workspaces and persistence model |
| Inspire financial trust | Covered | master plan sections 1, 5, 8-9; desk spec sections 1-5 | Risk/review/approval posture is central |
| Support plans, subtasks, long-running flows, visibility, summaries, recoverability | Covered | master plan sections 7-9, 12-13; census sections 3-5 | Runtime, approvals, workflows, and restore are included |
| Vibe trading but rigorous | Covered | master plan sections 5, 8, 9; desk spec sections 1, 3, 12 | Strongly reflected |

### 3.3 Design principles

| Original principle | Status | Coverage location | Notes / remaining gap |
| --- | --- | --- | --- |
| Information hierarchy first | Covered | desk spec sections 3, 5-7; master plan sections 6, 8-10 | Strong coverage |
| Terminal-native, not web dashboard in terminal | Covered | master plan sections 5, 10, 12; census sections 2, 10 | One of the most explicit decisions |
| Persistent context, ephemeral noise reduction | Covered | master plan sections 6-9, 12; AppStore-based planning in census | Strong coverage |
| Great under pressure | Covered | master plan sections 1, 5, 8, 12; desk spec sections 3, 5 | Covered conceptually, but not every micro-state yet |
| Signature identity without parody | Covered | desk spec sections 1, 4, 12; master plan section 5 | Covered strongly |
| Explain the machine | Covered | master plan sections 7-9; census matrix runtime / audit rows | Runtime, audit, workflow, and approval surfaces support this |
| Build for repeated use | Covered | master plan sections 1, 5, 8, 13; census sections 3-5 | Strong coverage |

### 3.4 Specific areas to investigate and redesign

| Area from original brief | Status | Coverage location | Notes / remaining gap |
| --- | --- | --- | --- |
| Overall terminal layout model | Covered | master plan sections 6, 8, 10, 13 | Workspace shell fully specified |
| Interaction model | Covered | master plan sections 8, 11; desk spec sections 10-11 | Still not every overlay and every key conflict spelled out |
| Message architecture | Partial | desk spec section 7; master plan Desk coverage | Good direction, but not yet full final message taxonomy/state chart |
| Market context visualization | Covered | master plan Market section; census matrix | Table + dossier model defined |
| Trade plan presentation | Covered | master plan Plan section; census matrix | TicketSheet + approval drawer + risk ladder defined |
| Tool / agent activity visibility | Covered | master plan sections 7-9, 12; census runtime/workflow/audit rows | Strong coverage |
| Mode and safety system | Covered | master plan sections 1, 6-9; desk spec sections 5, 11 | Strong coverage |
| Portfolio / account / position surfaces | Covered | master plan Monitor section; census matrix | Strong coverage |
| Strategy lab UX | Covered | master plan Lab section; census matrix | Strong coverage |
| Long-running workflow memory | Covered | master plan sections 6-9; census runtime/session/workflow rows | Covered conceptually and mapped to persistence |

### 3.5 Required deliverables phases

| Original deliverable | Status | Coverage location | Notes / remaining gap |
| --- | --- | --- | --- |
| Phase 1 Repository intelligence report | Covered | [gordon-workspace-redesign.md](/C:/Users/tibit/Downloads/gordon-cli-0.8/gordon-cli-0.8/docs/gordon-workspace-redesign.md) sections 1-3; master plan sections 2-4 | Yes |
| Phase 2 UX strategy and product model | Covered | master plan sections 1, 5-9 | Yes |
| Phase 3 Interface spec | Covered | desk spec + master plan sections 8-12 | Covered at strong architectural level, not full screen-state granularity |
| Phase 4 Implementation plan | Covered | master plan sections 13-17; census section 11 | Yes |
| Phase 5 Begin implementation | Partial | done in code across current branch history, but current docs describe next reset tranche rather than full completed reset | Planning is ready; implementation reset still ahead |

### 3.6 Output format requirements

| Original requirement | Status | Coverage location | Notes / remaining gap |
| --- | --- | --- | --- |
| Codebase understanding | Covered | earlier redesign doc section 1, master plan section 2 | Yes |
| Workflow inventory | Covered | earlier redesign doc section 2, master plan section 3 | Yes |
| UX diagnosis | Covered | earlier redesign doc section 3, master plan section 4 | Yes |
| Design thesis | Covered | earlier redesign doc section 4, master plan section 5 | Yes |
| Proposed interface architecture | Covered | earlier redesign doc section 5, master plan sections 6-11 | Yes |
| Concrete terminal patterns | Covered | earlier redesign doc section 6, master plan section 8 | Yes |
| Implementation roadmap | Covered | earlier redesign doc section 7, master plan sections 13-17 | Yes |
| First coding step | Covered | earlier redesign doc section 8, master plan section 17 | Yes |

### 3.7 Non-negotiable constraints

| Constraint | Status | Coverage location | Notes / remaining gap |
| --- | --- | --- | --- |
| Ground everything in real codebase | Covered | master plan section 2; census sections 1, 3, 6, 7 | Yes |
| Do not invent capabilities | Covered | census matrix is capability-grounded | Yes |
| Prefer leverage over reinvention | Covered | master plan sections 13-14 | Existing runtime / commands / stores are reused |
| Preserve terminal speed and feel | Covered | master plan sections 6, 10-12 | Yes |
| Avoid generic chat interface | Covered | master plan thesis and workspace model | Yes |
| Design for serious traders and repeated use | Covered | master plan sections 1, 5, 8 | Yes |
| Keep risk and approval clarity central | Covered | master plan sections 1, 8-9 | Yes |
| Make interface premium and differentiated | Covered | desk spec sections 1, 4; master plan section 5 | Yes |
| Claude-adjacent fluency but unmistakably Gordon | Covered | master plan sections 5, 10; census reference mapping | Yes |
| Treat as product-defining redesign | Covered | all current docs | Yes |

### 3.8 Brand / taste calibration

| Taste / brand requirement | Status | Coverage location | Notes / remaining gap |
| --- | --- | --- | --- |
| AI-native financial command center | Covered | master plan sections 1, 5 | Yes |
| Serious terminal for market reasoning | Covered | master plan sections 5-8 | Yes |
| Premium, sharp, high-agency | Covered | desk spec sections 1, 4; master plan section 5 | Yes |
| Institutional but not old | Covered | desk spec sections 1, 4 | Yes |
| Ambitious but not theatrical | Covered | desk spec sections 1, 3, 4 | Yes |
| Wall Street energy without parody | Covered | desk spec sections 1, 4; master plan section 5 | Yes |
| Agentic economy infrastructure | Covered | master plan sections 1, 3, 9; census matrix for rails, wallet, autonomous, bridge | Yes |
| Avoid crypto casino aesthetics / meme trader vibes / noisy dashboards / generic chatbot layouts | Covered | desk spec sections 2-4, 16; master plan sections 4-5, 16 | Yes |

---

## 4. External Reference Traceability

This section answers the question about repos, frameworks, and websites.

### Direct references from the redesign pass

| Reference | Type | Status | How it informed the plan | Coverage level |
| --- | --- | --- | --- | --- |
| `ticker` | GitHub repo | Covered | table-first market and monitor model | strong |
| `CLI Trader` | website / product | Covered | command -> strategize -> approve -> execute loop, personal software thesis, one-interface-many-markets, non-technical onboarding, process-quality discipline | strong |
| `OpenTUI` | GitHub repo | Covered | rendering ambition, overlays, pane stability | medium |
| `Rezi` | GitHub repo | Covered | dynamic/stable TUI discipline | medium |
| `gum` | GitHub repo | Covered | setup/bootstrap prompt flows and lightweight operator confirmations | medium |
| `glow` | GitHub repo | Covered | markdown document rendering for runbooks, reports, and playbooks | medium |
| `lipgloss` | GitHub repo | Covered | layout discipline, spacing rhythm, border restraint, terminal typography hierarchy | medium |
| `bubbletea` / `bubbles` | GitHub repos | Covered | state-machine workspaces, table/list/help/viewport behavior, pane-local keymaps | strong |
| `ultraviolet` | GitHub repo | Covered | render ambition, cell-diffing expectations, atomic redraw quality | medium |
| `colorprofile` | GitHub repo | Covered | terminal capability and graceful color degradation discipline | medium |
| Hatchet "TUIs are easy now" | article | Covered | implementation loop, reference-driven iteration, tmux/capture visual validation | medium |
| `CLI-Anything` | GitHub repo | Covered | REPL + subcommand duality, agent-friendly CLI contracts, structured command parity outside the cockpit | medium |
| `clig.dev` / `cli-guidelines` | guideline site / repo | Covered | command behavior, help, output contracts, error semantics, machine-readable CLI rules | strong |
| Karpathy "Build for Agents" CLI thesis | post / article cluster | Covered | agent-native CLI / MCP / markdown product-access model | strong |
| `fintool` | GitHub repo | Covered | agent-friendly financial CLI ecosystem contract | medium |
| Evangelion screen-graphics studies | design reference cluster | Covered | interlock grammar, warning semantics, typographic authority | strong |
| `donut-math` | technical article | Covered | Gordon startup / transition motion philosophy | medium |
| `Glyph` | GitHub repo | Covered | focus scopes, modal trapping, full-screen list-heavy TUI benchmark | strong |
| `Pi / pi-tui` | GitHub repo | Covered | command-bar replacement, session-tree recoverability, differential rendering | strong |
| `k9s` | GitHub repo | Covered | operator pane discipline and local focus | medium |
| `lazygit` | GitHub repo | Covered | list/detail keyboard ergonomics | medium |
| `VisiData` | GitHub repo | Covered | data drill-down and table interaction model | medium |
| `hledger-ui` | project site / repo family | Covered | summary -> register -> detail hierarchy | medium |
| `posting` | GitHub repo | Covered | overlays and terminal-native interaction patterns | medium |
| `btop` | GitHub repo | Covered | compact monitoring strips | light-medium |

### Large reference lists

| Reference list | Status | What was done | What was not done |
| --- | --- | --- | --- |
| `https://github.com/stars/ReverseZoom2151/lists/tui` | Partial | used as discovery source for relevant patterns and projects | did not recursively inspect every child repo |
| `https://github.com/rothgar/awesome-tuis` | Partial | used as discovery source for relevant patterns and projects | did not recursively inspect every child repo |

### Honest conclusion on references

The important **pattern families** from the supplied references are now reflected in the planning work.

What is **not** true:

- that every linked repo from the giant lists was exhaustively reviewed
- that every listed framework or TUI library was individually incorporated

What **is** true after the latest planning pass:

- the final planning set now explicitly incorporates the Charmbracelet stack as reference material
- the Hatchet article is used as an implementation-discipline reference
- `CLI-Anything` is used as a command-contract reference

So the reference coverage is:

- conceptually strong
- directionally sufficient
- not recursively exhaustive

---

## 5. Gordon Codebase Coverage Traceability

This section answers whether the whole Gordon codebase is covered.

### Major codebase families

| Codebase family | Status | Coverage location | Notes |
| --- | --- | --- | --- |
| Shell / TUI components | Covered | master plan section 2; census sections 1-4 | Strong coverage |
| Runtime / session / approvals / history | Covered | master plan sections 2, 7-9; census sections 3-5 | Strong coverage |
| Trading / execution / risk | Covered | master plan sections 2-3, 8-9; census matrix | Strong coverage |
| Market analysis and scanning | Covered | master plan sections 2-3, 8; census matrix | Strong coverage |
| Strategy / backtest / lab / systematic | Covered | master plan sections 2-3, 8-9; census matrix | Strong coverage |
| Monitoring / portfolio / orders / runtime health | Covered | master plan sections 2-3, 8-9; census matrix | Strong coverage |
| Setup / exchange / broker / MCP / routing / keyring | Covered | feature census sections 3, 5 | Covered now |
| Export / session / thread management | Covered | feature census sections 3, 5, 6 | Covered now |
| Onchain / rails / Solana / Polkadot / Base / Chainlink / DEX surfaces | Covered | feature census matrix sections 3, 6, 7 | Covered by family |
| Every single file in repo one-by-one | Partial | not attempted as a literal file manifest | family-level coverage, not one-row-per-file |

### Honest conclusion on codebase coverage

The planning now covers the **full major capability surface** of Gordon.

What it does **not** yet do:

- enumerate every source file in the repo and map it individually
- prove that every minor helper, renderer, and utility has been independently assessed for TUI consequences

So the codebase coverage is:

- product-complete by major capability family
- not literally exhaustive by every file

---

## 6. Remaining Gaps In Planning

These are the areas still only partially specified.

### Missing or incomplete specification layers

- final column schemas for each table in each workspace
- exact overlay state machines
- final loading / empty / error states for every workspace
- full command palette information architecture
- exact approval micro-flows and escalation variants
- exact onboarding branch tree
- exact transcript message taxonomy state chart
- final measured-width behavior for narrow / medium / widescreen terminals

These are not architectural gaps.
They are implementation-spec gaps.

---

## 7. Final Answer To The Original Question

### Can we now say the planning covers your original doc?

- In product architecture terms: `Yes`
- In repo-grounded capability mapping terms: `Yes`
- In vibe / tone / design language terms: `Yes`
- In “all direct references meaningfully absorbed into the design direction” terms: `Mostly yes`
- In “all child repos from giant lists were exhaustively reviewed” terms: `No`
- In “every implementation-detail state and every file is fully specified” terms: `No`

### Therefore

The honest final answer is:

The planning is now **good enough and broad enough to guide the reset correctly**.

It is **not** honest to claim:

- exhaustive recursive inspiration coverage
- exhaustive one-file-per-row repository coverage
- final micro-spec completeness

If we want to close the remaining planning gap before implementation, the next planning doc would be:

- a `screen-state-spec.md`

That doc would define:

- every workspace state
- every empty/loading/error state
- every overlay state
- every column schema
- every hotkey and focus transition

But that is now optional pre-implementation detail work, not a missing product-direction layer.
