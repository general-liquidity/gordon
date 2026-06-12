import type { Key } from "../ink-custom";

export interface FocusOwner {
  id: string;
  priority: number;
  handler: (input: string, key: Key) => boolean | void;
  isActive?: () => boolean;
}

interface RegisteredOwner extends FocusOwner {
  order: number;
}

export const FOCUS_PRIORITY = {
  GLOBAL_GUARD: 400,
  DIALOG: 300,
  OVERLAY: 200,
  CHAT: 100,
} as const;

export class FocusStack {
  private owners = new Map<string, RegisteredOwner>();
  private nextOrder = 0;

  register(owner: FocusOwner): () => void {
    const registered = { ...owner, order: ++this.nextOrder };
    this.owners.set(owner.id, registered);
    return () => {
      const current = this.owners.get(owner.id);
      if (current?.order === registered.order) this.owners.delete(owner.id);
    };
  }

  resolve(): FocusOwner[] {
    return [...this.owners.values()]
      .filter((owner) => owner.isActive?.() ?? true)
      .sort((a, b) => b.priority - a.priority || b.order - a.order);
  }

  dispatch(input: string, key: Key): string | null {
    for (const owner of this.resolve()) {
      const consumed = owner.handler(input, key);
      if (consumed !== false) return owner.id;
    }
    return null;
  }
}
