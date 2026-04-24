# Metrics Framework: Gordon / General Liquidity
*Skill: startup-metrics-framework | Generated: 2026-04-16*

---

## North Star Metric

**Operators with at least one approved plan per 30 days**

This captures the full workflow value: an operator who has scanned, planned, previewed, and approved — regardless of whether they executed on live capital — is deriving the core product value. It is a leading indicator of retention, expansion, and word-of-mouth. It is not trivially gameable (one click does not produce an approved plan).

Secondary qualification: an "active operator" is one who has run at least 3 approved plans in a 30-day period. This is the retention-predictive threshold.

---

## One Metric That Matters (OMTM) — Phase 1

**Friends-alpha (now — Q2 2026):**
Weekly approved plans per operator (target: ≥3/week per operator in the alpha cohort). This validates that the workflow is sticky and that the plan-first model is being used as designed — not just as a demo.

**Waitlist / pre-launch (Q3 2026):**
Free-to-Pro conversion rate within 30 days of signup (target: ≥12%). This validates that paper trading creates enough conviction to upgrade to live execution. If this fails, the free-to-paid on-ramp is broken.

**Post-launch (Q4 2026+):**
Net New MRR / month (target: $10K MRR by month 3 of public launch). Confirms the monetization flywheel is turning.

---

## Full Metrics Suite

### Activation Metrics

| Metric | Definition | Target (Phase 1) | Why It Matters |
|---|---|---|---|
| Time to First Plan | Minutes from signup to first approved plan | < 15 minutes | Validates onboarding flow; long times indicate friction |
| Activation Rate | % of signups who complete first approved plan within 7 days | ≥ 45% | Leading indicator of retention |
| Paper Trade Completion | % of free users who run at least 1 paper trade | ≥ 60% | Paper mode is the key on-ramp; non-completion = onboarding failure |
| Multi-venue Connection Rate | % of Pro users who connect ≥ 2 venues within 14 days | ≥ 40% | Multi-venue is a core differentiator; single-venue users are at churn risk |

### Engagement Metrics

| Metric | Definition | Target (Phase 1) | Why It Matters |
|---|---|---|---|
| Plans Per Operator / Week | Approved plans generated per active operator per week | ≥ 3 | Core engagement signal; below 1/week = at-risk |
| Research Depth | % of plans that include a backtesting run | ≥ 25% (Power tier) | Validates deeper product value beyond basic execution |
| Permission Mode Distribution | % of operators in each mode (paper/ask/auto/strict) | Tracks trust ladder progression | |
| Session Frequency | Operator sessions per week | ≥ 3 | Trading-related product should have near-daily engagement |
| Operator Streak | Consecutive weeks with ≥ 1 approved plan | Measure and report | Longest streaks = most retained operators |

### Retention Metrics

| Metric | Definition | Target | Benchmark |
|---|---|---|---|
| Day 7 Retention | % of operators active 7 days after signup | ≥ 40% | Strong for consumer finance tools |
| Day 30 Retention | % of operators active 30 days after signup | ≥ 25% | Acceptable; ≥35% = excellent |
| Month 3 Logo Retention | % of paying operators still paying at month 3 | ≥ 85% | SaaS healthy threshold |
| Month 6 Logo Retention | % of paying operators still paying at month 6 | ≥ 75% | Target; strong churn signal if below 70% |
| NDR (Net Dollar Retention) | (ARR start + expansion - contraction - churn) / ARR start | ≥ 105% at 12 months | Pro→Power upgrades drive expansion; target NDR > 100% |
| Churn Rate (Pro) | % of Pro operators who cancel per month | ≤ 4.5% | Annual ~45%; above 6%/mo = structural problem |
| Churn Rate (Power) | % of Power operators who cancel per month | ≤ 2.5% | Annual ~27%; Power tier should have higher switching costs |

### Revenue Metrics

| Metric | Definition | Target | Notes |
|---|---|---|---|
| MRR | Monthly Recurring Revenue | $10K by month 3 post-launch | ~200 Pro operators OR ~67 Power OR mix |
| ARR | MRR × 12 | $120K by end of Year 1 | Conservative scenario anchor |
| ARPU (blended) | Total MRR / paying operators | ~$65–85 target | Mix of Pro ($49) and Power ($149) |
| MoM MRR Growth | Month-over-month % growth | ≥ 15% months 1-6; ≥ 10% months 7-12 | Standard seed-stage SaaS growth |
| Free → Pro Conversion | % of free users who upgrade within 30 days | ≥ 10–15% | Cursor benchmark: ~10–15%; validate in alpha |
| Pro → Power Upgrade Rate | % of Pro operators who upgrade within 6 months | ≥ 20–25% | Key expansion metric; upgrade driven by validated strategies |

### Unit Economics

| Metric | Formula | Target | Notes |
|---|---|---|---|
| CAC (blended) | Total S&M spend / new paying operators | ≤ $75 (PLG-dominant) | Above $150 = paid acquisition problem |
| CAC (organic) | Attribution to community/PLG | ≤ $20 | Finance Twitter + HN + GitHub cost very little |
| CAC (paid) | Attribution to paid channels | ≤ $120 | When added in Phase 2 |
| LTV (Pro) | $49 × (1/0.045 churn) × 0.84 margin | ~$915 | Assumes 82% gross margin |
| LTV (Power) | $149 × (1/0.025 churn) × 0.85 margin | ~$5,066 | Power tier dramatically better economics |
| LTV:CAC (blended) | LTV / CAC | ≥ 8x target; ≥ 3x minimum | Strong PLG products achieve 10-15x |
| CAC Payback (Pro) | CAC / (ARPU × GM%) | ≤ 3 months | PLG with $49 ARPU + low CAC payback very fast |
| CAC Payback (Power) | CAC / (ARPU × GM%) | ≤ 1 month | Power tier economics are strong |
| Gross Margin | (Revenue - LLM API + infra costs) / Revenue | 82–87% | Primary COGS: LLM API ($2-12/user/mo), broker APIs, infrastructure |
| Burn Multiple | Net Burn / Net New ARR | ≤ 1.5 (Year 1); ≤ 1.0 (Year 2) | Efficient PLG should have low burn multiple |

### Growth & Viral Metrics

| Metric | Definition | Target | Notes |
|---|---|---|---|
| Referral Rate | % of new operators who came via referral from existing operator | ≥ 25% | Word-of-mouth is primary growth channel for friends-alpha stage |
| K-Factor | Invites per operator × invite conversion rate | ≥ 0.3 (Phase 1); ≥ 0.6 (Phase 2) | K > 1.0 = viral; target K = 0.6+ by end of Year 1 |
| GitHub Stars / Week | Trailing 4-week average | Measure and report | Proxy for developer community penetration |
| Waitlist Growth Rate | New waitlist signups / week | Measure and report | Pre-launch leading indicator of launch demand |
| Creator / Champion Posts | Finance Twitter posts mentioning Gordon per week | ≥ 5/week post-launch | Community signal; seed with alpha operators who have audiences |

### Trust & Safety Metrics (unique to Gordon)

| Metric | Definition | Target | Why It Matters |
|---|---|---|---|
| Permission Mode Progression | % of operators who move from paper → ask → auto over time | Track cohorts | Validates trust ladder is working; operators stuck in paper mode are not converting the full value |
| Plan Approval Rate | % of previewed plans that operators approve (vs. reject/modify) | 60–80% | Too high = operator is rubber-stamping (risky); too low = plan quality poor |
| Operator Override Rate | % of auto-mode executions that operators manually override | < 5% (Power/auto) | High override = operators don't trust agent; signals in-context quality issue |
| Unexpected Execution Incidents | Orders that executed outside operator intent | 0 | Any incident here is a critical failure; must be zero |
| Audit Log Usage | % of operators who review audit log ≥ 1x/month | ≥ 50% | Engaged operators who review their history are retained longer |

---

## Metrics by Product Stage

### Friends-Alpha Stage (now — Q2 2026)
**Focus:** Workflow validation and NPS
- Approved plans per operator per week (target ≥ 3/week)
- Time to first approved plan (target < 15 minutes)
- Qualitative feedback frequency and sentiment
- Permission mode progression (are operators moving toward live execution?)
- Paper trade completion rate

**What to ignore:**
- CAC (no paid acquisition yet)
- NDR (no meaningful cohort to measure)
- Burn multiple (pre-revenue stage)

### Waitlist / Pre-Launch Stage (Q3 2026)
**Focus:** Conversion and activation
- Free → Pro conversion rate within 30 days (target ≥ 12%)
- Waitlist signup rate + referral source attribution
- Day 7 + Day 30 retention for early paid cohort
- Paper mode → live mode conversion (trust ladder validation)

### Post-Launch Stage (Q4 2026+)
**Focus:** Growth efficiency and unit economics
- MRR and MoM growth rate
- CAC by channel
- LTV:CAC ratio
- Churn rate by tier
- Pro → Power upgrade rate
- North Star progression (plans per operator per month)

---

## Investor-Ready Dashboard Format

```
[Month X Post-Launch]

Active Operators:    XXX  (↑ XX% MoM)
MRR:                $XX,XXX  (↑ XX% MoM)
ARR:                $XXX,XXX  (↑ XXX% YoY)

Tier Mix:           Free: XX% | Pro: XX% | Power: XX%
ARPU (paying):      $XX/month

Free → Pro Conv.:   XX% within 30 days
Pro → Power Upgrade: XX% within 6 months

Day 30 Retention:   XX%
Monthly Churn:      Pro: X.X% | Power: X.X%
NDR:                XXX%

CAC (blended):      $XX
LTV (blended):      $XXX
LTV:CAC:            X.Xx
CAC Payback:        X months

Burn:               $XX,XXX/month
Runway:             XX months

Plans Approved/Month: X,XXX
Avg Plans/Op/Week:   X.X
```

---

## The 3 Metrics That Make or Break the Model

**1. Free → Pro Conversion (≥ 12% in 30 days)**
This is the single most important early metric. If paper trading doesn't create enough conviction to upgrade, the free tier is not working as an on-ramp. Fix: tighten the paper → live transition UX, add "your paper strategy is working — go live?" prompts.

**2. Monthly Churn Rate (≤ 4.5% Pro, ≤ 2.5% Power)**
At $49 ARPU, a 4.5% monthly churn gives ~22-month average lifetime. At 8% churn (a bad SaaS product), average lifetime drops to 12.5 months — the LTV:CAC economics collapse. Fix: engagement loops, streak tracking, permission mode progression nudges.

**3. Pro → Power Upgrade Rate (≥ 20% in 6 months)**
The Power tier ($149) is 3x the revenue and has dramatically better economics. If operators are satisfied at Pro and never upgrade, ARPU stagnates. Fix: backtesting and auto-mode features need to be visible enough that Pro users feel the pull toward Power after their first validated strategy.

---

## Validation Experiments (Alpha Cohort)

| Experiment | What It Tests | How to Run | Signal |
|---|---|---|---|
| Paper → Live Trigger | Does a winning paper strategy prompt live execution? | After paper strategy shows positive expectancy, prompt "go live?" | Conversion rate ≥ 25% validates trigger works |
| Plan Rejection Rate | Are operators actually reviewing previews? | Track approve vs. reject vs. modify rates per plan | > 15% rejection = plan quality issue; > 90% approve = rubber-stamping risk |
| Multi-venue Connection | Does connecting 2+ venues increase retention? | Segment cohort by 1-venue vs. 2+ venue operators | Higher retention in 2+ venue cohort validates multi-venue is sticky |
| Operator Streak | Does streak tracking increase weekly active usage? | A/B on streak display | Streak cohort ≥ 20% more plans/week validates the mechanic |

---

## Red Flags

- Churn rate above 7%/month on Pro tier within first 3 months — structural product-market fit issue, not fixable by marketing
- Free → Pro conversion below 5% — paper trading is not creating conviction; on-ramp needs fundamental rethink
- Plans per operator per week below 1 — operators are not using the core workflow; product is not sticky
- Plan approval rate consistently above 90% — operators are rubber-stamping, not reviewing; trust model is not working as designed

## Yellow Flags

- Low permission mode progression (operators stay in paper mode indefinitely) — paper mode may be too comfortable; needs live-mode trigger events
- Single-venue concentration (>70% of operators use only 1 venue) — multi-venue value is not being discovered; needs UX guidance
- No referral traffic — word-of-mouth is not working; community seeding strategy needs recalibration
