/**
 * GraphQueryEngine — renders structured, prompt-ready `GraphContext` from the
 * FinancialGraph. Ported from gordon-rs `gordon-kgraph` query.rs.
 *
 * The queries answer the Ch14 GraphRAG questions: what does X affect, what
 * drives X, what correlates with X, what's the supply chain, which sectors
 * are exposed to a risk factor, and a full context block for a symbol suitable
 * for injection into an analyst system prompt.
 */

import {
  FinancialGraph,
  relationshipLabel,
  type EntityNode,
  type EntityId,
} from "./graph.ts";

export type GraphQuery =
  | { type: "what_does_affect"; entityId: EntityId; maxHops: number }
  | { type: "key_dependencies"; entityId: EntityId }
  | { type: "correlations"; entityId: EntityId; minWeight: number }
  | { type: "supply_chain"; downstreamId: EntityId }
  | { type: "sector_exposure"; riskFactorId: EntityId }
  | { type: "entity_summary"; entityId: EntityId }
  | { type: "full_context_for_symbol"; symbol: EntityId };

export interface EntitySummary {
  id: string;
  name: string;
  entityType: string;
  keyRelationships: string[];
}

/** The result of a graph query, structured for LLM prompt injection. */
export interface GraphContext {
  queryDescription: string;
  /** Plain-English facts derived from the graph. */
  facts: string[];
  /** Entities involved. */
  entities: EntitySummary[];
  /** Narrative paragraph for direct system prompt injection. */
  narrative: string;
}

export interface ImpactStep {
  from: string;
  to: string;
  relationship: string;
  weight: number;
}

/** A path through the graph showing how event A impacts entity B. */
export interface ImpactPath {
  steps: ImpactStep[];
  totalWeight: number;
  direction: number; // positive = bullish, negative = bearish
}

export class GraphQueryEngine {
  constructor(private graph: FinancialGraph) {}

  execute(query: GraphQuery): GraphContext {
    switch (query.type) {
      case "what_does_affect":
        return this.whatDoesAffect(query.entityId, query.maxHops);
      case "key_dependencies":
        return this.keyDependencies(query.entityId);
      case "correlations":
        return this.correlations(query.entityId, query.minWeight);
      case "supply_chain":
        return this.supplyChain(query.downstreamId);
      case "sector_exposure":
        return this.sectorExposure(query.riskFactorId);
      case "entity_summary":
        return this.entitySummary(query.entityId);
      case "full_context_for_symbol":
        return this.fullContextForSymbol(query.symbol);
    }
  }

  private whatDoesAffect(entityId: EntityId, maxHops: number): GraphContext {
    const affected = this.graph.affectedBy(entityId);
    const entityName = this.entityName(entityId);
    const facts: string[] = [];
    const entities: EntitySummary[] = [];

    for (const [target, rel] of affected) {
      const direction =
        (rel.correlation ?? 0) < 0 ? "negatively" : "positively";
      facts.push(
        `${entityName} ${relationshipLabel(rel.kind)} ${target.name} (${direction}) - weight: ${rel.weight.toFixed(
          2,
        )}`,
      );
      if (rel.correlation !== undefined) {
        facts.push(`  Historical correlation: ${rel.correlation.toFixed(2)}`);
      }
      facts.push(`  Detail: ${rel.description}`);
      entities.push(this.summariseEntity(target));
    }

    // Transitive effects (2nd hop).
    if (maxHops >= 2) {
      for (const [first] of affected) {
        for (const [second, rel2] of this.graph.affectedBy(first.id)) {
          if (second.id !== entityId) {
            facts.push(
              `  Indirect: ${entityName} -> ${first.name} -> ${second.name} (${relationshipLabel(
                rel2.kind,
              )})`,
            );
          }
        }
      }
    }

    const narrative =
      affected.length === 0
        ? `Knowledge graph analysis: ${entityName} directly affects 0 entities. No downstream relationships found in the graph.`
        : `Knowledge graph analysis: ${entityName} directly affects ${affected.length} entities. Primary impacts: ${affected
            .slice(0, 3)
            .map(([e, r]) => `${e.name} (${relationshipLabel(r.kind)})`)
            .join(", ")}.`;

    return {
      queryDescription: `What does ${entityName} affect?`,
      facts,
      entities,
      narrative,
    };
  }

  private keyDependencies(entityId: EntityId): GraphContext {
    const drivers = this.graph.driversOf(entityId);
    const entityName = this.entityName(entityId);
    const facts: string[] = [];

    for (const [driver, rel] of drivers) {
      facts.push(
        `${driver.name} ${relationshipLabel(rel.kind)} ${entityName} (weight: ${rel.weight.toFixed(
          2,
        )}): ${rel.description}`,
      );
    }

    // Also look at DependsOn edges outgoing.
    for (const [dep, rel] of this.graph
      .affectedBy(entityId)
      .filter(([, r]) => r.kind === "depends_on")) {
      facts.push(`${entityName} depends on ${dep.name} - ${rel.description}`);
    }

    const narrative = `${entityName} has ${drivers.length} incoming dependencies. ${
      facts[0] ?? ""
    }`;

    return {
      queryDescription: `Key dependencies of ${entityName}`,
      facts,
      entities: drivers.map(([e]) => this.summariseEntity(e)),
      narrative,
    };
  }

  private correlations(entityId: EntityId, minWeight: number): GraphContext {
    const entityName = this.entityName(entityId);
    const correlated = [
      ...this.graph.affectedBy(entityId),
      ...this.graph.driversOf(entityId),
    ].filter(([, r]) => r.kind === "correlates" && r.weight >= minWeight);

    const facts = correlated.map(([e, r]) => {
      const corr =
        r.correlation !== undefined ? `, r=${r.correlation.toFixed(2)}` : "";
      return `${entityName} <-> ${e.name} (weight: ${r.weight.toFixed(2)}${corr}): ${r.description}`;
    });

    return {
      queryDescription: `Correlations with ${entityName}`,
      facts,
      entities: correlated.map(([e]) => this.summariseEntity(e)),
      narrative: `${entityName} shows notable correlations with ${correlated.length} assets in the knowledge graph.`,
    };
  }

  private supplyChain(downstreamId: EntityId): GraphContext {
    const entityName = this.entityName(downstreamId);
    const suppliers = this.graph
      .driversOf(downstreamId)
      .filter(([, r]) => r.kind === "supplies" || r.kind === "supplied_by");

    const facts = suppliers.map(
      ([e, r]) =>
        `${e.name} -> ${entityName} (weight: ${r.weight.toFixed(2)}): ${r.description}`,
    );

    const narrative = `${entityName} has ${suppliers.length} known suppliers in the graph. ${
      facts[0] ?? "No supply chain data available."
    }`;

    return {
      queryDescription: `Supply chain for ${entityName}`,
      facts,
      entities: suppliers.map(([e]) => this.summariseEntity(e)),
      narrative,
    };
  }

  private sectorExposure(riskFactorId: EntityId): GraphContext {
    const factorName = this.entityName(riskFactorId);
    const directlyAffected = this.graph.affectedBy(riskFactorId);
    const facts: string[] = [];

    for (const [target, rel] of directlyAffected) {
      if (target.entityType === "sector") {
        const dir = rel.correlation ?? 0;
        const impact = dir < -0.3 ? "bearish" : dir > 0.3 ? "bullish" : "mixed";
        facts.push(
          `${factorName} is ${impact} for ${target.name} sector (correlation: ${dir.toFixed(
            2,
          )}): ${rel.description}`,
        );
      }
    }

    return {
      queryDescription: `Sector exposure to ${factorName}`,
      facts,
      entities: directlyAffected.map(([e]) => this.summariseEntity(e)),
      narrative:
        facts.length === 0
          ? `No sector-level relationships found for ${factorName} in the graph.`
          : facts.join(" | "),
    };
  }

  private entitySummary(entityId: EntityId): GraphContext {
    const entity = this.graph.getEntity(entityId);
    if (!entity) {
      return {
        queryDescription: `Summary of ${entityId}`,
        facts: [`Entity '${entityId}' not found in knowledge graph`],
        entities: [],
        narrative: `No data available for '${entityId}'`,
      };
    }

    const outgoing = this.graph.affectedBy(entityId);
    const incoming = this.graph.driversOf(entityId);
    const facts: string[] = [];

    if (entity.sector) facts.push(`Sector: ${entity.sector}`);
    if (entity.ticker) facts.push(`Ticker: ${entity.ticker}`);
    if (entity.country) facts.push(`Country: ${entity.country}`);
    if (entity.metadata.description) {
      facts.push(`Description: ${entity.metadata.description}`);
    }
    for (const [target, rel] of outgoing) {
      facts.push(`${entity.name} -> ${target.name} (${relationshipLabel(rel.kind)})`);
    }
    for (const [source, rel] of incoming) {
      facts.push(`${source.name} -> ${entity.name} (${relationshipLabel(rel.kind)})`);
    }

    const connected = [
      ...outgoing.slice(0, 3).map(([e]) => e.name),
      ...incoming.slice(0, 2).map(([e]) => e.name),
    ].join(", ");

    return {
      queryDescription: `Full summary of ${entity.name}`,
      facts,
      entities: [this.summariseEntity(entity)],
      narrative: `${entity.name} (${entity.entityType}) has ${outgoing.length} outgoing relationships and ${incoming.length} incoming. It is connected to: ${connected}.`,
    };
  }

  /**
   * Build a comprehensive context block for a trading symbol — supply chain,
   * drivers, downstream effects, correlations. This is what gets injected into
   * an analyst's system prompt.
   */
  fullContextForSymbol(symbol: EntityId): GraphContext {
    const allFacts: string[] = [];
    const allEntities: EntitySummary[] = [];

    const supply = this.supplyChain(symbol);
    allFacts.push(...supply.facts);
    allEntities.push(...supply.entities);

    const deps = this.keyDependencies(symbol);
    allFacts.push(...deps.facts);

    const affects = this.whatDoesAffect(symbol, 1);
    allFacts.push(...affects.facts);

    const corr = this.correlations(symbol, 0.5);
    allFacts.push(...corr.facts);

    const dedup = dedupConsecutive(allFacts);

    return {
      queryDescription: `Full knowledge graph context for ${symbol}`,
      facts: dedup,
      entities: allEntities,
      narrative: `Knowledge graph context for ${symbol}: ${dedup
        .slice(0, 5)
        .join(". ")}`,
    };
  }

  private entityName(id: EntityId): string {
    return this.graph.getEntity(id)?.name ?? id;
  }

  private summariseEntity(entity: EntityNode): EntitySummary {
    const keyRels = this.graph
      .affectedBy(entity.id)
      .slice(0, 3)
      .map(([e, r]) => `${relationshipLabel(r.kind)} ${e.name}`);
    return {
      id: entity.id,
      name: entity.name,
      entityType: entity.entityType,
      keyRelationships: keyRels,
    };
  }
}

/** Format a GraphContext as a concise system prompt block. */
export function toPromptBlock(ctx: GraphContext): string {
  const factsBlock = ctx.facts
    .slice(0, 10)
    .map((f) => `- ${f}`)
    .join("\n");
  return `[KNOWLEDGE GRAPH: ${ctx.queryDescription}]\n${factsBlock}\n\nNarrative: ${ctx.narrative}`;
}

/** Drop consecutive duplicate strings (mirrors Rust `Vec::dedup`). */
function dedupConsecutive(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (out.length === 0 || out[out.length - 1] !== item) out.push(item);
  }
  return out;
}
