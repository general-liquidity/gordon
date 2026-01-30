# Grid Entry Strategy Design

**Date:** 2026-01-30
**Status:** Approved
**Author:** Claude + User

## Overview

Add a one-shot grid entry strategy to Gordon CLI that places layered buy orders across support zones, enabling systematic position accumulation with AI-guided level calculation.

## Goals

1. Enable users to enter positions using grid-style layered buys
2. Leverage AI to propose optimal grid levels based on technical analysis
3. Maintain Gordon's human-in-the-loop philosophy (AI proposes, user approves)
4. Fit within existing safety model (ARMED mode, 24h expiry)

## Non-Goals

- Passive grid bot (continuous buy/sell cycling) - deferred to future
- Short positions (grid sells) - Gordon is long-only currently
- Cross-margin or futures - spot trading only

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Grid mode | One-shot entry | Fits 24h auto-disarm, simpler than passive bot |
| Level calculation | AI-guided (hybrid) | AI proposes based on support zones, user can adjust |
| Allocation distribution | Pyramid default | Better avg entry, "buy more when cheaper" |
| TP placement | Deferred until fills | Based on actual avg entry, not theoretical |
| Number of levels | 3-7, default 5 | Balance between granularity and order management |

## Schema Changes

### New Grid Configuration Schema

```typescript
// src/types/plan.ts

export const GridLevelSchema = z.object({
  price: z.number(),
  percentOfAllocation: z.number().min(0).max(1),
});

export const GridConfigSchema = z.object({
  levels: z.array(GridLevelSchema).min(3).max(7),
  distribution: z.enum(["pyramid", "equal"]),
  priceRange: z.object({
    high: z.number(),
    low: z.number(),
  }),
});

export type GridLevel = z.infer<typeof GridLevelSchema>;
export type GridConfig = z.infer<typeof GridConfigSchema>;
```

### Updated Plan Schema

```typescript
export const PlanSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  symbol: z.string(),
  direction: z.literal("long"),

  // CHANGED: Now supports grid_entry
  strategy: z.enum(["support_bounce", "grid_entry"]),

  allocation: z.object({
    currency: z.literal("USDT"),
    amount: z.number(),
    percentOfPortfolio: z.number(),
  }),

  entry: z.object({
    type: z.enum(["limit", "market"]),
    price: z.number().nullable(),
  }),

  dca: z.array(DCALevelSchema).nullable(),

  // NEW: Grid configuration (null for support_bounce)
  grid: GridConfigSchema.nullable(),

  stopLoss: z.object({
    price: z.number(),
  }),

  takeProfit: z.array(TakeProfitLevelSchema),
  reasoning: z.string(),
  status: z.enum(["DRAFT", "APPROVED", "EXECUTING", "CLOSED", "CANCELLED"]),
});
```

### Field Usage by Strategy

| Field | support_bounce | grid_entry |
|-------|---------------|------------|
| `entry` | Single entry point | Highest grid level (for reference) |
| `dca` | Optional DCA levels | `null` (grid.levels replaces this) |
| `grid` | `null` | Grid configuration with levels |
| `stopLoss` | Below entry | Below lowest grid level |
| `takeProfit` | Based on entry | Based on weighted avg entry |

## Calculation Logic

### Grid Calculator Module

```typescript
// src/core/grid-calculator.ts

export interface GridCalculationInput {
  symbol: string;
  supports: Level[];           // From analyzer.ts
  currentPrice: number;
  numLevels: number;           // Default: 5, range: 3-7
  distribution: "pyramid" | "equal";
  allocation: number;          // Total USDT to deploy
}

export interface GridCalculationResult {
  levels: Array<{
    price: number;
    percentOfAllocation: number;
    amount: number;
    nearSupport: string | null;
  }>;
  priceRange: { high: number; low: number };
  weightedEntryIfAllFill: number;
}

export function calculateGridLevels(input: GridCalculationInput): GridCalculationResult;
```

### Allocation Distribution

**Pyramid Distribution** (default):
```
Level 1 (highest): 10%
Level 2:           15%
Level 3:           20%
Level 4:           25%
Level 5 (lowest):  30%
```

Formula for n levels: `weight[i] = (i + 1) / triangularNumber(n)`
where `triangularNumber(n) = n * (n + 1) / 2`

**Equal Distribution**:
```
Each level: 100% / n
```

### Level Placement Algorithm

1. Get support zones from analyzer (S1, S2, S3)
2. Set grid range:
   - High: Current price or S1 (whichever is lower, ensuring we buy below market)
   - Low: S3 or 10% below current price (whichever is lower)
3. Space levels evenly within range
4. Snap levels to nearby support if within 1% (cleaner entries)

## Execution Flow

### Order Placement Sequence

```
1. PLACE GRID BUY ORDERS (all LIMIT)
   → Level 1: BUY X₁ @ price₁
   → Level 2: BUY X₂ @ price₂
   → ...
   → Level N: BUY Xₙ @ priceₙ

2. PLACE STOP LOSS (STOP_LOSS_LIMIT)
   → Below lowest grid level
   → Quantity: Sum of all grid quantities

3. TAKE PROFITS: DEFERRED
   → Not placed until entries fill
   → Based on actual weighted average entry

4. ON ANY FAILURE: ROLLBACK ALL
```

### Executor Changes

```typescript
// src/core/executor.ts

// New: Track grid orders separately
interface GridOrderState {
  gridOrders: PlacedOrder[];     // All grid level orders
  stopOrder: PlacedOrder | null;
  tpOrders: PlacedOrder[];       // Initially empty, filled by monitor
}

// Modified executePlan to handle grid_entry strategy
if (plan.strategy === "grid_entry" && plan.grid) {
  // Place each grid level as separate LIMIT order
  for (const level of plan.grid.levels) {
    // Calculate quantity for this level
    // Place order
    // Track in placedOrders
  }
  // Place stop loss for total quantity
  // DO NOT place take profits yet
}
```

## Monitor Changes

### Grid Trade State

```typescript
// Extended trade tracking for grids
interface GridTradeState {
  filledLevels: Array<{
    levelIndex: number;
    orderId: string;
    price: number;
    quantity: number;
    filledAt: string;
  }>;
  pendingLevels: number[];
  weightedAvgEntry: number;
  totalFilledQuantity: number;
  tpOrdersPlaced: boolean;
}
```

### Monitor State Machine

```
WAITING → FILLING → TP_PLACED → CLOSED
```

- **WAITING**: Grid orders placed, no fills yet
- **FILLING**: Some levels filled, tracking weighted avg
- **TP_PLACED**: Take profits active
- **CLOSED**: Trade complete (TP hit or stopped out)

### TP Trigger Conditions

Place take profits when either condition is met:

1. **All grid levels filled** → Place TPs immediately
2. **Price reverses above entry** → Price rises 1% above highest filled level

This prevents waiting forever for partial fills.

### Weighted Average Calculation

```typescript
function calculateWeightedAvgEntry(fills: Fill[]): number {
  const totalValue = fills.reduce((sum, f) => sum + f.price * f.quantity, 0);
  const totalQty = fills.reduce((sum, f) => sum + f.quantity, 0);
  return totalValue / totalQty;
}
```

## Validation Rules

### Grid-Specific Validation

```typescript
// src/core/validator.ts additions

function validateGridPlan(plan: Plan): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (plan.strategy !== "grid_entry" || !plan.grid) {
    return { valid: true, errors: [], warnings: [] };
  }

  const { grid } = plan;

  // Level count
  if (grid.levels.length < 3 || grid.levels.length > 7) {
    errors.push("Grid must have 3-7 levels");
  }

  // Percentages sum to 1
  const totalPercent = grid.levels.reduce((s, l) => s + l.percentOfAllocation, 0);
  if (Math.abs(totalPercent - 1.0) > 0.01) {
    errors.push(`Grid percentages must sum to 100%, got ${(totalPercent * 100).toFixed(1)}%`);
  }

  // Prices descending
  for (let i = 1; i < grid.levels.length; i++) {
    if (grid.levels[i].price >= grid.levels[i-1].price) {
      errors.push("Grid levels must be in descending price order");
      break;
    }
  }

  // Stop below lowest level
  const lowestLevel = grid.levels[grid.levels.length - 1].price;
  if (plan.stopLoss.price >= lowestLevel) {
    errors.push("Stop loss must be below lowest grid level");
  }

  // Range sanity check
  const rangePercent = (grid.priceRange.high - grid.priceRange.low) / grid.priceRange.high;
  if (rangePercent > 0.20) {
    warnings.push(`Grid range is ${(rangePercent * 100).toFixed(1)}% - consider tighter range`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
```

## UI/UX

### Plan Display

```
┌─────────────────────────────────────────────────────────────┐
│  GRID ENTRY PLAN: ETHUSDT                     Strategy: 📊  │
├─────────────────────────────────────────────────────────────┤
│  GRID LEVELS (Pyramid Distribution)                         │
│  ─────────────────────────────────────────────────────────  │
│  #1  $3,400  ████░░░░░░░░░░░░  10%   $100   ← near S1      │
│  #2  $3,340  ██████░░░░░░░░░░  15%   $150                   │
│  #3  $3,280  ████████░░░░░░░░  20%   $200   ← near S2      │
│  #4  $3,220  ██████████░░░░░░  25%   $250                   │
│  #5  $3,160  ████████████░░░░  30%   $300   ← near S3      │
│  ─────────────────────────────────────────────────────────  │
│  Total: $1,000 (10% of portfolio)                           │
│  Avg Entry (if all fill): $3,268                            │
├─────────────────────────────────────────────────────────────┤
│  RISK MANAGEMENT                                            │
│  Stop Loss:    $3,050  (-6.7% from avg)                     │
│  Take Profit:  $3,520 (50%) / $3,680 (50%)                  │
│  Risk/Reward:  1:2.3                                        │
├─────────────────────────────────────────────────────────────┤
│  [A]pprove    [E]dit levels    [C]ancel                     │
└─────────────────────────────────────────────────────────────┘
```

### Edit Mode

```
┌─────────────────────────────────────────────────────────────┐
│  EDIT GRID SETTINGS                                         │
├─────────────────────────────────────────────────────────────┤
│  Number of levels: [5]  (3-7)                               │
│  Distribution:     [Pyramid ▼]  Pyramid / Equal             │
│  Price range:      [$3,160] - [$3,400]                      │
│  Allocation:       [$1,000]                                 │
├─────────────────────────────────────────────────────────────┤
│  [R]ecalculate    [B]ack                                    │
└─────────────────────────────────────────────────────────────┘
```

### User Triggers

- `"I want to grid into ETH"`
- `"grid entry on ETHUSDT"`
- `"enter ETH with layered buys"`
- `/plan ETHUSDT grid`

## Implementation Plan

### Phase 1: Core Types & Calculator
1. Update `src/types/plan.ts` with grid schema
2. Create `src/core/grid-calculator.ts`
3. Add grid validation to `src/core/validator.ts`

### Phase 2: Planning & Execution
4. Update `src/core/planner.ts` for grid strategy
5. Update `prompts/planner.md` with grid instructions
6. Update `src/core/executor.ts` for grid order placement

### Phase 3: Monitoring
7. Update `src/core/monitor.ts` for grid fill tracking
8. Implement deferred TP placement logic

### Phase 4: UI & Tools
9. Update `src/app/PlanDiff.tsx` for grid display
10. Add grid tool to `src/infra/agents/tools/trading.ts`

### Phase 5: Testing & Polish
11. Add tests for grid calculator
12. Add tests for grid validation
13. End-to-end testing

## Files Changed

| File | Action | Estimated Lines |
|------|--------|-----------------|
| `src/types/plan.ts` | Modify | +30 |
| `src/core/grid-calculator.ts` | Create | ~150 |
| `src/core/validator.ts` | Modify | +40 |
| `src/core/planner.ts` | Modify | +50 |
| `prompts/planner.md` | Modify | +40 |
| `src/core/executor.ts` | Modify | +80 |
| `src/core/monitor.ts` | Modify | +100 |
| `src/app/PlanDiff.tsx` | Modify | +60 |
| `src/infra/agents/tools/trading.ts` | Modify | +30 |
| `src/core/grid-calculator.test.ts` | Create | ~100 |
| `src/core/validator.test.ts` | Modify | +50 |

**Total: ~730 lines of new/modified code**

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Partial fills leave position in limbo | TP trigger on price reversal above entry |
| Too many orders hit rate limits | Place orders sequentially with small delays |
| User confused by deferred TPs | Clear UI showing "TPs will be placed after fills" |
| Stop loss quantity mismatch | Stop quantity = sum of all grid quantities, updated on fills |

## Future Enhancements

1. **Passive Grid Bot** - Continuous buy/sell cycling for range-bound markets
2. **Custom level editing** - Let user manually specify each level price
3. **Grid analytics** - Show historical performance of grid entries
4. **Auto grid sizing** - Calculate optimal number of levels based on volatility
