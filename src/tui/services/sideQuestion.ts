// ============================================================================
// Side Question — Mid-analysis clarification without breaking main flow
//
// Ask clarifying questions during analysis without losing context.
// "Which timeframe for this analysis?" -> user responds -> analysis continues
// ============================================================================

export interface SideQuestion {
  id: string;
  question: string;
  options?: string[]; // numbered options, or free-text if empty
  context: string; // what the agent was doing when it needed to ask
  answer?: string;
  answeredAt?: number;
}

let idCounter = 0;

export class SideQuestionManager {
  private pending: Map<string, SideQuestion> = new Map();
  private answered: SideQuestion[] = [];

  ask(question: string, options?: string[], context?: string): SideQuestion {
    const id = `sq_${++idCounter}_${Date.now()}`;
    const sq: SideQuestion = {
      id,
      question,
      options: options && options.length > 0 ? options : undefined,
      context: context ?? "",
    };
    this.pending.set(id, sq);
    return sq;
  }

  answer(id: string, response: string): SideQuestion {
    const sq = this.pending.get(id);
    if (!sq) throw new Error(`No pending question with id ${id}`);
    sq.answer = response;
    sq.answeredAt = Date.now();
    this.pending.delete(id);
    this.answered.push(sq);
    return sq;
  }

  getPending(): SideQuestion[] {
    return [...this.pending.values()];
  }

  getAnswered(): SideQuestion[] {
    return [...this.answered];
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  dismiss(id: string): void {
    this.pending.delete(id);
  }
}

let instance: SideQuestionManager | null = null;

export function getSideQuestionManager(): SideQuestionManager {
  if (!instance) instance = new SideQuestionManager();
  return instance;
}
