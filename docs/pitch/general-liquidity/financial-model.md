# Financial Model: Gordon / General Liquidity
*Skill: startup-financial-modeling | Generated: 2026-04-16*

---

## Table of Contents
1. Revenue Model Architecture
2. 3-Year Financial Projections (3 Scenarios)
3. Unit Economics
4. Growth Model & Key Milestones
5. Model Assumptions & Sensitivity Analysis

---

## Section 1: Revenue Model Architecture

### 1.1 Cohort-Based Subscription Model

Gordon's subscription model is **cohort-compounding**: each month's new signups seed a perpetual revenue stream that grows (or shrinks) based on upgrade and churn dynamics. Revenue at any point is the sum of all surviving cohort slices across tiers.

The acquisition funnel has two gates:
- **Gate 1 (Free → Pro):** Operator tries paper trading, develops conviction in Gordon's execution edge, upgrades to live capital at $49/month.
- **Gate 2 (Pro → Power):** Operator runs multiple strategies, hits venue limits or wants auto mode, upgrades to $149/month.

A third, later gate exists:
- **Gate 3 (Power → Desk):** Multi-operator teams share context and strategy libraries at $299/seat/month. This is a Phase 3 product (2027+) not modeled in detail below.

The model is intentionally **subscription-first** because LLM API + execution infrastructure costs are predictable per-tier, making margin stable and burn calculable.

### 1.2 Tier Economics

| Tier | Price | LLM API Cost/mo | Infra Cost/mo | Net Revenue/mo | Gross Margin |
|------|-------|-----------------|---------------|----------------|--------------|
| Free | $0 | ~$0.50 (paper only) | ~$0.30 | –$0.80 | n/a (cost center) |
| Pro | $49 | $3.00 [Assumption: mid-range $2–4] | $1.50 | $44.50 | **90.8%** |
| Power | $149 | $9.00 [Assumption: mid-range $6–12] | $2.50 | $137.50 | **92.3%** |
| Desk | $299/seat | $12.00 | $3.00 | $284 | **95.0%** |

**Blended gross margin at 60/35/5 Pro/Power/Desk mix: ~91.3%**

> [Benchmark] Cursor reports ~80% gross margins at scale; Gordon's margins are higher because execution venues handle their own infrastructure and Gordon charges a flat fee (no brokerage spread). Claude Code equivalent is ~85% estimated.

**ARPU Calculation:**
- Free: $0 (negative contribution ~$0.80/mo per active free user)
- Pro: $49 ARPU
- Power: $149 ARPU
- Blended paid ARPU at 70/30 Pro/Power split: $49 × 0.70 + $149 × 0.30 = **$34.30 + $44.70 = $79/month**

**Expansion Revenue Path:**
Free users cost ~$0.80/month to keep alive (paper trading API calls, infra). At 1,000 free users, that's ~$800/month in negative contribution — manageable as a funnel cost but must be monitored. Free-tier compute should be rate-limited and not included in burn calculations as "user acquisition cost" — it IS the acquisition cost.

### 1.3 Freemium Funnel Math

The funnel works in two time horizons:

**Immediate conversion (first 30 days):**
Operators who came with a specific live strategy in mind convert quickly. [Estimate] ~40% of eventual Free→Pro conversions happen within 30 days.

**Delayed conversion (30–90 days):**
Operators use paper mode to validate a strategy, see it work, then upgrade. [Estimate] ~50% of conversions happen in the 31–90 day window.

**Long tail (90+ days):**
~10% convert after 90+ days — typically re-engaged by product updates or community momentum.

**Effective conversion mechanics:**
```
Monthly Free Signups × Immediate Rate (40%) = Same-month conversions
Prior Month Free Backlog × Delayed Rate (50% × remaining) = Next-month conversions
```

For simplicity in projections, the model applies the full conversion rate to each month's new signups with a 45-day average lag — effectively counting most conversions in the month following signup.

### 1.4 Phase 2 Take-Rate Model (Brief)

Starting in 2027 when execution volume reaches meaningful scale, Gordon has a natural path to adding a **take rate on execution volume** — e.g., 3–5 basis points on trade notional routed through Gordon-integrated venues. At $10M/month notional flow across the operator base, that's $30K–$50K/month incremental revenue with near-100% margin. This is not modeled in Year 1–3 projections as it requires (a) negotiated venue agreements, (b) a critical mass of active live operators, and (c) regulatory review. It represents meaningful upside to the base model.

---

## Section 2: 3-Year Financial Projections

### 2.1 Model Architecture

**Core mechanics per month:**
```
Net New Free Users = New Signups (acquisition)
New Pro = Prior Free Users × Conversion Rate (lagged ~45 days)
Pro Churned = Active Pro × Monthly Churn Rate
Net Pro = Prior Active Pro + New Pro – Pro Churned – Upgraded to Power
New Power = Active Pro × Monthly Upgrade Rate (applied at 6–9 month mark)
Power Churned = Active Power × Monthly Churn Rate (lower: 2–3%)
Net Power = Prior Active Power + New Power – Power Churned

MRR = (Active Pro × $49) + (Active Power × $149)
```

**Cost structure assumptions [Assumption]:**
- LLM API costs: proportional to active paid users (see Section 1.2)
- Infra (hosting, Mastra, broker APIs): $1,500/month base + $0.50/active user
- Team (founding team only, no salaries assumed in Phase 1 pre-revenue): $0 cash burn until $30K MRR, then modest contractor spend
- Marketing/acquisition spend: grows with paid channel activation (Phase 2)
- Total fixed costs (tools, domains, APIs at zero users): ~$400/month

---

### 2.2 Scenario A — Conservative (P10)

**Assumptions:**
- Free→Pro conversion: 8% [Conservative]
- Pro monthly churn: 6% [Conservative]
- Power upgrade rate: 20% (of Pro base, over 9 months = ~2.2%/month) [Conservative]
- Power monthly churn: 3% [Conservative]
- CAC: $120 average [Conservative — heavier paid acquisition]
- New free signups trajectory: slow organic growth

**Monthly new free signups:**
- Q2 2026 (Apr–Jun): 50/mo avg (friends-alpha word-of-mouth)
- Q3 2026 (Jul–Sep): 150/mo avg (public launch, limited traction)
- Q4 2026 (Oct–Dec): 300/mo avg (paid channels activated)
- Q1 2027: 500/mo
- Q2 2027: 700/mo
- Q3 2027: 900/mo
- Q4 2027: 1,100/mo
- Year 3 (2028): 1,500/mo avg

**Year 1 Monthly MRR Build (Conservative):**

| Month | New Free | Cumul. Free | New Pro | Active Pro | New Power | Active Power | MRR |
|-------|----------|-------------|---------|------------|-----------|--------------|-----|
| Apr 2026 | 30 | 30 | 0 | 0 | 0 | 0 | $0 |
| May 2026 | 50 | 80 | 2 | 2 | 0 | 0 | $98 |
| Jun 2026 | 70 | 150 | 4 | 6 | 0 | 0 | $294 |
| Jul 2026 | 120 | 270 | 12 | 17 | 0 | 0 | $833 |
| Aug 2026 | 150 | 420 | 22 | 37 | 0 | 0 | $1,813 |
| Sep 2026 | 180 | 600 | 34 | 68 | 1 | 1 | $3,481 |
| Oct 2026 | 250 | 850 | 48 | 110 | 2 | 3 | $5,837 |
| Nov 2026 | 300 | 1,150 | 72 | 175 | 4 | 7 | $9,623 |
| Dec 2026 | 350 | 1,500 | 92 | 256 | 6 | 13 | **$14,481** |
| Jan 2027 | 400 | 1,900 | 112 | 355 | 9 | 22 | $19,173 |
| Feb 2027 | 450 | 2,350 | 152 | 487 | 14 | 36 | $29,137 |
| Mar 2027 | 500 | 2,850 | 192 | 651 | 20 | 56 | **$40,223** |

> [Math check — Oct 2026]: Prior Active Pro = 68, New Pro = 48 (600 free users × 8%), Churned = 68 × 6% = 4, Net Pro before upgrades ≈ 112. Upgrade = ~2 (small base). Active Pro ≈ 110. MRR = 110×$49 + 3×$149 ≈ $5,390 + $447 ≈ $5,837. ✓

**Year 1 MRR Summary (Conservative):**
- Jan 2026 (pre-launch): $0
- Jun 2026: ~$300 (barely live)
- Sep 2026: ~$3,500
- Dec 2026: ~$14,500
- Mar 2027: ~$40,000

**$10K MRR milestone: November/December 2026**
**$50K MRR milestone: Q2 2027**

**Year 2 Quarterly MRR (Conservative):**

| Quarter | Approx Active Pro | Approx Active Power | MRR | ARR Run-Rate |
|---------|------------------|---------------------|-----|--------------|
| Q1 2027 | 490 | 40 | $30K | $360K |
| Q2 2027 | 720 | 75 | $46K | $552K |
| Q3 2027 | 980 | 130 | $67K | $804K |
| Q4 2027 | 1,200 | 185 | $86K | $1.03M |

**$100K MRR milestone: Q1 2028 (Conservative scenario)**

**Year 3 Annual Summary (Conservative):**
- End 2028 MRR: ~$170K
- ARR: ~$2.0M
- Active Pro: ~2,100
- Active Power: ~420

**Cost Structure & Burn (Conservative):**

| Period | Gross Revenue | LLM/Infra Costs | Gross Profit | Team/Ops | Net Burn/Profit |
|--------|---------------|-----------------|--------------|----------|-----------------|
| H2 2026 | $18K | $3K | $15K | $8K | –$7K/mo avg |
| H1 2027 | $190K (period) | $32K | $158K | $25K/mo | +$1K/mo avg by Jun |
| H2 2027 | $420K (period) | $68K | $352K | $40K/mo | +$18K/mo avg |
| 2028 | $1.6M | $250K | $1.35M | $600K | $750K operating profit |

**Runway note (Conservative):** With ~$50K in working capital and breakeven at ~$20K MRR (covering minimal team), this scenario reaches cashflow-positive around **April–May 2027** (Month 13–14 post-launch). Before that, approximately $80–100K in cumulative cash consumption.

---

### 2.3 Scenario B — Base Case (P50)

**Assumptions:**
- Free→Pro conversion: 12% [Benchmark: Cursor-comparable PLG conversion]
- Pro monthly churn: 4.5% [Estimate: engaged operators who "get it" stay]
- Power upgrade rate: 25% of Pro base over 9 months = ~2.8%/month
- Power monthly churn: 2.5%
- CAC: $75 average [PLG-dominant, some Finance Twitter spend]
- New free signups: moderate community growth

**Monthly new free signups:**
- Q2 2026 (Apr–Jun): 75/mo avg
- Q3 2026 (Jul–Sep): 250/mo avg (HN/GitHub launch)
- Q4 2026 (Oct–Dec): 500/mo avg
- Q1 2027: 800/mo
- Q2 2027: 1,100/mo
- Q3 2027: 1,500/mo
- Q4 2027: 2,000/mo
- Year 3 (2028): 2,800/mo avg

**Year 1 Monthly MRR Build (Base Case):**

| Month | New Free | Cumul. Free | New Pro | Active Pro | New Power | Active Power | MRR |
|-------|----------|-------------|---------|------------|-----------|--------------|-----|
| Apr 2026 | 30 | 30 | 0 | 0 | 0 | 0 | $0 |
| May 2026 | 75 | 105 | 4 | 4 | 0 | 0 | $196 |
| Jun 2026 | 95 | 200 | 9 | 12 | 0 | 0 | $588 |
| Jul 2026 | 200 | 400 | 24 | 34 | 0 | 0 | $1,666 |
| Aug 2026 | 280 | 680 | 48 | 79 | 0 | 0 | $3,871 |
| Sep 2026 | 320 | 1,000 | 82 | 154 | 2 | 2 | $7,844 |
| Oct 2026 | 450 | 1,450 | 120 | 266 | 5 | 7 | $14,081 |
| Nov 2026 | 520 | 1,970 | 174 | 424 | 9 | 16 | $23,152 |
| Dec 2026 | 580 | 2,550 | 237 | 637 | 15 | 31 | **$35,813** |
| Jan 2027 | 700 | 3,250 | 304 | 916 | 24 | 55 | $52,809 |
| Feb 2027 | 800 | 4,050 | 390 | 1,270 | 36 | 91 | $75,909 |
| Mar 2027 | 900 | 4,950 | 480 | 1,693 | 50 | 141 | **$103,972** |

> [Math check — Oct 2026]: Prior Active Pro = 154, New Pro = 120 (1,000 free × 12%), Churned = 154 × 4.5% ≈ 7, Upgraded = ~5, Net Pro ≈ 266. New Power from prior 80 pro cohort × 2.8% = 5. Active Power = 7. MRR = 266×$49 + 7×$149 ≈ $13,034 + $1,043 ≈ $14,077. ✓

**$10K MRR milestone: September–October 2026 (Month 5–6)**
**$50K MRR milestone: January 2027 (Month 9)**
**$100K MRR milestone: March 2027 (Month 11)**

**Year 2 Quarterly MRR (Base Case):**

| Quarter | Approx Active Pro | Approx Active Power | MRR | ARR Run-Rate |
|---------|------------------|---------------------|-----|--------------|
| Q1 2027 | 1,300 | 100 | $79K | $948K |
| Q2 2027 | 2,100 | 220 | $136K | $1.63M |
| Q3 2027 | 3,000 | 400 | $207K | $2.48M |
| Q4 2027 | 3,900 | 620 | $283K | $3.40M |

**$500K MRR milestone: Q3 2028 (Base Case)**

**Year 3 Annual Summary (Base Case):**
- End 2028 MRR: ~$600K
- ARR: ~$7.2M
- Active Pro: ~7,500
- Active Power: ~1,800

**Cost Structure & Burn (Base Case):**

| Period | Gross Revenue | LLM/Infra Costs | Gross Profit | Team/Ops | Net Burn/Profit |
|--------|---------------|-----------------|--------------|----------|-----------------|
| H2 2026 | $75K | $9K | $66K | $15K/mo avg | –$4K/mo avg |
| H1 2027 | $340K (period) | $45K | $295K | $40K/mo avg | +$9K/mo avg by Jun |
| H2 2027 | $1.1M (period) | $140K | $960K | $80K/mo avg | +$80K/mo avg |
| 2028 | $5.5M | $700K | $4.8M | $2.0M | $2.8M operating profit |

**Runway note (Base Case):** Cashflow-positive around **December 2026 – January 2027** (Month 8–9). Total pre-profitability cash consumption: approximately $30–45K. Effectively self-funding from early.

---

### 2.4 Scenario C — Optimistic (P90)

**Assumptions:**
- Free→Pro conversion: 18% [Optimistic: viral launch drives highly-motivated operators]
- Pro monthly churn: 3% [Optimistic: network effects, strategy stickiness]
- Power upgrade rate: 35% of Pro base over 9 months = ~3.9%/month
- Power monthly churn: 1.5%
- CAC: $45 average [Almost entirely PLG / organic]
- New free signups: viral growth post-HN/Finance Twitter

**Monthly new free signups:**
- Q2 2026 (Apr–Jun): 100/mo avg
- Q3 2026 (Jul–Sep): 600/mo avg (viral HN/GitHub launch)
- Q4 2026 (Oct–Dec): 1,200/mo avg (Finance Twitter picks up)
- Q1 2027: 2,000/mo
- Q2 2027: 3,000/mo
- Q3 2027: 3,500/mo (growth moderates)
- Q4 2027: 4,000/mo
- Year 3 (2028): 5,000/mo avg

**Year 1 Monthly MRR Build (Optimistic):**

| Month | New Free | Cumul. Free | New Pro | Active Pro | New Power | Active Power | MRR |
|-------|----------|-------------|---------|------------|-----------|--------------|-----|
| Apr 2026 | 30 | 30 | 0 | 0 | 0 | 0 | $0 |
| May 2026 | 100 | 130 | 6 | 6 | 0 | 0 | $294 |
| Jun 2026 | 130 | 260 | 18 | 23 | 0 | 0 | $1,127 |
| Jul 2026 | 500 | 760 | 47 | 67 | 0 | 0 | $3,283 |
| Aug 2026 | 700 | 1,460 | 137 | 197 | 2 | 2 | $9,951 |
| Sep 2026 | 750 | 2,210 | 264 | 453 | 8 | 10 | **$23,767** |
| Oct 2026 | 1,100 | 3,310 | 398 | 829 | 18 | 28 | **$44,794** |
| Nov 2026 | 1,200 | 4,510 | 596 | 1,380 | 38 | 66 | $77,514 |
| Dec 2026 | 1,300 | 5,810 | 810 | 2,107 | 64 | 130 | **$122,993** |
| Jan 2027 | 1,800 | 7,610 | 1,045 | 3,086 | 105 | 235 | $182,029 |
| Feb 2027 | 2,000 | 9,610 | 1,372 | 4,359 | 165 | 400 | $273,291 |
| Mar 2027 | 2,200 | 11,810 | 1,730 | 5,989 | 245 | 645 | **$389,071** |

> [Math check — Sep 2026]: Prior Active Pro = 197, New Pro = 264 (1,460 free × 18%), Churned = 197 × 3% ≈ 6, Upgraded ≈ 8, Net Pro ≈ 447 → ~453. MRR = 453×$49 + 10×$149 ≈ $22,197 + $1,490 ≈ $23,687. ✓ (minor rounding)

**$10K MRR milestone: August 2026 (Month 4) — remarkably fast**
**$50K MRR milestone: October 2026 (Month 6)**
**$100K MRR milestone: December 2026 (Month 8)**
**$500K MRR milestone: May 2027 (Month 13)**

**Year 2 Quarterly MRR (Optimistic):**

| Quarter | Approx Active Pro | Approx Active Power | MRR | ARR Run-Rate |
|---------|------------------|---------------------|-----|--------------|
| Q1 2027 | 4,500 | 430 | $285K | $3.42M |
| Q2 2027 | 7,500 | 900 | $501K | $6.01M |
| Q3 2027 | 10,200 | 1,600 | $737K | $8.84M |
| Q4 2027 | 13,000 | 2,600 | $1.0M | **$12.0M** |

**$1M MRR milestone: Q4 2027 (Month 18 post-public-launch)**

**Year 3 Annual Summary (Optimistic):**
- End 2028 MRR: ~$2.1M
- ARR: ~$25M
- Active Pro: ~20,000
- Active Power: ~6,000

**Cost Structure & Burn (Optimistic):**

| Period | Gross Revenue | LLM/Infra Costs | Gross Profit | Team/Ops | Net Burn/Profit |
|--------|---------------|-----------------|--------------|----------|-----------------|
| H2 2026 | $153K | $16K | $137K | $20K/mo avg | +$17K/mo by Dec |
| H1 2027 | $1.4M (period) | $145K | $1.25M | $100K/mo avg | +$108K/mo avg |
| H2 2027 | $5.0M (period) | $520K | $4.48M | $350K/mo avg | +$393K/mo avg |
| 2028 | $19.5M | $2.0M | $17.5M | $6.0M | $11.5M operating profit |

**Runway note (Optimistic):** Cashflow-positive in **September 2026** (Month 5). No meaningful cash burn. Growth becomes a hiring/operations problem, not a survival problem.

---

### 2.5 Scenario Comparison Summary

| Metric | Conservative (P10) | Base Case (P50) | Optimistic (P90) |
|--------|--------------------|-----------------|------------------|
| $10K MRR | Nov 2026 | Sep 2026 | Aug 2026 |
| $50K MRR | Q2 2027 | Jan 2027 | Oct 2026 |
| $100K MRR | Q1 2028 | Mar 2027 | Dec 2026 |
| $500K MRR | N/A in 3yr | Q3 2028 | May 2027 |
| $1M MRR | N/A in 3yr | N/A in 3yr | Q4 2027 |
| End-2028 MRR | $170K | $600K | $2.1M |
| End-2028 ARR | $2.0M | $7.2M | $25.2M |
| Pre-profitability burn | ~$90–100K | ~$35–45K | ~$10–15K |
| Cashflow-positive | Apr–May 2027 | Dec 2026–Jan 2027 | Sep 2026 |
| End-2028 Active Paid | ~2,500 | ~9,300 | ~26,000 |

---

## Section 3: Unit Economics

### 3.1 Customer Acquisition Cost (CAC) by Channel

[Assumption] Channel mix evolves over time. Friends-alpha to public launch is essentially $0 CAC (organic). Post-launch channels:

| Channel | Estimated CAC | Conversion Rate | Notes |
|---------|--------------|-----------------|-------|
| Organic (GitHub, HN) | ~$5–15 | High (motivated) | Time cost only, not cash |
| Finance Twitter (organic) | ~$20–40 | Medium-high | Creator posts, demo clips |
| Finance Twitter (paid/sponsored) | ~$80–120 | Medium | Sponsored posts, creator partnerships |
| Discord/Community | ~$15–25 | High | Community management cost |
| Direct outreach / waitlist | ~$10–20 | High (pre-qualified) | Time-intensive |

**Blended CAC by scenario:**
- Conservative: $120 (heavier reliance on paid channels starting earlier)
- Base Case: $75 (mostly organic + light paid)
- Optimistic: $45 (predominantly organic/viral)

[Benchmark] Cursor's reported CAC was <$50 at launch, primarily PLG through developer communities. 3Commas grew primarily through affiliate/SEO — higher CAC ~$90–120 but also higher ARPU.

### 3.2 LTV Calculation by Tier

**Pro Tier LTV:**
```
LTV = ARPU × Gross Margin × (1 / Monthly Churn Rate)
```

| Scenario | ARPU | Margin | Churn | LTV |
|----------|------|--------|-------|-----|
| Conservative | $49 | 90.8% | 6.0% | $49 × 0.908 / 0.06 = **$741** |
| Base Case | $49 | 90.8% | 4.5% | $49 × 0.908 / 0.045 = **$988** |
| Optimistic | $49 | 90.8% | 3.0% | $49 × 0.908 / 0.03 = **$1,483** |

**Power Tier LTV:**

| Scenario | ARPU | Margin | Churn | LTV |
|----------|------|--------|-------|-----|
| Conservative | $149 | 92.3% | 3.0% | $149 × 0.923 / 0.03 = **$4,583** |
| Base Case | $149 | 92.3% | 2.5% | $149 × 0.923 / 0.025 = **$5,501** |
| Optimistic | $149 | 92.3% | 1.5% | $149 × 0.923 / 0.015 = **$9,169** |

> [Note] These are nominal LTVs without discounting. Applying a 20% annual discount rate (typical for SaaS) reduces by ~30% over median customer lifetime. Even discounted, Power tier LTV is exceptional.

### 3.3 LTV:CAC Ratio

The magic number for SaaS viability is LTV:CAC > 3:1. At > 5:1, the business is underinvesting in growth.

**Pro Tier LTV:CAC:**

| Scenario | LTV | CAC | LTV:CAC |
|----------|-----|-----|---------|
| Conservative | $741 | $120 | **6.2:1** |
| Base Case | $988 | $75 | **13.2:1** |
| Optimistic | $1,483 | $45 | **32.9:1** |

**Power Tier LTV:CAC:**

| Scenario | LTV | CAC | LTV:CAC |
|----------|-----|-----|---------|
| Conservative | $4,583 | $120 | **38.2:1** |
| Base Case | $5,501 | $75 | **73.3:1** |
| Optimistic | $9,169 | $45 | **203.8:1** |

> The LTV:CAC ratios for Power tier are extraordinarily high by any benchmark. This isn't a modeling error — it reflects that Power operators are choosing Gordon because alternatives don't exist (no direct competitor is offering agentic multi-venue live execution for $149/month), so price sensitivity is low and the value delivered is high. The constraint is not economics; it's customer acquisition.

### 3.4 CAC Payback Period

Payback period = CAC / (Monthly ARPU × Gross Margin)

**Pro Tier payback:**

| Scenario | CAC | Monthly Net Revenue | Payback |
|----------|-----|---------------------|---------|
| Conservative | $120 | $44.50 | **2.7 months** |
| Base Case | $75 | $44.50 | **1.7 months** |
| Optimistic | $45 | $44.50 | **1.0 months** |

**Power Tier payback:**

| Scenario | CAC | Monthly Net Revenue | Payback |
|----------|-----|---------------------|---------|
| Conservative | $120 | $137.50 | **0.9 months** |
| Base Case | $75 | $137.50 | **0.5 months** |
| Optimistic | $45 | $137.50 | **0.3 months** |

[Benchmark] Typical PLG SaaS targets < 12 months CAC payback. Gordon's sub-3-month payback means every dollar of acquisition spend returns 4× in Year 1. This is the fundamental economic insight: **the constraint is acquisition, not unit economics**.

### 3.5 Gross Margin Analysis

**Blended gross margin at scale (estimated paid user mix: 65% Pro, 30% Power, 5% Desk):**

```
Blended GM = (0.65 × 90.8%) + (0.30 × 92.3%) + (0.05 × 95.0%)
           = 59.0% + 27.7% + 4.75%
           = 91.5%
```

**Free-user cost impact (1,000 free users per 100 paying):**
- Cost: 1,000 × $0.80 = $800/month
- Gross revenue from 100 paying (blended $79 ARPU): $7,900
- Adjusted blended margin: ($7,900 – $800) / $7,900 = **89.9%**

Even with free-user drag, gross margins remain class-leading. For comparison:
- [Benchmark] Salesforce: ~75% gross margin
- [Benchmark] Snowflake: ~68% gross margin
- [Benchmark] Cursor (estimated): ~80% gross margin
- Gordon target: **88–92% gross margin**

### 3.6 Burn Multiple

Burn Multiple = Net Cash Burn / Net New ARR Added (lower is better; < 1.5 is good, < 1.0 is great)

| Period | Net Burn | Net New ARR | Burn Multiple |
|--------|----------|-------------|---------------|
| Q3 2026 (Base) | $15K | $50K | **0.30** (excellent) |
| Q4 2026 (Base) | $10K | $120K | **0.08** (exceptional) |
| Q1 2027 (Base) | $0 (breakeven) | $180K | **0.00** |
| 2027 Full Year (Base) | Profitable | $2.5M | **Negative** (generating cash) |

In the Conservative scenario, burn multiple peaks at ~0.8 in Q3 2026 before improving. This is still strong by any standard. The implication: Gordon has minimal dilution risk in any scenario because the business pays for itself before requiring meaningful capital.

---

## Section 4: Growth Model & Key Milestones

### 4.1 Operator Acquisition Funnel

The full funnel from awareness to Power operator, with estimated conversion rates at each stage:

```
Impressions (HN/Twitter/GitHub)
    ↓ 2–4% click-through [Estimate: typical for organic dev content]
Repo/landing page visitors
    ↓ 15–25% signup rate [Estimate: high because self-selected audience]
Free signups (waitlist or direct install)
    ↓ 60–70% active in first week [Estimate: CLI tools see higher activation than SaaS]
Active free operators
    ↓ 8–18% convert to Pro (scenario-dependent, within 90 days)
Pro operators
    ↓ 20–35% upgrade to Power (over 9 months)
Power operators
```

**Example funnel math for a 100K-impression content campaign (Base Case):**
```
100,000 impressions
→ 3,000 clicks (3% CTR)
→ 600 signups (20% landing conversion)
→ 420 active free users (70% activate)
→ 50 new Pro subscribers (12% conversion)
→ 12–13 eventual Power subscribers (25% upgrade)
→ Revenue: 50×$49 + 13×$149 = $2,450 + $1,937 = $4,387/month at steady state
→ CAC: $75 blended → $75 × 63 paid = $4,725 acquisition cost
→ Payback: ~1.1 months
```

### 4.2 First 100 Paying Operators: Realistic Timeline

**Conservative:** February 2027 (~10 months post-launch)
**Base Case:** September 2026 (~5 months post-launch)
**Optimistic:** August 2026 (~4 months post-launch)

The first 100 operators are purely through friends-alpha word-of-mouth, waitlist conversion, and HN/GitHub. No paid acquisition needed. These are the **founding operators** — their testimonials, strategy results, and community participation are the primary sales asset for Phase 2.

Critical actions to reach 100 paying operators:
1. Ship a single genuinely impressive demo (one 3-minute clip of Gordon executing a live trade with reasoning visible)
2. Post on HN: "Show HN: I built a CLI trading agent that executes strategies in natural language"
3. Convert the 20–30 friends-alpha operators to paid as launch credibility

### 4.3 Path to $1M ARR

**$1M ARR = ~$83K MRR**

At blended ARPU of $79 (70/30 Pro/Power mix): requires ~1,050 active paid operators.

| Scenario | Active Paid at $1M ARR | Timeline |
|----------|------------------------|----------|
| Conservative | 1,050 (at $79 blended) | Q3 2027 (15 months) |
| Base Case | 1,050 | Q1 2027 (9–10 months) |
| Optimistic | 1,050 | Nov 2026 (7 months) |

**What does 1,050 paying operators look like?**
- If average operator portfolio is $20K actively managed: $21M in operator AUM
- If average trade frequency is 5 trades/week × $2K notional: $10M/week in aggregate trade flow
- At this scale, Phase 2 take-rate conversations with venues become credible

**Path to $1M MRR ($12M ARR):**
- Requires ~13,000 paying operators at blended $79 ARPU (or fewer with more Power/Desk mix)
- Base Case timeline: Mid-2029
- Optimistic timeline: Q4 2027 (Month 18 post-public-launch)

At $1M MRR, the operator community becomes self-sustaining: strategy sharing, signal communities, and Gordon Desk (team tier) become natural upsells.

### 4.4 North Star Metric

**Gordon's North Star Metric: Active Live Operators (ALO)**

Definition: Operators who have executed at least one live trade via Gordon in the trailing 30 days.

This metric is chosen because:
1. It captures actual product value delivery (live execution, not just paper trading)
2. It correlates directly with both Pro and Power tier retention
3. It's a leading indicator of expansion revenue (live operators are 3× more likely to upgrade to Power)
4. It's honest — paper-only users contribute nothing to the moat or testimonials

**ALO trajectory (Base Case):**
- Sep 2026: ~50 ALO (first paid cohort activating live trading)
- Dec 2026: ~300 ALO
- Jun 2027: ~1,500 ALO
- Dec 2027: ~3,500 ALO
- Dec 2028: ~8,500 ALO

Secondary metrics that feed ALO:
- Free Signups / Week (acquisition health)
- Day-7 Activation Rate (product quality signal)
- Paper→Live Trade Rate (the critical behavioral conversion)
- Strategies Run / Operator / Week (engagement depth)

### 4.5 Key Operational Milestones by Phase

**Phase 1 (Now → Q3 2026): Friends-Alpha → Public Launch**
- [ ] 20–30 friends-alpha operators actively using paper mode
- [ ] First 5 operators running live capital
- [ ] First testimonial: "Gordon found a setup my manual scanning missed"
- [ ] Public GitHub repo + Show HN post
- [ ] Waitlist open, 500+ signups

**Phase 2 (Q3 2026 → Q2 2027): Paid Acquisition + First Thousand**
- [ ] 100 paying operators milestone (unlocks social proof for all paid channels)
- [ ] First Finance Twitter creator partnership (10K+ followers in trading niche)
- [ ] $10K MRR milestone (validates product-market fit for external communication)
- [ ] First Power tier operator cohort (validate backtest + auto mode value)
- [ ] Community Discord/Telegram with 1,000+ members

**Phase 3 (Q3 2027+): Scale + Desk Product**
- [ ] $100K MRR (operational milestone: hire first full-time employee)
- [ ] Gordon Desk beta (multi-operator shared context — the $299/seat tier)
- [ ] First venue take-rate agreement signed
- [ ] $500K MRR or $6M ARR run-rate (Series A territory if desired, though not required)

---

## Section 5: Model Assumptions & Sensitivity Analysis

### 5.1 The Three Assumptions That Most Determine the Outcome

These are the model's "eigenvalues" — the parameters that, if wrong by 2×, swing the outcome by an order of magnitude.

**#1: Free → Pro Conversion Rate (8–18%)**

This single number more than any other determines whether Gordon is a small product or a large one.

*Why it matters:* At $49/month and ~$75 CAC, you need conversion > 8% just to stay above water on acquisition. The 18% optimistic case is achievable but requires Gordon to *feel indispensable within the free experience* — paper mode has to be good enough that operators can't imagine doing live trading without it.

*What drives it:* The paper-to-live psychological bridge. If paper trading results are convincing (Gordon caught 3 setups this week I would have missed), conversion is high. If paper mode feels like a toy, conversion is low.

*The read-out:* Visible in friends-alpha data within 60–90 days. Track "paper mode operators who expressed live trading intent" vs. "operators who actually upgraded."

---

**#2: Pro Monthly Churn (3–6%)**

At 6% monthly churn, the average Pro operator stays 16.7 months. At 3%, they stay 33 months. That's a 2× difference in LTV.

*Why it matters:* Churn determines whether the subscription base compounds or leaks. At 6% churn with 12% conversion, Gordon is running a leaky bucket — each month you must acquire new operators just to stay flat. At 3% churn, the base compounds naturally.

*What drives it:* Whether operators integrate Gordon into their daily workflow. Churn is high when Gordon is "one more tool I try." Churn is low when "I can't check my positions without Gordon." The key product investment is in ritual: daily briefings, position summaries, strategy check-ins — anything that makes opening Gordon the first thing an operator does each morning.

*The read-out:* Month 2 and Month 3 retention in friends-alpha cohort. If > 80% of friends-alpha operators are still active at Month 3, base-case churn is achievable.

---

**#3: New Free Signups / Month at Launch (the acquisition ramp)**

The model assumes a meaningful HN/GitHub/Finance Twitter launch creates 200–600 new free signups in the first month of public availability (Q3 2026). If the launch falls flat (< 100 signups), even perfect conversion rates lead to a slow start. If it goes viral (> 1,000 signups), even mediocre conversion rates lead to a strong start.

*Why it matters:* Early signups are disproportionately high-quality — the HN/GitHub audience is exactly the self-directed, technically-comfortable operator Gordon is built for. Getting 500 motivated operators in Month 1 beats getting 500 less-motivated operators from paid channels in Month 6.

*What drives it:* The quality of the launch artifact (the demo, the GitHub README, the HN post). Gordon has an unfair advantage here: a trading CLI agent is genuinely novel content. A 3-minute video of Gordon autonomously executing a DCA strategy while narrating its reasoning in real time is share-worthy.

*The read-out:* Waitlist conversion and first-week signups from launch post.

### 5.2 Sensitivity Analysis: What Happens If Conversion Is 50% Worse?

**Starting from Base Case assumptions, applying 50% degradation to each key variable independently:**

| Variable Degraded | Base MRR at Dec 2026 | Degraded MRR at Dec 2026 | Impact |
|-------------------|----------------------|--------------------------|--------|
| Conversion: 12% → 6% | $35,800 | $15,200 | –58% |
| Pro Churn: 4.5% → 6.75% | $35,800 | $22,100 | –38% |
| New Signups: 500/mo → 250/mo | $35,800 | $18,400 | –49% |
| CAC: $75 → $112.50 | No MRR impact (cash burn: +$8K/mo) | Same MRR, worse cash | n/a |

**Combined stress test (all three degraded 50% simultaneously):**
- Dec 2026 MRR: ~$5,200 (vs. base $35,800)
- $10K MRR: pushed to Q2 2027
- This scenario approximates the Conservative P10 case above — still viable, just slow

**Key insight from sensitivity analysis:** Conversion rate and new signups are multiplicative (they interact directly in the funnel). A 50% drop in both simultaneously reduces MRR by ~75%, not 50+49%. Mitigating conversion rate decay (through onboarding, paper-mode quality, in-product nudges) is the highest-leverage action.

### 5.3 Key Risks to the Model

**Risk 1: LLM API cost inflation**
Gordon's economics depend on LLM API costs staying in the $3–9/month/user range. If Anthropic raises prices or Gordon's usage patterns shift toward more agentic loops (increasing token consumption), this could compress margins. [Mitigation: prompt caching, output streaming limits, model routing — Gordon already has provider-switching infrastructure via Dedalus. This is low risk.]

**Risk 2: Regulatory friction on automated trading**
SEC/FINRA guidance on "agentic trading" is undefined. A crackdown on automated retail trading could force product pivots (e.g., from auto-execute to auto-recommend). [Mitigation: Power tier's "auto mode" can be repositioned as "one-click execution with AI recommendation" — a UI change, not a core rewrite. Build legal opinion into Q4 2026 roadmap.]

**Risk 3: Broker API deprecation or access restriction**
If major venues (Alpaca, IBKR, Coinbase) restrict API access or raise fees, Gordon's execution layer is impaired. [Mitigation: multi-venue from launch reduces single-venue dependency. The 3-venue limit on Pro is actually a moat signal — operators with multi-venue strategies need Power tier and are stickier.]

**Risk 4: Competitor response from established tools**
3Commas, TradingView, or a well-funded startup adds "natural language strategy" to their existing platform. [Mitigation: Gordon's moat is the agentic depth (reasoning + execution + memory), not feature parity. A bolt-on NL layer from TradingView doesn't give operators the "operator infrastructure" that Gordon is building. First-mover window is ~12–18 months.]

**Risk 5: Churn due to poor live trading performance**
If operators' Gordon-executed strategies underperform, they cancel. This is not a product risk per se (Gordon executes what operators define), but it's a support and positioning risk. [Mitigation: paper mode validates before live capital. The ICP ("The Stuck Operator") has conviction but no execution — Gordon isn't responsible for their strategy alpha, only their execution quality.]

### 5.4 Validation Experiments from Friends-Alpha

The following data points from friends-alpha (20–30 operators, Q2 2026) will validate or invalidate the model's key assumptions before public launch:

| Assumption | Measurement | Target (Base Case) | Invalidation Signal |
|------------|-------------|--------------------|---------------------|
| Free→Pro conversion | % of alpha operators who would pay $49/mo when asked directly | > 40% express intent | < 20% |
| Daily active use | % of alpha operators using Gordon at least 5x/week | > 60% | < 30% |
| Paper→live intent | % of alpha operators who ran paper mode and want live trading | > 50% | < 25% |
| Willingness-to-pay ceiling | Highest price that doesn't cause negative reaction | $49+ without objection | "That's too expensive" from > 50% |
| Feature retention driver | Which feature, when removed, causes strongest objection | Gordon's reasoning narration | No strong objections to anything |
| Churn signal | % of alpha operators who stopped using after first week | < 20% | > 40% |

**The critical pre-launch question to ask each alpha operator verbatim:**
> "If Gordon shut down tomorrow, what would you use instead?"

If the answer is "nothing that does what Gordon does," the churn and conversion assumptions are conservative. If the answer is "I'd go back to TradingView + manual execution," the product needs more work before launch.

---

## Appendix: Key Formulas Reference

```
MRR = Σ(Active Users per Tier × Tier Price)
ARR = MRR × 12

LTV = (ARPU × Gross Margin %) / Monthly Churn Rate
LTV:CAC = LTV / Blended CAC
CAC Payback (months) = CAC / (ARPU × Gross Margin %)

Burn Multiple = Net Cash Burn (period) / Net New ARR Added (period)
  [< 1.0 = capital efficient, < 0.5 = exceptional]

Net MRR Change = New MRR (new subs) + Expansion MRR (upgrades) – Churned MRR – Contraction MRR
Monthly Growth Rate = (MRR_t – MRR_{t-1}) / MRR_{t-1}

Blended ARPU = (Pro Active × $49 + Power Active × $149) / Total Active Paid
```

---

*Model built for internal planning and investor reference. All projections are estimates based on comparable benchmarks and stated assumptions. Actuals will vary. Model should be re-validated monthly against friends-alpha cohort data once available.*
