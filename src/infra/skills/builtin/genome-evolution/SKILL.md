---
name: genome-evolution
description: "Tell the evolution story of a playbook lineage. When user says /genome-evolution, 'how has my strategy evolved?', 'show the genome lineage', 'what mutations worked', 'which changes hurt', or wants the cross-generation narrative of a playbook's self-improvement — walk the lineage generation by generation, surface per-gen fitness deltas + the mutation rationale, name the best generation and the first→last evolution, and list the mutations the lineage has learned to avoid. Pure composition — no new code."
arguments: [playbook]
argument-hint: Playbook name (kebab-case, e.g. 'momentum-swing'). If omitted, ask which playbook.
tags: [review, evolution, genome, strategy, self-improvement]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Narrate the **evolution story** of a playbook's genome lineage — the cross-generation self-improvement record. This is the SIA `context.md` view ported to Gordon's genome system: not just the structural lineage tree, but *what changed, why, what it cost or gained, and what the lineage has learned to stop trying.*

Pure-composition skill. Everything below reads existing genome data via the genome tools — no new computation.

## Step 1: Pull the lineage

```
get_playbook_lineage({ playbook_name: <playbook> })
```

Returns:
- `genomes` — every variant: `generation`, `status`, `fitness_score`, `mutations_count`, `parent_genome_id`
- `lineage_tree` — the structural parent→child tree (readable)
- `rejected_mutations` — **the SIA "don't repeat failed approaches" set**: `(field_path, direction)` mutations that are net-regressive across forks, with `net_fitness_drop`, `observations`, and a reason

If there's no lineage yet, say so plainly — the playbook hasn't been forked/evolved.

## Step 2: Rank the variants

```
rank_playbook_variants({ playbook_name: <playbook> })
```

Identifies the current best genome by fitness. Note the best generation and its fitness.

## Step 3: Build the generation-by-generation narrative

Walk the lineage oldest → newest. For each parent→child step, report:
- **Generation N → N+1**: the mutations applied (`mutations_from_parent`, with each mutation's `reason` — the *why*) and the **fitness delta** (child − parent).
- Mark each step: **improvement** (fitness rose), **regression** (fitness fell), or **flat**.

Then summarize like SIA's evolution block:
- **Best generation**: gen K (fitness X) — the one `rank_playbook_variants` surfaced.
- **Evolution**: first-gen fitness → latest-gen fitness (net gain/loss).
- **Code/structure drift**: how many mutations accumulated from root to current.

Be honest about non-monotonic paths: evolution is rarely a straight line up. A lineage that climbed, regressed, then recovered is normal — surface the shape, don't flatten it.

## Step 4: Surface what the lineage learned to avoid

This is the most actionable part — the `rejected_mutations` from Step 1. Present them as the lineage's accumulated wisdom:

> "This lineage has learned to avoid: raising `entry.confluence_required` (net −12 fitness across 3 forks), widening `exit.stop_loss.value` (net −4 across 2 forks)."

These are the mutations the evolution loop now **automatically suppresses** when forking new variants (when `GORDON_GENOME_REJECTION` is on, which is the default). Explain that the agent's own `suggest_mutations` and the autonomous evolution daemon both consult this set, so the lineage won't thrash on the same losing change — the genome-level version of not repeating a failed approach.

If `rejected_mutations` is empty, say the lineage hasn't accumulated enough fitness-scored forks to learn avoidances yet (needs parent→child pairs with a material fitness drop).

## Step 5: Recommend the next move

Based on the trajectory, suggest one of:
- **Promote** — if a variant clearly dominates and has enough trades, point at `promote_winner`.
- **Keep evolving** — if the frontier is still improving, note which mutation *directions* remain unexplored (not in the rejected set).
- **Stop mutating this lineage** — if recent generations only regress and the rejected set is large, the lineage may be at a local optimum; suggest forking from an earlier high-fitness ancestor or a different playbook instead.

## Step 6: Audit

```
audit_event({
  action: 'OBSERVATION',
  summary: 'genome-evolution: <playbook> best gen <K> (fitness <X>), <N> rejected mutations',
  parameters: { playbook, best_generation, best_fitness, first_fitness, latest_fitness, rejected_count }
})
```

## Honest caveats

- **Fitness is the composite score, not realized PnL.** A high-fitness genome still has to clear the live risk gate and credibility tests before it trades real size. This skill narrates evolution, it doesn't authorize deployment.
- **Rejected mutations are net, not absolute.** A direction is only suppressed when it has hurt more than it helped across the lineage — one unlucky fork won't permanently block it. Tune the threshold with `GORDON_GENOME_REJECTION_MIN_DROP` if the loop is over- or under-suppressing.
- **Don't over-read short lineages.** Two or three genomes is anecdote, not trend. The evolution narrative gets meaningful once a lineage has several fitness-scored generations.
- Composes with the genome tools (`get_playbook_lineage`, `rank_playbook_variants`, `promote_winner`, `suggest_mutations`) and pairs with [[auto-optimize]] (which drives the parameter search this lineage records) and [[agent-health]] (infra-side maintenance). The failed-mutation memory mirrors ACE's rejected-lesson buffer one layer down.
