# Grid Entry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one-shot grid entry strategy that places layered buy orders across support zones with AI-guided level calculation.

**Architecture:** Extend existing plan schema with grid configuration, add grid calculator module, modify executor for multi-order placement, enhance monitor for fill tracking and deferred TP placement.

**Tech Stack:** TypeScript, Zod schemas, Bun runtime

---

## Task 1: Add Grid Schema Types

**Files:**
- Modify: `src/types/plan.ts`

**Step 1: Add GridLevelSchema and GridConfigSchema**

Add these new schemas after `TakeProfitLevelSchema`:

```typescript
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

**Step 2: Update PlanSchema to support grid_entry strategy**

Change the `strategy` field from:
```typescript
strategy: z.literal("support_bounce"),
```

To:
```typescript
strategy: z.enum(["support_bounce", "grid_entry"]),
```

**Step 3: Add grid field to PlanSchema**

Add after the `dca` field:
```typescript
grid: GridConfigSchema.nullable(),
```

**Step 4: Run typecheck to verify schema changes**

Run: `bun run typecheck`
Expected: May have errors in other files that reference Plan type - that's expected, we'll fix them.

**Step 5: Commit**

```bash
git add src/types/plan.ts
git commit -m "$(cat <<'EOF'
feat(types): add grid entry schema

- Add GridLevelSchema and GridConfigSchema
- Extend strategy enum with grid_entry
- Add nullable grid field to Plan

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create Grid Calculator Module

**Files:**
- Create: `src/core/grid-calculator.ts`
- Create: `src/core/grid-calculator.test.ts`

**Step 1: Write failing test for calculatePyramidWeights**

Create `src/core/grid-calculator.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { calculatePyramidWeights, calculateEqualWeights } from "./grid-calculator.ts";

describe("grid-calculator", () => {
  describe("calculatePyramidWeights", () => {
    it("should return weights that sum to 1", () => {
      const weights = calculatePyramidWeights(5);
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(0.001);
    });

    it("should have increasing weights (more at lower prices)", () => {
      const weights = calculatePyramidWeights(5);
      // weights[0] is highest price (smallest), weights[4] is lowest price (largest)
      for (let i = 1; i < weights.length; i++) {
        expect(weights[i]).toBeGreaterThan(weights[i - 1]!);
      }
    });

    it("should handle 3 levels", () => {
      const weights = calculatePyramidWeights(3);
      expect(weights).toHaveLength(3);
      // 1/6, 2/6, 3/6 = ~0.167, ~0.333, ~0.5
      expect(weights[0]).toBeCloseTo(1 / 6, 2);
      expect(weights[1]).toBeCloseTo(2 / 6, 2);
      expect(weights[2]).toBeCloseTo(3 / 6, 2);
    });
  });

  describe("calculateEqualWeights", () => {
    it("should return equal weights summing to 1", () => {
      const weights = calculateEqualWeights(5);
      expect(weights).toHaveLength(5);
      weights.forEach(w => expect(w).toBeCloseTo(0.2, 5));
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/grid-calculator.test.ts`
Expected: FAIL - module not found

**Step 3: Implement weight calculation functions**

Create `src/core/grid-calculator.ts`:

```typescript
/**
 * Grid Calculator Module
 *
 * Calculates grid levels and allocations for grid entry strategy.
 * Purely deterministic - no AI involved.
 */

import type { Level } from "../types/index.ts";
import type { GridConfig, GridLevel } from "../types/plan.ts";

// ============================================================================
// Types
// ============================================================================

export interface GridCalculationInput {
  supports: Level[];
  currentPrice: number;
  numLevels: number;
  distribution: "pyramid" | "equal";
  allocation: number;
}

export interface GridCalculationResult {
  config: GridConfig;
  levels: Array<{
    price: number;
    percentOfAllocation: number;
    amount: number;
    nearSupport: string | null;
  }>;
  weightedEntryIfAllFill: number;
  stopLossPrice: number;
}

// ============================================================================
// Weight Calculation
// ============================================================================

/**
 * Calculate pyramid weights where lower prices get more allocation.
 * Formula: weight[i] = (i + 1) / triangularNumber(n)
 * where triangularNumber(n) = n * (n + 1) / 2
 */
export function calculatePyramidWeights(numLevels: number): number[] {
  const triangular = (numLevels * (numLevels + 1)) / 2;
  const weights: number[] = [];

  for (let i = 0; i < numLevels; i++) {
    weights.push((i + 1) / triangular);
  }

  return weights;
}

/**
 * Calculate equal weights for uniform distribution.
 */
export function calculateEqualWeights(numLevels: number): number[] {
  const weight = 1 / numLevels;
  return Array(numLevels).fill(weight);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/grid-calculator.test.ts`
Expected: PASS

**Step 5: Add test for calculateGridLevels**

Add to test file:

```typescript
import { calculateGridLevels } from "./grid-calculator.ts";
import type { Level } from "../types/index.ts";

describe("calculateGridLevels", () => {
  const mockSupports: Level[] = [
    { price: 3400, type: "support", strength: 0.8, touches: 3 },
    { price: 3280, type: "support", strength: 0.7, touches: 2 },
    { price: 3160, type: "support", strength: 0.6, touches: 2 },
  ];

  it("should create correct number of levels", () => {
    const result = calculateGridLevels({
      supports: mockSupports,
      currentPrice: 3450,
      numLevels: 5,
      distribution: "pyramid",
      allocation: 1000,
    });

    expect(result.levels).toHaveLength(5);
  });

  it("should have descending prices", () => {
    const result = calculateGridLevels({
      supports: mockSupports,
      currentPrice: 3450,
      numLevels: 5,
      distribution: "pyramid",
      allocation: 1000,
    });

    for (let i = 1; i < result.levels.length; i++) {
      expect(result.levels[i]!.price).toBeLessThan(result.levels[i - 1]!.price);
    }
  });

  it("should use pyramid distribution correctly", () => {
    const result = calculateGridLevels({
      supports: mockSupports,
      currentPrice: 3450,
      numLevels: 5,
      distribution: "pyramid",
      allocation: 1000,
    });

    // First level (highest price) should have smallest allocation
    // Last level (lowest price) should have largest allocation
    expect(result.levels[0]!.amount).toBeLessThan(result.levels[4]!.amount);
  });

  it("should calculate weighted average entry", () => {
    const result = calculateGridLevels({
      supports: mockSupports,
      currentPrice: 3450,
      numLevels: 5,
      distribution: "equal",
      allocation: 1000,
    });

    // Weighted avg should be between highest and lowest level
    expect(result.weightedEntryIfAllFill).toBeLessThan(result.levels[0]!.price);
    expect(result.weightedEntryIfAllFill).toBeGreaterThan(result.levels[4]!.price);
  });

  it("should set stop loss below lowest level", () => {
    const result = calculateGridLevels({
      supports: mockSupports,
      currentPrice: 3450,
      numLevels: 5,
      distribution: "pyramid",
      allocation: 1000,
    });

    const lowestLevel = result.levels[result.levels.length - 1]!.price;
    expect(result.stopLossPrice).toBeLessThan(lowestLevel);
  });
});
```

**Step 6: Run test to verify it fails**

Run: `bun test src/core/grid-calculator.test.ts`
Expected: FAIL - calculateGridLevels not found

**Step 7: Implement calculateGridLevels**

Add to `src/core/grid-calculator.ts`:

```typescript
// ============================================================================
// Constants
// ============================================================================

const DEFAULT_NUM_LEVELS = 5;
const MIN_LEVELS = 3;
const MAX_LEVELS = 7;
const STOP_LOSS_BUFFER_PERCENT = 0.03; // 3% below lowest grid level
const SUPPORT_SNAP_THRESHOLD = 0.01; // Snap to support if within 1%

// ============================================================================
// Main Calculation
// ============================================================================

/**
 * Calculate grid levels based on support zones and configuration.
 */
export function calculateGridLevels(input: GridCalculationInput): GridCalculationResult {
  const {
    supports,
    currentPrice,
    numLevels,
    distribution,
    allocation,
  } = input;

  // Validate level count
  const levels = Math.max(MIN_LEVELS, Math.min(MAX_LEVELS, numLevels));

  // Determine grid range based on supports
  const sortedSupports = [...supports]
    .filter(s => s.price < currentPrice)
    .sort((a, b) => b.price - a.price); // Descending (highest first)

  // High: nearest support or 2% below current price
  const highPrice = sortedSupports[0]?.price ?? currentPrice * 0.98;

  // Low: furthest support or 10% below current price
  const lowPrice = sortedSupports[2]?.price ?? sortedSupports[1]?.price ?? currentPrice * 0.90;

  // Calculate price spacing
  const priceStep = (highPrice - lowPrice) / (levels - 1);

  // Get weights based on distribution
  const weights = distribution === "pyramid"
    ? calculatePyramidWeights(levels)
    : calculateEqualWeights(levels);

  // Build grid levels
  const gridLevels: GridCalculationResult["levels"] = [];

  for (let i = 0; i < levels; i++) {
    let price = highPrice - (priceStep * i);

    // Snap to nearby support if within threshold
    const nearbySupport = sortedSupports.find(s =>
      Math.abs(s.price - price) / price < SUPPORT_SNAP_THRESHOLD
    );
    if (nearbySupport) {
      price = nearbySupport.price;
    }

    const percent = weights[i]!;
    const amount = allocation * percent;

    // Determine support label
    let nearSupport: string | null = null;
    const supportIndex = sortedSupports.findIndex(s =>
      Math.abs(s.price - price) / price < SUPPORT_SNAP_THRESHOLD
    );
    if (supportIndex !== -1) {
      nearSupport = `S${supportIndex + 1}`;
    }

    gridLevels.push({
      price: roundPrice(price),
      percentOfAllocation: percent,
      amount: roundAmount(amount),
      nearSupport,
    });
  }

  // Calculate weighted average entry if all levels fill
  const weightedEntry = gridLevels.reduce(
    (sum, level) => sum + level.price * level.percentOfAllocation,
    0
  );

  // Stop loss: 3% below lowest grid level
  const lowestPrice = gridLevels[gridLevels.length - 1]!.price;
  const stopLossPrice = roundPrice(lowestPrice * (1 - STOP_LOSS_BUFFER_PERCENT));

  // Build GridConfig for schema
  const config: GridConfig = {
    levels: gridLevels.map(l => ({
      price: l.price,
      percentOfAllocation: l.percentOfAllocation,
    })),
    distribution,
    priceRange: {
      high: gridLevels[0]!.price,
      low: gridLevels[gridLevels.length - 1]!.price,
    },
  };

  return {
    config,
    levels: gridLevels,
    weightedEntryIfAllFill: roundPrice(weightedEntry),
    stopLossPrice,
  };
}

// ============================================================================
// Utilities
// ============================================================================

function roundPrice(price: number): number {
  // Round to 2 decimal places for most prices, more for small prices
  if (price < 1) return Math.round(price * 10000) / 10000;
  if (price < 10) return Math.round(price * 1000) / 1000;
  return Math.round(price * 100) / 100;
}

function roundAmount(amount: number): number {
  return Math.round(amount * 100) / 100;
}
```

**Step 8: Run tests to verify they pass**

Run: `bun test src/core/grid-calculator.test.ts`
Expected: PASS

**Step 9: Commit**

```bash
git add src/core/grid-calculator.ts src/core/grid-calculator.test.ts
git commit -m "$(cat <<'EOF'
feat(core): add grid calculator module

- calculatePyramidWeights: more allocation at lower prices
- calculateEqualWeights: uniform distribution
- calculateGridLevels: generate grid from support zones

Includes full test coverage for weight calculations and level generation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Grid Validation

**Files:**
- Modify: `src/core/validator.ts`
- Modify: `src/core/validator.test.ts`

**Step 1: Write failing test for grid validation**

Add to `src/core/validator.test.ts`:

```typescript
describe("validatePlan - grid_entry", () => {
  const baseGridPlan: Plan = {
    id: "pln_test123",
    createdAt: new Date().toISOString(),
    symbol: "ETHUSDT",
    direction: "long",
    strategy: "grid_entry",
    allocation: {
      currency: "USDT",
      amount: 1000,
      percentOfPortfolio: 0.1,
    },
    entry: {
      type: "limit",
      price: 3400,
    },
    dca: null,
    grid: {
      levels: [
        { price: 3400, percentOfAllocation: 0.1 },
        { price: 3340, percentOfAllocation: 0.15 },
        { price: 3280, percentOfAllocation: 0.2 },
        { price: 3220, percentOfAllocation: 0.25 },
        { price: 3160, percentOfAllocation: 0.3 },
      ],
      distribution: "pyramid",
      priceRange: { high: 3400, low: 3160 },
    },
    stopLoss: { price: 3050 },
    takeProfit: [
      { price: 3600, percentToSell: 0.5 },
      { price: 3800, percentToSell: 0.5 },
    ],
    reasoning: "Test grid plan",
    status: "DRAFT",
  };

  it("should validate a correct grid plan", () => {
    const result = validatePlan(baseGridPlan, mockConfig, mockPortfolio);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should error if grid percentages don't sum to 1", () => {
    const badPlan = {
      ...baseGridPlan,
      grid: {
        ...baseGridPlan.grid!,
        levels: [
          { price: 3400, percentOfAllocation: 0.1 },
          { price: 3340, percentOfAllocation: 0.1 },
          { price: 3280, percentOfAllocation: 0.1 },
        ],
      },
    };
    const result = validatePlan(badPlan, mockConfig, mockPortfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("sum to 100%"))).toBe(true);
  });

  it("should error if grid levels are not descending", () => {
    const badPlan = {
      ...baseGridPlan,
      grid: {
        ...baseGridPlan.grid!,
        levels: [
          { price: 3200, percentOfAllocation: 0.33 },
          { price: 3400, percentOfAllocation: 0.33 },
          { price: 3300, percentOfAllocation: 0.34 },
        ],
      },
    };
    const result = validatePlan(badPlan, mockConfig, mockPortfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("descending"))).toBe(true);
  });

  it("should error if stop loss is above lowest grid level", () => {
    const badPlan = {
      ...baseGridPlan,
      stopLoss: { price: 3200 }, // Above lowest level of 3160
    };
    const result = validatePlan(badPlan, mockConfig, mockPortfolio);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("below lowest grid level"))).toBe(true);
  });

  it("should warn if grid range is too wide", () => {
    const widePlan = {
      ...baseGridPlan,
      grid: {
        ...baseGridPlan.grid!,
        priceRange: { high: 3400, low: 2700 }, // >20% range
      },
    };
    const result = validatePlan(widePlan, mockConfig, mockPortfolio);
    expect(result.warnings.some(w => w.includes("range"))).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/validator.test.ts`
Expected: FAIL - tests fail because grid validation not implemented

**Step 3: Implement grid validation**

Add to `src/core/validator.ts` after `generateWarnings` function:

```typescript
/**
 * Validate grid-specific rules
 */
function validateGrid(
  plan: Plan,
  errors: string[],
  warnings: string[]
): void {
  if (plan.strategy !== "grid_entry" || !plan.grid) {
    return;
  }

  const { grid } = plan;

  // Level count validation (already enforced by schema, but double-check)
  if (grid.levels.length < 3 || grid.levels.length > 7) {
    errors.push(
      `Grid must have 3-7 levels. Current: ${grid.levels.length} levels.`
    );
  }

  // Percentages must sum to 1
  const totalPercent = grid.levels.reduce(
    (sum, level) => sum + level.percentOfAllocation,
    0
  );
  if (Math.abs(totalPercent - 1.0) > 0.01) {
    errors.push(
      `Grid level percentages must sum to 100%. Current sum: ${(totalPercent * 100).toFixed(1)}%.`
    );
  }

  // Prices must be in descending order
  for (let i = 1; i < grid.levels.length; i++) {
    const current = grid.levels[i];
    const previous = grid.levels[i - 1];
    if (current && previous && current.price >= previous.price) {
      errors.push(
        `Grid levels must be in descending price order. Level ${i + 1} (${current.price}) >= Level ${i} (${previous.price}).`
      );
      break;
    }
  }

  // Stop loss must be below lowest grid level
  const lowestLevel = grid.levels[grid.levels.length - 1];
  if (lowestLevel && plan.stopLoss.price >= lowestLevel.price) {
    errors.push(
      `Stop loss (${plan.stopLoss.price}) must be below lowest grid level (${lowestLevel.price}).`
    );
  }

  // Warning: Grid range too wide (>20%)
  const rangePercent =
    (grid.priceRange.high - grid.priceRange.low) / grid.priceRange.high;
  if (rangePercent > 0.20) {
    warnings.push(
      `Grid range is ${(rangePercent * 100).toFixed(1)}% - consider a tighter range for better capital efficiency.`
    );
  }
}
```

**Step 4: Update validatePlan to call validateGrid**

In the `validatePlan` function, add after `generateWarnings`:

```typescript
validateGrid(plan, errors, warnings);
```

**Step 5: Run tests to verify they pass**

Run: `bun test src/core/validator.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/core/validator.ts src/core/validator.test.ts
git commit -m "$(cat <<'EOF'
feat(validator): add grid-specific validation rules

- Validate grid level percentages sum to 100%
- Ensure prices are in descending order
- Stop loss must be below lowest grid level
- Warn if grid range exceeds 20%

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update Planner for Grid Strategy

**Files:**
- Modify: `src/core/planner.ts`
- Modify: `prompts/planner.md`

**Step 1: Update LLMPlanResponse type**

In `src/core/planner.ts`, update the `LLMPlanResponse` interface:

```typescript
interface LLMPlanResponse {
  symbol: string;
  direction: "long";
  strategy: "support_bounce" | "grid_entry";
  allocation: {
    currency: "USDT";
    amount: number;
    percentOfPortfolio: number;
  };
  entry: {
    type: "limit" | "market";
    price: number | null;
  };
  dca: Array<{
    price: number;
    percentOfAllocation: number;
  }> | null;
  grid: {
    levels: Array<{
      price: number;
      percentOfAllocation: number;
    }>;
    distribution: "pyramid" | "equal";
    priceRange: {
      high: number;
      low: number;
    };
  } | null;
  stopLoss: {
    price: number;
  };
  takeProfit: Array<{
    price: number;
    percentToSell: number;
  }>;
  reasoning: string;
}
```

**Step 2: Update validatePlanStructure for grid**

Add grid validation to `validatePlanStructure`:

```typescript
// Grid validation (if grid_entry strategy)
if (plan.strategy === "grid_entry") {
  if (!plan.grid || plan.grid.levels.length === 0) {
    errors.push("Grid entry strategy requires grid configuration with levels");
  } else {
    // Grid percentages must sum to 1
    const gridSum = plan.grid.levels.reduce((sum, l) => sum + l.percentOfAllocation, 0);
    if (Math.abs(gridSum - 1.0) > 0.01) {
      errors.push(`Grid percentages must sum to 100%, got ${(gridSum * 100).toFixed(1)}%`);
    }

    // Grid prices must be descending
    for (let i = 1; i < plan.grid.levels.length; i++) {
      if (plan.grid.levels[i]!.price >= plan.grid.levels[i - 1]!.price) {
        errors.push("Grid levels must be in descending price order");
        break;
      }
    }

    // Stop loss must be below lowest grid level
    const lowestGridLevel = plan.grid.levels[plan.grid.levels.length - 1]!.price;
    if (plan.stopLoss.price >= lowestGridLevel) {
      errors.push(`Stop loss must be below lowest grid level (${lowestGridLevel})`);
    }
  }

  // DCA should be null for grid entry
  if (plan.dca && plan.dca.length > 0) {
    errors.push("Grid entry strategy should not have DCA levels (use grid.levels instead)");
  }
}
```

**Step 3: Update prompts/planner.md with grid entry section**

Add after the Support Bounce Strategy section:

```markdown
## The Grid Entry Strategy

Grid Entry is an accumulation strategy that places multiple buy orders at descending price levels, ideal for ranging or uncertain markets.

### Core Concept

1. **Identify support zone**: Find multiple support levels (S1, S2, S3)
2. **Place layered buys**: Create 3-7 buy orders spread across the support zone
3. **Pyramid allocation**: Allocate more capital at lower prices (optional)
4. **Single stop loss**: Below the entire grid for risk management
5. **Take profits after fills**: Based on actual weighted average entry

### Why This Works

- **Removes timing pressure**: Don't need to pick the exact bottom
- **Better average entry**: If price drops through grid, average cost is lower
- **Clear risk management**: One stop loss below the grid protects the position

### When to Use Grid Entry

- Market is ranging or uncertain (not clearly trending)
- Multiple clear support levels exist
- User wants to accumulate rather than catch an exact bounce
- Position size is large enough to warrant splitting

---

## Grid Entry Output Format

When generating a grid_entry plan, use this structure:

```json
{
  "symbol": "ETHUSDT",
  "direction": "long",
  "strategy": "grid_entry",

  "allocation": {
    "currency": "USDT",
    "amount": 1000,
    "percentOfPortfolio": 0.10
  },

  "entry": {
    "type": "limit",
    "price": 3400
  },

  "dca": null,

  "grid": {
    "levels": [
      { "price": 3400, "percentOfAllocation": 0.10 },
      { "price": 3340, "percentOfAllocation": 0.15 },
      { "price": 3280, "percentOfAllocation": 0.20 },
      { "price": 3220, "percentOfAllocation": 0.25 },
      { "price": 3160, "percentOfAllocation": 0.30 }
    ],
    "distribution": "pyramid",
    "priceRange": {
      "high": 3400,
      "low": 3160
    }
  },

  "stopLoss": {
    "price": 3050
  },

  "takeProfit": [
    { "price": 3600, "percentToSell": 0.50 },
    { "price": 3800, "percentToSell": 0.50 }
  ],

  "reasoning": "ETH is ranging between $3,100-$3,500. Multiple support levels identified. Grid entry allows accumulation across support zone with pyramid weighting."
}
```

### Grid Entry Rules

**Level Count:**
- Minimum: 3 levels
- Maximum: 7 levels
- Default: 5 levels

**Distribution Options:**
- `pyramid`: More allocation at lower prices (recommended)
  - 5 levels: 10%, 15%, 20%, 25%, 30%
- `equal`: Same allocation at each level
  - 5 levels: 20%, 20%, 20%, 20%, 20%

**Level Placement:**
1. Highest level: Near S1 or 2% below current price
2. Lowest level: Near S3 or 10% below current price
3. Middle levels: Evenly spaced, snapped to nearby support if within 1%

**Stop Loss:**
- 3% below the lowest grid level
- Never inside the grid range

**Take Profits:**
- Based on expected weighted average entry (if all levels fill)
- Same TP rules as support_bounce (R1, R2 targets)
- TPs are placed AFTER grid entries start filling (deferred)

### Choosing Between Strategies

| Factor | Support Bounce | Grid Entry |
|--------|---------------|------------|
| Market | Clear bounce setup | Ranging/uncertain |
| Confidence | High (price at support) | Medium (unsure of exact bottom) |
| Timing | Specific entry point | Spread across zone |
| Position size | Any | Better for larger positions |
```

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (or known errors from executor/monitor which we'll fix next)

**Step 5: Commit**

```bash
git add src/core/planner.ts prompts/planner.md
git commit -m "$(cat <<'EOF'
feat(planner): add grid entry strategy support

- Update LLMPlanResponse to include grid configuration
- Add grid-specific validation in planner
- Document grid entry strategy in planner prompt

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update Executor for Grid Orders

**Files:**
- Modify: `src/core/executor.ts`

**Step 1: Add grid order placement logic**

In `executePlan` function, after the existing entry order logic, add a branch for grid_entry:

```typescript
// Handle grid_entry strategy
if (plan.strategy === "grid_entry" && plan.grid) {
  return await executeGridPlan(client, plan, config, portfolio);
}
```

**Step 2: Implement executeGridPlan function**

Add new function:

```typescript
/**
 * Execute a grid entry plan by placing multiple buy orders
 */
async function executeGridPlan(
  client: BinanceClient,
  plan: Plan,
  config: GordonConfig,
  portfolio: PortfolioState
): Promise<ExecutionResult> {
  const placedOrders: PlacedOrder[] = [];

  if (!plan.grid) {
    return {
      success: false,
      error: "Grid configuration is required for grid_entry strategy",
      orders: [],
    };
  }

  logger.info("Executing grid plan", {
    planId: plan.id,
    symbol: plan.symbol,
    levels: plan.grid.levels.length,
  });

  // Validate mode and expiration (same as regular execution)
  if (config.mode !== "ARMED") {
    return {
      success: false,
      error: "Cannot execute: System is not in ARMED mode. Use '/arm' to enable trading.",
      orders: [],
    };
  }

  if (config.armedUntil === null || new Date(config.armedUntil) <= new Date()) {
    return {
      success: false,
      error: "Cannot execute: ARMED mode has expired. Please re-arm the system.",
      orders: [],
    };
  }

  // Validate plan
  const validationResult = validatePlan(plan, config, portfolio);
  if (!validationResult.valid) {
    return {
      success: false,
      error: `Validation failed: ${validationResult.errors.join("; ")}`,
      orders: [],
    };
  }

  try {
    // Get current price
    const currentPrice = await client.getPrice(plan.symbol);

    // Calculate total quantity for all grid levels
    let totalQuantity = 0;
    const gridOrders: Array<{ level: number; quantity: number; price: number }> = [];

    for (let i = 0; i < plan.grid.levels.length; i++) {
      const level = plan.grid.levels[i]!;
      const levelAmount = plan.allocation.amount * level.percentOfAllocation;
      const quantity = roundQuantity(levelAmount / level.price);
      totalQuantity += quantity;

      gridOrders.push({
        level: i + 1,
        quantity,
        price: level.price,
      });
    }

    // Place grid buy orders
    for (const gridOrder of gridOrders) {
      const orderParams: OrderParams = {
        symbol: plan.symbol,
        side: "BUY",
        type: "LIMIT",
        quantity: gridOrder.quantity,
        price: roundPrice(gridOrder.price),
        timeInForce: "GTC",
        newClientOrderId: generateClientOrderId(plan.id, `grid${gridOrder.level}`),
      };

      try {
        const order = await client.placeOrder(orderParams);
        logger.info("Grid order placed", {
          level: gridOrder.level,
          orderId: order.orderId,
          price: gridOrder.price,
        });

        placedOrders.push({
          type: "entry", // Grid entries are tracked as entry type
          orderId: order.orderId.toString(),
          price: gridOrder.price,
          quantity: gridOrder.quantity,
        });

        logEvent({
          type: "ORDER_PLACED",
          data: {
            action: `GRID_LEVEL_${gridOrder.level}`,
            orderId: order.orderId.toString(),
            symbol: plan.symbol,
            side: "BUY",
            type: "LIMIT",
            price: gridOrder.price,
            quantity: gridOrder.quantity,
          },
          planId: plan.id,
        });
      } catch (error) {
        // Rollback on failure
        await rollbackOrders(client, plan.symbol, placedOrders, plan.id);

        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Grid order failed", error as Error, {
          level: gridOrder.level,
          params: orderParams,
        });

        return {
          success: false,
          error: `Failed to place grid level ${gridOrder.level}: ${errorMessage}. All orders rolled back.`,
          orders: placedOrders,
        };
      }
    }

    // Place stop loss for total quantity
    const stopOrderParams: OrderParams = {
      symbol: plan.symbol,
      side: "SELL",
      type: "STOP_LOSS_LIMIT",
      quantity: roundQuantity(totalQuantity),
      price: roundPrice(plan.stopLoss.price * 0.995),
      stopPrice: roundPrice(plan.stopLoss.price),
      timeInForce: "GTC",
      newClientOrderId: generateClientOrderId(plan.id, "stop"),
    };

    try {
      const stopOrder = await client.placeOrder(stopOrderParams);
      logger.info("Grid stop order placed", {
        orderId: stopOrder.orderId,
        stopPrice: plan.stopLoss.price,
        quantity: totalQuantity,
      });

      placedOrders.push({
        type: "stop",
        orderId: stopOrder.orderId.toString(),
        price: plan.stopLoss.price,
        quantity: totalQuantity,
      });
    } catch (error) {
      await rollbackOrders(client, plan.symbol, placedOrders, plan.id);

      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Grid stop order failed", error as Error, { params: stopOrderParams });

      return {
        success: false,
        error: `Failed to place stop loss: ${errorMessage}. All orders rolled back.`,
        orders: placedOrders,
      };
    }

    // NOTE: Take profit orders are NOT placed here for grid entry
    // They will be placed by the monitor after entries fill

    // Create trade record
    // For grid entry, we don't know the average entry yet, so use the highest level
    const highestLevel = plan.grid.levels[0]!;
    const trade = createTrade({
      planId: plan.id,
      openedAt: new Date().toISOString(),
      closedAt: null,
      symbol: plan.symbol,
      entries: [], // Will be populated as grid levels fill
      exits: [],
      averageEntry: highestLevel.price, // Placeholder, updated on fills
      realizedPnl: 0,
      realizedPnlPercent: 0,
      status: "PARTIAL", // Grid trades start as PARTIAL until entries fill
    });

    await emitEvent("trade:opened", { trade, planId: plan.id });

    logger.info("Grid trade created", {
      tradeId: trade.id,
      symbol: plan.symbol,
      gridLevels: plan.grid.levels.length,
      orderCount: placedOrders.length,
    });

    logEvent({
      type: "ORDER_PLACED",
      data: {
        action: "GRID_TRADE_CREATED",
        tradeId: trade.id,
        symbol: plan.symbol,
        gridLevels: plan.grid.levels.length,
        orderCount: placedOrders.length,
      },
      planId: plan.id,
      tradeId: trade.id,
    });

    updatePlan(plan.id, { status: "EXECUTING" });

    return {
      success: true,
      trade,
      orders: placedOrders,
    };
  } catch (error) {
    if (placedOrders.length > 0) {
      await rollbackOrders(client, plan.symbol, placedOrders, plan.id);
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Grid execution error", error as Error, { planId: plan.id });

    return {
      success: false,
      error: `Grid execution failed: ${errorMessage}`,
      orders: placedOrders,
    };
  }
}
```

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/core/executor.ts
git commit -m "$(cat <<'EOF'
feat(executor): add grid order placement

- executeGridPlan places multiple limit buys across grid levels
- Single stop loss for total position
- Take profits deferred until fills (handled by monitor)
- Full rollback on any order failure

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update Monitor for Grid Fills

**Files:**
- Modify: `src/core/monitor.ts`

**Step 1: Add grid fill detection**

In `checkOrderFills`, add grid-specific logic after checking for the plan:

```typescript
// Check if this is a grid entry plan
if (plan.strategy === "grid_entry" && plan.grid) {
  return await checkGridFills(client, trade, plan, alerts);
}
```

**Step 2: Implement checkGridFills function**

Add new function:

```typescript
/**
 * Check for grid level fills and handle deferred TP placement
 */
async function checkGridFills(
  client: BinanceClient,
  trade: Trade,
  plan: Plan,
  alerts: Alert[]
): Promise<Alert[]> {
  if (!plan.grid) return alerts;

  try {
    const currentPrice = await client.getPrice(trade.symbol);
    const openOrders = await client.getOpenOrders(trade.symbol);
    const openOrderIds = new Set(openOrders.map(o => String(o.orderId)));

    let tradeUpdated = false;
    const updatedTrade = { ...trade };
    const updatedEntries = [...trade.entries];

    // Check each grid level for fills
    for (let i = 0; i < plan.grid.levels.length; i++) {
      const level = plan.grid.levels[i]!;

      // Check if this level already has an entry
      const alreadyFilled = trade.entries.some(
        e => Math.abs(e.price - level.price) / level.price < 0.001
      );
      if (alreadyFilled) continue;

      // Check if price has crossed this level (simulating fill)
      if (currentPrice <= level.price) {
        const levelAmount = plan.allocation.amount * level.percentOfAllocation;
        const quantity = levelAmount / level.price;

        const gridFill = {
          orderId: `grid_${i + 1}_${trade.id}`,
          price: level.price,
          quantity,
          filledAt: new Date().toISOString(),
        };

        updatedEntries.push(gridFill);
        tradeUpdated = true;

        alerts.push({
          type: "order_filled",
          tradeId: trade.id,
          message: `${trade.symbol}: Grid level ${i + 1} filled at ${level.price}`,
          severity: "info",
          data: {
            orderType: `GRID_LEVEL_${i + 1}`,
            fillPrice: level.price,
            quantity,
          },
        });

        logger.info("Grid level filled", {
          tradeId: trade.id,
          level: i + 1,
          price: level.price,
        });

        logEvent({
          type: "ORDER_FILLED",
          data: {
            orderType: `GRID_LEVEL_${i + 1}`,
            fillPrice: level.price,
            quantity,
          },
          tradeId: trade.id,
          planId: trade.planId,
        });
      }
    }

    // Update trade if any fills occurred
    if (tradeUpdated) {
      updatedTrade.entries = updatedEntries;

      // Recalculate weighted average entry
      const totalValue = updatedEntries.reduce((sum, e) => sum + e.price * e.quantity, 0);
      const totalQty = updatedEntries.reduce((sum, e) => sum + e.quantity, 0);
      updatedTrade.averageEntry = totalQty > 0 ? totalValue / totalQty : 0;

      // Check if we should place take profits
      const allLevelsFilled = updatedEntries.length >= plan.grid.levels.length;
      const priceReversedAboveEntry =
        updatedEntries.length > 0 &&
        currentPrice > updatedEntries[0]!.price * 1.01; // 1% above highest filled

      // Check if TPs are already placed (by looking for TP-related orders)
      const tpOrdersExist = openOrders.some(o =>
        o.side === "SELL" && o.type === "LIMIT"
      );

      if ((allLevelsFilled || priceReversedAboveEntry) && !tpOrdersExist && totalQty > 0) {
        // Place deferred take profit orders
        await placeDeferredTakeProfits(client, trade, plan, totalQty, alerts);
      }

      // Update status
      if (allLevelsFilled) {
        updatedTrade.status = "OPEN";
      }

      updateTrade(trade.id, updatedTrade);
    }

    // Check stop loss (same as regular trades)
    if (currentPrice <= plan.stopLoss.price && updatedTrade.status !== "CLOSED") {
      const remainingQty = calculateRemainingQuantity(updatedTrade);
      if (remainingQty > 0) {
        const stopFill: ExitFill = {
          orderId: `stop_${trade.id}`,
          price: plan.stopLoss.price,
          quantity: remainingQty,
          filledAt: new Date().toISOString(),
          reason: "STOP",
        };

        updatedTrade.exits = [...updatedTrade.exits, stopFill];
        updatedTrade.status = "CLOSED";
        updatedTrade.closedAt = new Date().toISOString();

        const { realizedPnl, realizedPnlPercent } = calculateRealizedPnl(updatedTrade);
        updatedTrade.realizedPnl = realizedPnl;
        updatedTrade.realizedPnlPercent = realizedPnlPercent;

        updateTrade(trade.id, updatedTrade);

        alerts.push({
          type: "order_filled",
          tradeId: trade.id,
          message: `${trade.symbol}: Grid stop loss triggered at ${plan.stopLoss.price}`,
          severity: "critical",
          data: {
            orderType: "STOP",
            fillPrice: plan.stopLoss.price,
            realizedPnl,
            realizedPnlPercent,
          },
        });
      }
    }
  } catch (error) {
    logger.error("Error checking grid fills", error as Error, { tradeId: trade.id });
  }

  return alerts;
}

/**
 * Place take profit orders after grid entries have filled
 */
async function placeDeferredTakeProfits(
  client: BinanceClient,
  trade: Trade,
  plan: Plan,
  totalQuantity: number,
  alerts: Alert[]
): Promise<void> {
  logger.info("Placing deferred take profits for grid trade", {
    tradeId: trade.id,
    totalQuantity,
  });

  let remainingQuantity = totalQuantity;

  for (let i = 0; i < plan.takeProfit.length; i++) {
    const tp = plan.takeProfit[i];
    if (!tp) continue;

    const isLastTP = i === plan.takeProfit.length - 1;
    const tpQuantity = isLastTP
      ? remainingQuantity
      : roundQuantity(totalQuantity * tp.percentToSell);

    remainingQuantity = roundQuantity(remainingQuantity - tpQuantity);

    if (tpQuantity <= 0) continue;

    try {
      const tpOrderParams: OrderParams = {
        symbol: trade.symbol,
        side: "SELL",
        type: "LIMIT",
        quantity: tpQuantity,
        price: roundPrice(tp.price),
        timeInForce: "GTC",
        newClientOrderId: generateClientOrderId(trade.planId, `tp${i + 1}`),
      };

      const tpOrder = await client.placeOrder(tpOrderParams);

      logger.info("Deferred TP placed", {
        tradeId: trade.id,
        level: i + 1,
        orderId: tpOrder.orderId,
        price: tp.price,
      });

      logEvent({
        type: "ORDER_PLACED",
        data: {
          action: `DEFERRED_TP_${i + 1}`,
          orderId: tpOrder.orderId.toString(),
          symbol: trade.symbol,
          price: tp.price,
          quantity: tpQuantity,
        },
        tradeId: trade.id,
        planId: trade.planId,
      });

      alerts.push({
        type: "order_filled",
        tradeId: trade.id,
        message: `${trade.symbol}: Take profit ${i + 1} order placed at ${tp.price}`,
        severity: "info",
        data: {
          orderType: `TP${i + 1}_PLACED`,
          price: tp.price,
          quantity: tpQuantity,
        },
      });
    } catch (error) {
      logger.error("Failed to place deferred TP", error as Error, {
        tradeId: trade.id,
        level: i + 1,
      });
    }
  }
}
```

**Step 3: Add imports at top of file**

```typescript
import { roundQuantity, roundPrice, generateClientOrderId } from "./executor.ts";
```

Note: You may need to export these from executor.ts if they aren't already.

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (may need to fix imports/exports)

**Step 5: Commit**

```bash
git add src/core/monitor.ts src/core/executor.ts
git commit -m "$(cat <<'EOF'
feat(monitor): add grid fill tracking and deferred TP

- checkGridFills tracks which grid levels have filled
- Recalculates weighted average entry on each fill
- Places take profit orders when:
  - All grid levels filled, OR
  - Price reverses 1% above highest filled level
- Handles stop loss for accumulated position

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add Grid Tool to Agent

**Files:**
- Modify: `src/infra/agents/tools/trading.ts`

**Step 1: Add create_grid_plan tool**

Add new tool alongside existing trading tools:

```typescript
export const createGridPlanTool = createTool({
  id: "create_grid_plan",
  description: `Create a grid entry plan for a symbol. Grid entry places multiple buy orders at descending price levels across support zones.

Use grid entry when:
- Market is ranging or uncertain
- User wants to accumulate over a price range
- Multiple support levels are identified
- User says "grid", "layered entry", "spread buys"

Returns a grid plan for user approval.`,
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol, e.g., ETHUSDT"),
    allocation: z.number().optional().describe("Amount in USDT to allocate (uses default if not specified)"),
    numLevels: z.number().min(3).max(7).optional().describe("Number of grid levels (default: 5)"),
    distribution: z.enum(["pyramid", "equal"]).optional().describe("Allocation distribution (default: pyramid)"),
  }),
  execute: async ({ context, symbol, allocation, numLevels, distribution }) => {
    const binance = context.get("binance") as BinanceClient;
    const config = context.get("config") as GordonConfig;

    if (!binance) {
      return { error: "Binance client not available" };
    }

    try {
      // Analyze the symbol
      const analysis = await analyze(binance, symbol);

      // Calculate grid levels
      const gridResult = calculateGridLevels({
        supports: analysis.supports,
        currentPrice: analysis.price,
        numLevels: numLevels ?? 5,
        distribution: distribution ?? "pyramid",
        allocation: allocation ?? config.preferences.maxAllocationPerTrade * 10000, // Assume $10k portfolio default
      });

      // Calculate take profits based on resistances
      const takeProfit = analysis.resistances.slice(0, 2).map((r, i) => ({
        price: r.price,
        percentToSell: i === 0 ? 0.5 : 0.5,
      }));

      // Build plan structure
      const planPreview = {
        symbol,
        strategy: "grid_entry",
        grid: gridResult.config,
        levels: gridResult.levels,
        stopLoss: { price: gridResult.stopLossPrice },
        takeProfit,
        weightedEntryIfAllFill: gridResult.weightedEntryIfAllFill,
        allocation: {
          currency: "USDT",
          amount: allocation ?? config.preferences.maxAllocationPerTrade * 10000,
        },
      };

      return {
        success: true,
        planPreview,
        message: `Grid entry plan created for ${symbol} with ${gridResult.levels.length} levels. Awaiting user approval.`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { error: `Failed to create grid plan: ${errorMessage}` };
    }
  },
});
```

**Step 2: Add imports**

```typescript
import { calculateGridLevels } from "../../../core/grid-calculator.ts";
import { analyze } from "../../../core/analyzer.ts";
```

**Step 3: Export the new tool**

Add to the tools array export.

**Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/infra/agents/tools/trading.ts
git commit -m "$(cat <<'EOF'
feat(tools): add create_grid_plan agent tool

- Analyzes symbol for support levels
- Calculates grid using grid-calculator
- Returns plan preview for user approval

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Run Full Test Suite

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Commit any fixes**

If there were any fixes needed:

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: address test and typecheck issues

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

This implementation adds grid entry strategy to Gordon CLI:

1. **Schema** - New `GridConfigSchema` and `grid` field on Plan
2. **Calculator** - `grid-calculator.ts` with pyramid/equal distribution
3. **Validation** - Grid-specific rules in validator
4. **Planner** - Support for grid_entry in LLM planner
5. **Executor** - Multi-order placement for grid levels
6. **Monitor** - Grid fill tracking and deferred TP placement
7. **Agent Tool** - `create_grid_plan` for AI agent

Each task is independently committable and testable.
