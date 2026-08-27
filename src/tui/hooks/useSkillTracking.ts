import { useState, useCallback } from "react";

// Skill improvement tracking — which trading skills are effective
// Tracks: usage count, success rate, avg duration, user satisfaction

export interface SkillMetric {
  skillName: string;
  usageCount: number;
  successCount: number;
  avgDurationMs: number;
  lastUsed: number;
}

export function useSkillTracking() {
  const [metrics, setMetrics] = useState<Map<string, SkillMetric>>(new Map());

  const recordUsage = useCallback((skillName: string, success: boolean, durationMs: number) => {
    setMetrics((prev) => {
      const updated = new Map(prev);
      const existing = updated.get(skillName) ?? {
        skillName,
        usageCount: 0,
        successCount: 0,
        avgDurationMs: 0,
        lastUsed: 0,
      };
      const newCount = existing.usageCount + 1;
      updated.set(skillName, {
        skillName,
        usageCount: newCount,
        successCount: existing.successCount + (success ? 1 : 0),
        avgDurationMs: (existing.avgDurationMs * existing.usageCount + durationMs) / newCount,
        lastUsed: Date.now(),
      });
      return updated;
    });
  }, []);

  const getTopSkills = useCallback(
    (n: number = 5): SkillMetric[] => {
      return [...metrics.values()].sort((a, b) => b.usageCount - a.usageCount).slice(0, n);
    },
    [metrics],
  );

  const getSuccessRate = useCallback(
    (skillName: string): number => {
      const m = metrics.get(skillName);
      if (!m || m.usageCount === 0) return 0;
      return m.successCount / m.usageCount;
    },
    [metrics],
  );

  return { recordUsage, getTopSkills, getSuccessRate, metrics };
}
