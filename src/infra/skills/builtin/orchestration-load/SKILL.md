---
name: orchestration-load
description: "Measure the operator's serial-review bottleneck — the orchestration tax. When user says /orchestration-load, 'am I overloaded?', 'how many things are waiting on me?', 'should I spawn more agents/goals?', 'is my review queue backed up?', or before kicking off more autonomous work — count what's pending the operator's review (cards + plan approvals), run the orchestration_load op, and give the GIL/Amdahl backpressure read. Pure composition — no new code."
arguments: []
tags: [review, attention, supervision, orchestration]
user-invocable: true
status: active
last-reviewed: 2026-05-29
---

Measure the **orchestration tax** — how loaded the operator's single serial-review thread is. The thesis from "The Orchestration Tax": running more agents doesn't mean there's more of you. Producing proposals is cheap; reviewing them acquires one lock held by one person. Amdahl's Law caps throughput at the serial fraction, and the serial fraction is *your judgement*. Spawning more producers just deepens the queue feeding the bottleneck — and an overloaded reviewer rubber-stamps, which in trading means bad fills, not just bad merges.

Pure-composition skill — reads existing state and runs the `orchestration_load` op.

## Step 1: Count what's pending the operator's review

The operator's "review queue" is everything currently demanding a serial judgement call:
- **Pending proactive cards** — unresolved suggestions (`status: pending`) in the suggestion store.
- **Pending plan approvals** — plans awaiting `approve_plan` / sitting in the approval queue.
- **Any other approval-gated work** — risk-acknowledgement prompts, require_confirmation items.

Sum these into `pendingReviewItems`. If you can also estimate items produced in the last hour (cards fired + plans proposed), pass it as `producedLastHour` to surface whether the producer is outpacing the consumer.

## Step 2: Estimate review capacity

`reviewCapacityPerHour` is how many items the operator can *genuinely* review per hour — form an opinion, not rubber-stamp. For most operators this is a low single digit. Default is 6/hour; if the operator has told you their pace (or `GORDON_REVIEW_CAPACITY_PER_HOUR` is set), use that. Be honest — overestimating capacity defeats the purpose.

## Step 3: Run the load read

```
compute_microstructure({
  operation: 'orchestration_load',
  params: {
    pendingReviewItems: <N>,
    reviewCapacityPerHour: <cap>,
    producedLastHour: <optional>
  }
})
```

Returns `backlogHours`, `tier` (slack / saturated / overloaded), `producerOutpacingConsumer`, and the backpressure recommendation.

## Step 4: Deliver the read + the architecture advice

Lead with the tier and backlog, then the article's fixes matched to it:

- **slack** — "Within review capacity (<backlogHours>h backlog). Room to take on more — but watch for the queue growing; the failure mode is invisible until it isn't."
- **saturated** — "Approaching the serial limit (<backlogHours>h backlog). Slow the producer to match your review rate. **Batch your reviews** — process several in one sitting rather than cold-reloading context per item; context switches are the tax. Sort the work: delegate isolated tasks to background agents, keep judgement-heavy ones serial."
- **overloaded** — "⚠️ Over capacity (<backlogHours>h backlog). You're past the point where adding agents helps — Amdahl's Law. **Stop spawning producers.** Pass only safety-critical items, defer the rest, and protect a serial block for your hardest single problem with the lock held the whole time. If `GORDON_ORCHESTRATION_BACKPRESSURE=1`, the radar is already deferring non-critical cards for you."

If `producerOutpacingConsumer` is true, name it: "Production is outrunning review — the queue is growing, not shrinking. This is the orchestration tax accruing as unread merges + a staling mental model."

## Step 5: Offer the backpressure flag

If the operator is repeatedly saturated/overloaded, mention the opt-in: setting `GORDON_ORCHESTRATION_BACKPRESSURE=1` makes the proactive radar automatically defer non-safety-critical cards when the queue is overloaded (capital-protective categories — risk_warning, stop_loss_tighten — always pass). It's the "producer slows to match the consumer" backpressure, applied to the card stream. Off by default since it changes radar behavior.

## Step 6: Audit

```
audit_event({
  action: 'OBSERVATION',
  summary: 'orchestration-load: <tier>, <backlogHours>h backlog, <N> pending',
  parameters: { pendingReviewItems, reviewCapacityPerHour, backlogHours, tier, producerOutpacingConsumer }
})
```

## Honest caveats

- **Capacity is a self-estimate.** Garbage in, garbage out — if the operator claims 20/hr review capacity to feel productive, the read is meaningless. The whole point (the article's "busy vs productive") is that feeling busy ≠ shipping good decisions.
- **This is about attention, not compute.** Spawning more agents/goals is cheap and feels productive; the constraint is the operator's serial judgement, which doesn't parallelize. The highest-leverage move when overloaded is often to *stop orchestrating* and think hard about one problem.
- **Backpressure is opt-in and never withholds safety.** The flag defers non-critical cards only; risk warnings and stop-loss tightens always reach the operator regardless of queue depth.
- Pairs with [[agent-health]] (the queues this load draws from) and the supervision-rust / risk-acknowledgement mechanisms (which fight the cognitive-surrender failure mode from the other direction — forcing engagement rather than reducing load).
