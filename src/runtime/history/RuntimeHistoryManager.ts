import type { RuntimeHistoryResult, RuntimeHistorySessionSummary } from "../contracts/types.ts";
import type { RuntimePersistence } from "../persistence/RuntimePersistence.ts";

export class RuntimeHistoryManager {
  private readonly persistence: RuntimePersistence;

  constructor(persistence: RuntimePersistence) {
    this.persistence = persistence;
  }

  search(
    query: string,
    options: { limit?: number; runtimeId?: string } = {},
  ): RuntimeHistoryResult[] {
    return this.persistence.searchHistory(query, options);
  }

  listRecentSessions(limit: number = 12): RuntimeHistorySessionSummary[] {
    return this.persistence.listRecentSessions(limit);
  }
}
