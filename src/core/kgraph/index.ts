/**
 * gordon-kgraph (TS) — financial entity / impact (contagion) knowledge graph.
 *
 * A `FinancialGraph` holding typed entities and signed relationships, an
 * `ImpactEngine` for DFS shock contagion, a `GraphQueryEngine` that renders
 * structured `GraphContext`, and an ontology layer that maps extracted or
 * data-derived entities + edges into the graph.
 *
 * Port of the gordon-rs `gordon-kgraph` crate (library-only there; surfaced
 * as an agent tool here — see infra/agents/tools/analytics/kgraph.ts).
 */

export {
  FinancialGraph,
  seedGraph,
  relationshipLabel,
  propagationSign,
  type EntityId,
  type EntityNode,
  type EntityType,
  type Relationship,
  type RelationshipKind,
} from "./graph.ts";

export { ImpactEngine, type ImpactScore } from "./impact.ts";

export {
  GraphQueryEngine,
  toPromptBlock,
  type GraphQuery,
  type GraphContext,
  type EntitySummary,
  type ImpactPath,
  type ImpactStep,
} from "./query.ts";

export {
  mergeOntology,
  validateOntology,
  buildGraphFromCorrelations,
  parseEntityType,
  parseRelationshipKind,
  type Ontology,
  type OntologyEntity,
  type OntologyEdge,
  type CorrelationSeedInput,
} from "./ontology.ts";
