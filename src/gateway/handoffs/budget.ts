import { z } from "zod";

export const HandoffBudgetSchema = z.object({
  maxNotionalUsd: z.number().positive().optional(),
  maxVarUsd: z.number().positive().optional(),
  allowedSymbols: z.array(z.string().min(2)).max(128).optional(),
  maxDrawdownPercent: z.number().min(0).max(100).optional(),
  reason: z.string().max(512).optional(),
  expiresAt: z.string().datetime().optional(),
});

export type HandoffBudget = z.infer<typeof HandoffBudgetSchema>;

export interface HandoffBudgetValidationResult {
  valid: boolean;
  reason?: string;
  warnings?: string[];
  inferredNotionalUsd?: number;
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function inferNotionalUsd(toolArgs?: Record<string, unknown>): number | undefined {
  if (!toolArgs) return undefined;

  const quoteOrderQty = parseNumeric(toolArgs.quoteOrderQty);
  if (quoteOrderQty && quoteOrderQty > 0) return quoteOrderQty;

  const quantity = parseNumeric(toolArgs.quantity);
  const price = parseNumeric(toolArgs.price);
  if (quantity && price && quantity > 0 && price > 0) {
    return quantity * price;
  }

  return undefined;
}

function normalizeSymbol(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim().toUpperCase();
}

export function validateHandoffBudget(input: {
  fromAgent: string;
  toAgent: string;
  metadata?: Record<string, unknown>;
}): HandoffBudgetValidationResult {
  const warnings: string[] = [];
  const rawBudget = input.metadata?.handoffBudget;

  if (input.toAgent === "Executor" && !rawBudget) {
    return {
      valid: false,
      reason: "Handoff to Executor requires a handoffBudget payload.",
    };
  }

  if (!rawBudget) {
    return { valid: true };
  }

  const parsed = HandoffBudgetSchema.safeParse(rawBudget);
  if (!parsed.success) {
    return {
      valid: false,
      reason: `Invalid handoff budget: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  }

  const budget = parsed.data;

  if (budget.expiresAt) {
    const exp = Date.parse(budget.expiresAt);
    if (Number.isNaN(exp) || exp <= Date.now()) {
      return { valid: false, reason: "Handoff budget has expired." };
    }
  }

  const toolArgs = (input.metadata?.toolArgs ?? undefined) as Record<string, unknown> | undefined;
  const symbol = normalizeSymbol(toolArgs?.symbol);

  if (budget.allowedSymbols && budget.allowedSymbols.length > 0) {
    if (!symbol) {
      warnings.push("No symbol provided for handoff budget symbol check.");
    } else {
      const allowed = new Set(budget.allowedSymbols.map((s) => s.toUpperCase()));
      if (!allowed.has(symbol)) {
        return {
          valid: false,
          reason: `Symbol ${symbol} is outside handoff budget scope.`,
        };
      }
    }
  }

  const inferredNotionalUsd = inferNotionalUsd(toolArgs);
  if (budget.maxNotionalUsd !== undefined) {
    if (inferredNotionalUsd === undefined) {
      warnings.push("Unable to infer order notional for handoff budget check.");
    } else if (inferredNotionalUsd > budget.maxNotionalUsd) {
      return {
        valid: false,
        reason: `Order notional ${inferredNotionalUsd.toFixed(2)} exceeds budget max ${budget.maxNotionalUsd.toFixed(2)}.`,
      };
    }
  }

  if (budget.maxDrawdownPercent !== undefined) {
    const currentDrawdown = parseNumeric(input.metadata?.currentDrawdownPercent);
    if (currentDrawdown !== undefined && currentDrawdown > budget.maxDrawdownPercent) {
      return {
        valid: false,
        reason: `Current drawdown ${currentDrawdown.toFixed(2)} exceeds budget max ${budget.maxDrawdownPercent.toFixed(2)}.`,
      };
    }
  }

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined,
    inferredNotionalUsd,
  };
}
