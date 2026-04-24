// ============================================================================
// Side Question — Mid-analysis clarification without breaking main flow
//
// Ask clarifying questions during analysis without losing context.
// "Which timeframe for this analysis?" -> user responds -> analysis continues
//
// `ask()` emits `agent:elicitation_requested` and returns a Promise that
// resolves when the TUI (or any subscriber) emits a matching
// `agent:elicitation_answered` with the same `requestId`.
// ============================================================================

import { emitEvent, getEventBus } from "../../events/bus.ts";

export type SideQuestionKind = "choice" | "text" | "confirm";

export interface SideQuestion {
  id: string;
  question: string;
  options?: string[]; // numbered options, or free-text if empty
  context: string; // what the agent was doing when it needed to ask
  kind: SideQuestionKind;
  answer?: string;
  answeredAt?: number;
}

export class SideQuestionManager {
  private pending: Map<string, SideQuestion> = new Map();
  private answered: SideQuestion[] = [];
  // requestId -> resolver for the Promise returned by ask()
  private resolvers: Map<string, (answer: string) => void> = new Map();
  private busSubscribed = false;

  /**
   * Ensure a single subscription to `agent:elicitation_answered` is live
   * for this manager instance. Safe to call repeatedly.
   */
  private ensureSubscribed(): void {
    if (this.busSubscribed) return;
    this.busSubscribed = true;
    getEventBus().on("agent:elicitation_answered", (event) => {
      this.answer(event.requestId, event.answer);
    });
  }

  /**
   * Ask a question and resolve with the user's answer.
   * Emits `agent:elicitation_requested` on the event bus.
   */
  async ask(
    question: string,
    options?: string[],
    context?: string,
    kind?: SideQuestionKind,
  ): Promise<string> {
    this.ensureSubscribed();
    const id = crypto.randomUUID();
    const resolvedKind: SideQuestionKind =
      kind ?? (options && options.length > 0 ? "choice" : "text");
    const sq: SideQuestion = {
      id,
      question,
      options: options && options.length > 0 ? options : undefined,
      context: context ?? "",
      kind: resolvedKind,
    };
    this.pending.set(id, sq);

    const promise = new Promise<string>((resolve) => {
      this.resolvers.set(id, resolve);
    });

    void emitEvent("agent:elicitation_requested", {
      requestId: id,
      prompt: question,
      options: options && options.length > 0
        ? options.map((o) => ({ value: o, label: o }))
        : undefined,
      kind: resolvedKind,
    });

    return promise;
  }

  answer(id: string, response: string): SideQuestion | null {
    const sq = this.pending.get(id);
    if (!sq) return null; // already answered or unknown — no-op
    sq.answer = response;
    sq.answeredAt = Date.now();
    this.pending.delete(id);
    this.answered.push(sq);
    const resolve = this.resolvers.get(id);
    if (resolve) {
      this.resolvers.delete(id);
      resolve(response);
    }
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
    const resolve = this.resolvers.get(id);
    if (resolve) {
      this.resolvers.delete(id);
      resolve(""); // empty string signals dismissal
    }
  }
}

let instance: SideQuestionManager | null = null;

export function getSideQuestionManager(): SideQuestionManager {
  if (!instance) instance = new SideQuestionManager();
  return instance;
}

export const sideQuestionManager = {
  get instance() {
    return getSideQuestionManager();
  },
  ask: (
    question: string,
    options?: string[],
    context?: string,
    kind?: SideQuestionKind,
  ) => getSideQuestionManager().ask(question, options, context, kind),
};
