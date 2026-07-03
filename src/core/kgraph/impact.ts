/**
 * ImpactEngine — shock contagion over the FinancialGraph.
 *
 * Ported from gordon-rs `gordon-kgraph` impact.rs. Given a shock at a source
 * entity, DFS-propagate it along typed edges, attenuating per hop by edge
 * weight and flipping/scaling by the relationship's propagation sign, and
 * return every reachable entity ranked by absolute impact magnitude — the
 * Ch14 GraphRAG "financial analysis" use case (issuer → sector → correlated
 * names → market event = contagion / impact-path reasoning).
 */

import {
  FinancialGraph,
  propagationSign,
  relationshipLabel,
  type EntityId,
} from "./graph.ts";
import type { ImpactPath, ImpactStep } from "./query.ts";

export interface ImpactScore {
  targetId: EntityId;
  targetName: string;
  /** -1.0 (max bearish) to +1.0 (max bullish). */
  score: number;
  /** Confidence in the score based on path weight quality. */
  confidence: number;
  path: ImpactPath;
  explanation: string;
}

export class ImpactEngine {
  constructor(private graph: FinancialGraph) {}

  /**
   * Score the impact of a shock to `sourceId` on all reachable entities.
   * Returns sorted by absolute impact magnitude (descending).
   */
  propagateShock(
    sourceId: EntityId,
    shockMagnitude: number, // -1.0 to +1.0
    maxHops: number,
  ): ImpactScore[] {
    const results: Map<EntityId, ImpactScore> = new Map();
    const visited: Map<EntityId, number> = new Map();

    this.dfsPropagate(
      sourceId,
      sourceId,
      shockMagnitude,
      1.0,
      maxHops,
      0,
      visited,
      results,
      [],
    );

    return [...results.values()].sort(
      (a, b) => Math.abs(b.score) - Math.abs(a.score),
    );
  }

  /** Score the specific impact of source on one target, or undefined. */
  scorePair(
    sourceId: EntityId,
    targetId: EntityId,
    shockMagnitude: number,
  ): ImpactScore | undefined {
    return this.propagateShock(sourceId, shockMagnitude, 3).find(
      (s) => s.targetId === targetId,
    );
  }

  /** Human-readable impact table for an analyst prompt. */
  impactTable(
    sourceId: EntityId,
    shockMagnitude: number,
    topN: number,
  ): string {
    const scores = this.propagateShock(sourceId, shockMagnitude, 2);
    const sourceName = this.graph.getEntity(sourceId)?.name ?? sourceId;
    const dir = shockMagnitude > 0 ? "rises" : "falls";

    const lines = [
      `Impact analysis: if ${sourceName} ${dir} by ${(
        Math.abs(shockMagnitude) * 100
      ).toFixed(0)}%:`,
    ];
    for (const s of scores.slice(0, topN)) {
      const arrow = s.score > 0 ? "up" : "down";
      const tone = s.score > 0 ? "bullish" : "bearish";
      lines.push(
        `  [${arrow}] ${tone} ${(Math.abs(s.score) * 100).toFixed(0)}% impact on ${
          s.targetName
        } (confidence: ${(s.confidence * 100).toFixed(0)}%)`,
      );
    }
    return lines.join("\n");
  }

  private dfsPropagate(
    currentId: EntityId,
    originId: EntityId,
    currentScore: number,
    pathWeight: number,
    maxHops: number,
    depth: number,
    visited: Map<EntityId, number>,
    results: Map<EntityId, ImpactScore>,
    currentPath: ImpactStep[],
  ): void {
    if (depth >= maxHops) return;

    for (const [target, rel] of this.graph.affectedBy(currentId)) {
      if (target.id === originId) continue; // avoid cycles back to source

      // Score attenuation per hop. The Rust factor
      // `hop_sign.signum().max(1.0)` is always 1.0, so it collapses to a
      // plain sign-scaled attenuation.
      const hopSign = propagationSign(rel.kind);
      const hopScore = currentScore * rel.weight * hopSign;
      const hopWeight = pathWeight * rel.weight;

      // Only record if signal is above the noise threshold.
      if (Math.abs(hopScore) < 0.01) continue;

      const newPath: ImpactStep[] = [
        ...currentPath,
        {
          from: currentId,
          to: target.id,
          relationship: relationshipLabel(rel.kind),
          weight: rel.weight,
        },
      ];

      // Keep the strongest-magnitude path per target.
      const existing = visited.get(target.id) ?? 0;
      if (Math.abs(hopScore) > Math.abs(existing)) {
        visited.set(target.id, hopScore);

        const tone = hopScore > 0 ? "bullish" : "bearish";
        const explanation = `${currentId} -> ${target.id} via '${relationshipLabel(
          rel.kind,
        )}' (${rel.description}): ${(Math.abs(hopScore) * 100).toFixed(0)}% ${tone} impact`;

        results.set(target.id, {
          targetId: target.id,
          targetName: target.name,
          score: hopScore,
          confidence: hopWeight,
          path: {
            steps: newPath,
            totalWeight: hopWeight,
            direction: Math.sign(hopScore),
          },
          explanation,
        });
      }

      // Recurse regardless of whether this hop improved the target's score
      // (a deeper path may still improve a downstream node).
      this.dfsPropagate(
        target.id,
        originId,
        hopScore,
        hopWeight,
        maxHops,
        depth + 1,
        visited,
        results,
        newPath,
      );
    }
  }
}
