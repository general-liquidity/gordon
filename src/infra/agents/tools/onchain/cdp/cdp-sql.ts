/**
 * CDP SQL API Tools
 *
 * Custom SQL queries against CDP's indexed Base chain data. <250ms freshness
 * from chain tip, <500ms query latency. Free tier: 1000 queries/month,
 * $0.0083/query after. Rate limit: 5 queries/sec/project.
 *
 * Gordon uses this for on-demand on-chain analytics queries that can't be
 * cheaply built from DexScreener or Basescan alone — whale accumulation
 * tracking, holder distribution, custom flow analysis.
 *
 * Endpoint: POST /platform/v2/data/query/run
 *   body: { sql: string }
 *   response: { result: { schema: [{ name, type }], data: [[...], ...] } }
 *
 * Budget hint: each tool response includes a `usedFreeQuota` flag so the agent
 * can self-pace. Gordon does NOT enforce a local quota — CDP rate-limits at
 * the project level.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { cdpRequest, isCdpConfigured, CDP_NOT_CONFIGURED_MSG } from "../../../../data/providers/cdp/cdpRest.ts";

interface CdpSqlResponse {
  result?: {
    schema?: Array<{ name: string; type: string }>;
    data?: unknown[][];
  };
  // Some responses use a flattened shape
  schema?: Array<{ name: string; type: string }>;
  data?: unknown[][];
}

async function runBaseSql(sql: string): Promise<
  | { ok: true; columns: string[]; rows: Record<string, unknown>[]; rowCount: number }
  | { ok: false; error: string }
> {
  const res = await cdpRequest<CdpSqlResponse>("/platform/v2/data/query/run", {
    method: "POST",
    body: { sql },
    timeoutMs: 60_000,
  });
  if (!res.ok || !res.data) {
    return { ok: false, error: res.error ?? "SQL query failed" };
  }

  const schema = res.data.result?.schema ?? res.data.schema ?? [];
  const data = res.data.result?.data ?? res.data.data ?? [];
  const columns = schema.map((c) => c.name);
  const rows = data.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]!] = row[i];
    }
    return obj;
  });
  return { ok: true, columns, rows, rowCount: rows.length };
}

// ============================================================================
// 1. query_base_sql — arbitrary passthrough
// ============================================================================

export const queryBaseSqlTool = createTool({
  id: "query_base_sql",
  description:
    "Run an arbitrary SQL query against CDP's indexed Base chain data. Use for " +
    "custom analytics: whale accumulation tracking, holder distribution, " +
    "historical flow analysis, liquidity migration. Response latency <500ms. " +
    "USES THE USER'S CDP FREE TIER QUOTA (1000 queries/month). Prefer compact, " +
    "selective queries over broad scans. Call describe_base_sql_schema first " +
    "if you need to understand the available tables and columns. CDP rate-limits " +
    "to 5 queries/sec project-wide.",
  inputSchema: z.object({
    sql: z
      .string()
      .min(10)
      .describe(
        "SQL query string. Should target Base chain tables such as " +
        "`base.transactions`, `base.events`, `base.erc20_transfers`, `base.blocks`.",
      ),
    purpose: z
      .string()
      .optional()
      .describe("Short explanation of what this query is checking. For audit logs."),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    success: z.boolean(),
    rowCount: z.number().optional(),
    columns: z.array(z.string()).optional(),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ sql }) => {
    if (!isCdpConfigured()) {
      return { configured: false, success: false, error: CDP_NOT_CONFIGURED_MSG };
    }
    const result = await runBaseSql(sql);
    if (!result.ok) {
      return { configured: true, success: false, error: result.error };
    }
    const capped = result.rows.slice(0, 200);
    return {
      configured: true,
      success: true,
      rowCount: result.rowCount,
      columns: result.columns,
      rows: capped,
    };
  },
});

// ============================================================================
// 2. get_base_top_holders — convenience wrapper
// ============================================================================

export const getBaseTopHoldersTool = createTool({
  id: "get_base_top_holders",
  description:
    "Get the top holders of an ERC20 token on Base by current balance. Useful " +
    "for pre-trade concentration checks, identifying whale wallets, or measuring " +
    "ownership distribution. Uses CDP SQL under the hood — consumes free tier " +
    "quota. Limit defaults to 25.",
  inputSchema: z.object({
    tokenAddress: z.string().describe("ERC20 contract address (0x...)."),
    limit: z.number().int().min(1).max(100).optional().default(25),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    success: z.boolean(),
    tokenAddress: z.string(),
    holderCount: z.number().optional(),
    holders: z
      .array(
        z.object({
          address: z.string(),
          balance: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ tokenAddress, limit }) => {
    if (!isCdpConfigured()) {
      return { configured: false, success: false, tokenAddress, error: CDP_NOT_CONFIGURED_MSG };
    }
    const addr = tokenAddress.toLowerCase();
    const n = Math.min(Math.max(limit ?? 25, 1), 100);
    // Real CDP SQL schema: base.transfers has token_address + from_address +
    // to_address + value. Net balance = inflows - outflows per address.
    const sql = `
      WITH net AS (
        SELECT address, SUM(delta) AS balance FROM (
          SELECT to_address AS address, CAST(value AS DECIMAL(78,0)) AS delta
          FROM base.transfers
          WHERE token_address = '${addr}'
          UNION ALL
          SELECT from_address AS address, -CAST(value AS DECIMAL(78,0)) AS delta
          FROM base.transfers
          WHERE token_address = '${addr}'
        )
        GROUP BY address
      )
      SELECT address, balance
      FROM net
      WHERE balance > 0
      ORDER BY balance DESC
      LIMIT ${n}
    `;
    const result = await runBaseSql(sql);
    if (!result.ok) {
      return { configured: true, success: false, tokenAddress, error: result.error };
    }
    const holders = result.rows.map((r) => ({
      address: String(r.address ?? ""),
      balance: String(r.balance ?? "0"),
    }));
    return {
      configured: true,
      success: true,
      tokenAddress,
      holderCount: holders.length,
      holders,
    };
  },
});

// ============================================================================
// 3. get_base_whale_accumulation — recent net accumulation
// ============================================================================

export const getBaseWhaleAccumulationTool = createTool({
  id: "get_base_whale_accumulation",
  description:
    "Identify wallets with the highest NET accumulation of a token on Base over " +
    "a recent window. Subtracts outflows from inflows per wallet and ranks by " +
    "net delta. Use to spot smart money loading up before a move. Consumes CDP " +
    "SQL free tier quota. Default window is 24 hours.",
  inputSchema: z.object({
    tokenAddress: z.string().describe("ERC20 contract address (0x...)."),
    windowHours: z.number().int().min(1).max(168).optional().default(24),
    limit: z.number().int().min(1).max(50).optional().default(20),
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    success: z.boolean(),
    tokenAddress: z.string(),
    windowHours: z.number(),
    accumulators: z
      .array(
        z.object({
          address: z.string(),
          netAccumulation: z.string(),
          inflow: z.string(),
          outflow: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ tokenAddress, windowHours, limit }) => {
    if (!isCdpConfigured()) {
      return {
        configured: false,
        success: false,
        tokenAddress,
        windowHours: windowHours ?? 24,
        error: CDP_NOT_CONFIGURED_MSG,
      };
    }
    const addr = tokenAddress.toLowerCase();
    const h = windowHours ?? 24;
    const n = Math.min(Math.max(limit ?? 20, 1), 50);
    const sql = `
      WITH flows AS (
        SELECT
          address,
          SUM(inflow) AS inflow,
          SUM(outflow) AS outflow
        FROM (
          SELECT
            to_address AS address,
            CAST(value AS DECIMAL(78,0)) AS inflow,
            0 AS outflow
          FROM base.transfers
          WHERE token_address = '${addr}'
            AND block_timestamp >= current_timestamp - INTERVAL '${h}' HOUR
          UNION ALL
          SELECT
            from_address AS address,
            0 AS inflow,
            CAST(value AS DECIMAL(78,0)) AS outflow
          FROM base.transfers
          WHERE token_address = '${addr}'
            AND block_timestamp >= current_timestamp - INTERVAL '${h}' HOUR
        )
        GROUP BY address
      )
      SELECT
        address,
        (inflow - outflow) AS net_accumulation,
        inflow,
        outflow
      FROM flows
      WHERE inflow > outflow
      ORDER BY net_accumulation DESC
      LIMIT ${n}
    `;
    const result = await runBaseSql(sql);
    if (!result.ok) {
      return {
        configured: true,
        success: false,
        tokenAddress,
        windowHours: h,
        error: result.error,
      };
    }
    return {
      configured: true,
      success: true,
      tokenAddress,
      windowHours: h,
      accumulators: result.rows.map((r) => ({
        address: String(r.address ?? ""),
        netAccumulation: String(r.net_accumulation ?? "0"),
        inflow: String(r.inflow ?? "0"),
        outflow: String(r.outflow ?? "0"),
      })),
    };
  },
});

// ============================================================================
// 4. describe_base_sql_schema — zero-API-call schema hint
// ============================================================================

export const describeBaseSqlSchemaTool = createTool({
  id: "describe_base_sql_schema",
  description:
    "Return a static description of the common Base chain tables and columns " +
    "accessible via CDP SQL API. Use before calling query_base_sql to write " +
    "correct queries without guessing. Zero-API-call, consumes no quota.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    tables: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        keyColumns: z.array(z.string()),
      }),
    ),
    notes: z.array(z.string()),
  }),
  execute: async () => ({
    tables: [
      {
        name: "base.blocks",
        description: "Block metadata including number, hash, timestamp, miner, gas.",
        keyColumns: [
          "block_number",
          "block_hash",
          "parent_hash",
          "timestamp",
          "miner",
          "gas_limit",
          "gas_used",
          "base_fee_per_gas",
          "transaction_count",
          "action",
        ],
      },
      {
        name: "base.transactions",
        description: "All Base transactions with hash, addresses, value, gas, fee fields.",
        keyColumns: [
          "transaction_hash",
          "block_number",
          "block_hash",
          "from_address",
          "to_address",
          "value",
          "gas",
          "gas_price",
          "input",
          "nonce",
          "type",
          "max_fee_per_gas",
          "max_priority_fee_per_gas",
          "timestamp",
          "action",
        ],
      },
      {
        name: "base.events",
        description:
          "Decoded event logs from Base contract calls. Parameters are a Map type so decoded values can be queried by name.",
        keyColumns: [
          "block_number",
          "block_hash",
          "timestamp",
          "transaction_hash",
          "transaction_from",
          "transaction_to",
          "log_index",
          "address",
          "topics",
          "event_name",
          "event_signature",
          "parameters",
          "parameter_types",
          "action",
        ],
      },
      {
        name: "base.encoded_logs",
        description: "Raw (encoded) log data when the decoder can't parse the event.",
        keyColumns: [
          "block_number",
          "block_hash",
          "block_timestamp",
          "transaction_hash",
          "transaction_from",
          "transaction_to",
          "log_index",
          "address",
          "topics",
          "action",
        ],
      },
      {
        name: "base.transfers",
        description:
          "Token transfer events across ERC20 and native transfers. Columns use token_address (NOT contract_address).",
        keyColumns: [
          "block_number",
          "block_timestamp",
          "transaction_hash",
          "transaction_from",
          "transaction_to",
          "log_index",
          "token_address",
          "from_address",
          "to_address",
          "value",
          "action",
        ],
      },
    ],
    notes: [
      "Always include a block_timestamp filter — unbounded scans are slow and expensive.",
      "Values are DECIMAL(78,0) — use CAST(... AS DECIMAL(78,0)) in aggregations to handle 256-bit amounts.",
      "Use INTERVAL '24' HOUR (or similar) for relative time windows.",
      "Table names are prefixed with the chain: base.transactions, base.events, base.transfers.",
      "NOTE: the token transfer table is base.transfers with column token_address — there is NO base.erc20_transfers table.",
      "NOTE: the events table uses `parameters` (a Map) for decoded event args — query like parameters['from'] for Transfer events.",
      "There is no base.traces table — for internal call tracing, query base.events with appropriate event_signature filters.",
      "The `action` column on blocks/transactions/transfers is a reorg indicator — filter WHERE action = 'added' for canonical data.",
    ],
  }),
});

// ============================================================================
// Export
// ============================================================================

export const cdpSqlTools = {
  query_base_sql: queryBaseSqlTool,
  get_base_top_holders: getBaseTopHoldersTool,
  get_base_whale_accumulation: getBaseWhaleAccumulationTool,
  describe_base_sql_schema: describeBaseSqlSchemaTool,
};
