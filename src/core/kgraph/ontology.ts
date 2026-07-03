/**
 * Ontology loader — maps a structured entity/edge extraction (from a document
 * producer, or derived from data the agent already computes) into a
 * FinancialGraph. Ported from gordon-rs `gordon-kgraph` ontology.rs.
 *
 * Data-structs and into-graph mapping only — never calls an external API.
 * The `buildGraphFromCorrelations` helper is the no-hardcoded-symbols path:
 * it derives Correlates / PartOf edges from a correlation matrix and a sector
 * map the caller supplies (from venue data), instead of a baked ticker list.
 */

import {
  FinancialGraph,
  type EntityType,
  type RelationshipKind,
  type EntityNode,
} from "./graph.ts";

export interface OntologyEntity {
  id: string; // Normalised ID: "NVIDIA", "FED_FUNDS_RATE"
  name: string; // Display name: "NVIDIA Corporation"
  entityType: string; // "Company" | "MacroIndicator" | …
  ticker?: string;
  sector?: string;
  country?: string;
  description: string;
}

export interface OntologyEdge {
  fromId: string;
  toId: string;
  relationship: string; // "Supplies" | "Affects" | …
  weight: number; // 0.0 to 1.0
  description: string;
  correlation?: number;
}

export interface Ontology {
  sourceDocument: string;
  entities: OntologyEntity[];
  edges: OntologyEdge[];
  extractionConfidence: number;
  summary: string;
}

/** Merge an ontology into a graph (upsert entities, then add edges). */
export function mergeOntology(ont: Ontology, graph: FinancialGraph): void {
  for (const e of ont.entities) {
    const node: EntityNode = {
      id: e.id,
      name: e.name,
      entityType: parseEntityType(e.entityType),
      ticker: e.ticker,
      sector: e.sector,
      country: e.country,
      metadata: { description: e.description, source: ont.sourceDocument },
      sentiment: 0,
      lastUpdatedMs: Date.now(),
    };
    graph.upsertEntity(node);
  }

  for (const edge of ont.edges) {
    graph.addRelationship(edge.fromId, edge.toId, {
      kind: parseRelationshipKind(edge.relationship),
      weight: edge.weight,
      correlation: edge.correlation,
      description: edge.description,
      source: ont.sourceDocument,
    });
  }
}

/**
 * Validate that every edge references an entity in the entity list.
 * Returns a list of dangling-edge warnings (empty = clean).
 */
export function validateOntology(ont: Ontology): string[] {
  const ids = new Set(ont.entities.map((e) => e.id));
  const warnings: string[] = [];
  for (const edge of ont.edges) {
    if (!ids.has(edge.fromId)) {
      warnings.push(`Edge source '${edge.fromId}' not in entity list`);
    }
    if (!ids.has(edge.toId)) {
      warnings.push(`Edge target '${edge.toId}' not in entity list`);
    }
  }
  return warnings;
}

export function parseEntityType(s: string): EntityType {
  switch (s.toLowerCase()) {
    case "company":
      return "company";
    case "person":
      return "person";
    case "sector":
      return "sector";
    case "country":
      return "country";
    case "currency":
      return "currency";
    case "commodity":
      return "commodity";
    case "index":
      return "index";
    case "macroindicator":
    case "macro_indicator":
    case "macro":
      return "macro_indicator";
    case "regulation":
    case "regulatory":
      return "regulation";
    case "event":
      return "event";
    default:
      return "company";
  }
}

export function parseRelationshipKind(s: string): RelationshipKind {
  switch (s.toLowerCase()) {
    case "supplies":
      return "supplies";
    case "suppliedby":
    case "supplied_by":
      return "supplied_by";
    case "competes":
    case "competes_with":
      return "competes";
    case "owns":
      return "owns";
    case "regulatedby":
    case "regulated_by":
      return "regulated_by";
    case "affects":
      return "affects";
    case "leadby":
    case "led_by":
    case "leaderof":
      return "led_by";
    case "partof":
    case "part_of":
      return "part_of";
    case "dependson":
    case "depends_on":
      return "depends_on";
    case "correlates":
    case "correlates_with":
      return "correlates";
    case "acquires":
      return "acquires";
    default:
      return s.toLowerCase();
  }
}

export interface CorrelationSeedInput {
  /** Entity ids in matrix order (derived from venue data, not hardcoded). */
  symbols: string[];
  /** Square correlation matrix, corr[i][j] in [-1, 1]. */
  matrix: number[][];
  /** Optional sector membership: symbol id -> sector id. */
  sectors?: Record<string, string>;
  /** Only emit correlation edges at or above this absolute threshold. */
  minAbsCorrelation?: number;
}

/**
 * Build a graph from data the agent already computes: a pairwise correlation
 * matrix and (optionally) sector membership. This is the data-derived seeding
 * path that avoids any baked symbol list — structure comes from the numbers.
 *
 * - Each symbol becomes a company entity.
 * - Each pair with |corr| >= threshold becomes a directed Correlates edge
 *   (i -> j, using the upper triangle to avoid duplicates). weight = |corr|.
 * - Each symbol with a sector becomes PartOf that sector (a sector entity).
 */
export function buildGraphFromCorrelations(
  input: CorrelationSeedInput,
): FinancialGraph {
  const g = new FinancialGraph();
  const { symbols, matrix, sectors } = input;
  const threshold = input.minAbsCorrelation ?? 0.5;

  for (const id of symbols) {
    g.upsertEntity({
      id,
      name: id,
      entityType: "company",
      metadata: {},
      sentiment: 0,
      lastUpdatedMs: Date.now(),
    });
  }

  for (let i = 0; i < symbols.length; i++) {
    const from = symbols[i];
    if (from === undefined) continue;
    for (let j = i + 1; j < symbols.length; j++) {
      const to = symbols[j];
      if (to === undefined) continue;
      const corr = matrix[i]?.[j];
      if (corr === undefined || Number.isNaN(corr)) continue;
      if (Math.abs(corr) < threshold) continue;
      g.addRelationship(from, to, {
        kind: "correlates",
        weight: Math.abs(corr),
        correlation: corr,
        description: `Empirical correlation ${corr.toFixed(2)} derived from returns`,
        source: "correlation",
      });
    }
  }

  if (sectors) {
    for (const [symbol, sectorId] of Object.entries(sectors)) {
      g.upsertEntity({
        id: sectorId,
        name: sectorId,
        entityType: "sector",
        metadata: {},
        sentiment: 0,
        lastUpdatedMs: Date.now(),
      });
      g.addRelationship(symbol, sectorId, {
        kind: "part_of",
        weight: 1.0,
        description: `Sector membership from venue classification`,
        source: "correlation",
      });
    }
  }

  return g;
}
