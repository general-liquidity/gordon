/**
 * graph_impact — knowledge-graph shock contagion (GraphRAG, Ch14).
 *
 * Surfaces the `core/kgraph` FinancialGraph + ImpactEngine as an agent tool:
 * given a shock at a source entity (an issuer, macro factor, commodity, …),
 * DFS-propagate it across typed relationships (supplies / affects / correlates
 * / part-of) and return the ranked impact path to correlated names — the
 * "connect companies to market events" financial-analysis use case.
 *
 * Graph structure is either the builtin structural seed (well-known supply
 * chains + macro transmission) or derived from data the agent supplies (a
 * correlation matrix + sector map) or an extracted ontology — no baked
 * tradeable-symbol universe.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  FinancialGraph,
  seedGraph,
  ImpactEngine,
  GraphQueryEngine,
  toPromptBlock,
  mergeOntology,
  buildGraphFromCorrelations,
  type EntityNode,
} from "../../../../core/kgraph/index.ts";

const ontologyEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  entityType: z.string(),
  ticker: z.string().optional(),
  sector: z.string().optional(),
  country: z.string().optional(),
  description: z.string().default(""),
});

const ontologyEdgeSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  relationship: z.string(),
  weight: z.number().min(0).max(1),
  description: z.string().default(""),
  correlation: z.number().min(-1).max(1).optional(),
});

const correlationsSchema = z.object({
  symbols: z.array(z.string()),
  matrix: z.array(z.array(z.number())),
  sectors: z.record(z.string(), z.string()).optional(),
  minAbsCorrelation: z.number().min(0).max(1).optional(),
});

export const graphImpactTool = createTool({
  id: "graph_impact",
  description: [
    "Knowledge-graph shock contagion (GraphRAG). Given a shock at a source",
    "entity — a company, sector, macro factor (FED_FUNDS_RATE), commodity",
    "(OIL_WTI), or index — propagate it across typed relationships and return",
    "the ranked impact path to correlated / dependent / downstream names, each",
    "with a signed magnitude (bullish/bearish), confidence, and the route taken.",
    "",
    "Use to reason about second-order effects: 'if oil jumps 20%, what gets hit?'",
    "or 'a Fed hike propagates to which sectors?'. Answers span multiple entities",
    "the way a single price feed cannot.",
    "",
    "Graph sources (combine freely): 'seed' = builtin structural graph (supply",
    "chains, macro→market transmission, sector membership). 'correlations' =",
    "derive Correlates/PartOf edges from a correlation matrix + sector map you",
    "already computed. 'ontology' = merge extracted entities+edges. Provide at",
    "least one; seed is used by default.",
  ].join("\n"),
  inputSchema: z.object({
    source: z.string().describe("Entity id / symbol to shock, e.g. 'OIL_WTI', 'NVIDIA'."),
    shockMagnitude: z
      .number()
      .min(-1)
      .max(1)
      .optional()
      .describe("Signed shock in [-1,1] (e.g. +0.2 = up 20%). Default +0.1."),
    maxHops: z.number().int().min(1).max(6).optional().describe("Propagation depth. Default 3."),
    topN: z.number().int().min(1).max(50).optional().describe("Max ranked impacts to return. Default 15."),
    useSeed: z.boolean().optional().describe("Include the builtin structural seed graph. Default true."),
    correlations: correlationsSchema
      .optional()
      .describe("Data-derived edges from a correlation matrix + optional sector map."),
    ontology: z
      .object({
        sourceDocument: z.string().default("agent"),
        entities: z.array(ontologyEntitySchema),
        edges: z.array(ontologyEdgeSchema),
      })
      .optional()
      .describe("Extracted entities + edges to merge into the graph."),
  }),
  outputSchema: z.object({
    source: z.string(),
    shockMagnitude: z.number(),
    graphStats: z.object({ entities: z.number(), relationships: z.number() }),
    impacts: z.array(
      z.object({
        target: z.string(),
        name: z.string(),
        score: z.number(),
        direction: z.enum(["bullish", "bearish", "neutral"]),
        confidence: z.number(),
        path: z.array(z.string()),
        explanation: z.string(),
      }),
    ),
    context: z.string().describe("Prompt-ready knowledge-graph context block for the source."),
    note: z.string().optional(),
  }),
  execute: async (args: {
    source: string;
    shockMagnitude?: number;
    maxHops?: number;
    topN?: number;
    useSeed?: boolean;
    correlations?: {
      symbols: string[];
      matrix: number[][];
      sectors?: Record<string, string>;
      minAbsCorrelation?: number;
    };
    ontology?: {
      sourceDocument: string;
      entities: Array<{
        id: string;
        name: string;
        entityType: string;
        ticker?: string;
        sector?: string;
        country?: string;
        description: string;
      }>;
      edges: Array<{
        fromId: string;
        toId: string;
        relationship: string;
        weight: number;
        description: string;
        correlation?: number;
      }>;
    };
  }) => {
    const shock = args.shockMagnitude ?? 0.1;
    const maxHops = args.maxHops ?? 3;
    const topN = args.topN ?? 15;
    const useSeed = args.useSeed ?? true;

    // Assemble the graph from the requested sources.
    let graph: FinancialGraph;
    if (useSeed) {
      graph = seedGraph();
    } else if (args.correlations) {
      graph = buildGraphFromCorrelations(args.correlations);
    } else {
      graph = new FinancialGraph();
    }

    if (useSeed && args.correlations) {
      // Merge data-derived edges on top of the seed graph.
      const derived = buildGraphFromCorrelations(args.correlations);
      const dump = derived.toJSON();
      for (const node of dump.nodes) graph.upsertEntity(node as EntityNode);
      for (const edge of dump.edges) {
        graph.addRelationship(edge.from, edge.to, edge.relationship);
      }
    }

    if (args.ontology) {
      mergeOntology(
        {
          sourceDocument: args.ontology.sourceDocument,
          entities: args.ontology.entities,
          edges: args.ontology.edges,
          extractionConfidence: 1,
          summary: "",
        },
        graph,
      );
    }

    const engine = new ImpactEngine(graph);
    const scores = engine.propagateShock(args.source, shock, maxHops).slice(0, topN);

    const queryEngine = new GraphQueryEngine(graph);
    const context = toPromptBlock(
      queryEngine.execute({ type: "full_context_for_symbol", symbol: args.source }),
    );

    const impacts = scores.map((s) => ({
      target: s.targetId,
      name: s.targetName,
      score: s.score,
      direction:
        s.score > 0.01 ? ("bullish" as const) : s.score < -0.01 ? ("bearish" as const) : ("neutral" as const),
      confidence: s.confidence,
      path: s.path.steps.map((st) => `${st.from} -[${st.relationship}]-> ${st.to}`),
      explanation: s.explanation,
    }));

    const note = graph.getEntity(args.source)
      ? scores.length === 0
        ? `'${args.source}' has no outgoing relationships in the assembled graph — no contagion path.`
        : undefined
      : `'${args.source}' is not in the assembled graph. Seed ids are uppercase (e.g. OIL_WTI, NVIDIA, FED_FUNDS_RATE), or supply your own via 'correlations'/'ontology'.`;

    return {
      source: args.source,
      shockMagnitude: shock,
      graphStats: { entities: graph.entityCount(), relationships: graph.relationshipCount() },
      impacts,
      context,
      note,
    };
  },
});

export const kgraphTools = {
  graph_impact: graphImpactTool,
};
