export interface ClearableInkInstance {
  clear: () => void;
}

let inkInstance: ClearableInkInstance | null = null;

export function setInkInstance(instance: ClearableInkInstance | null): void {
  inkInstance = instance;
}

export function clearInkOutput(): void {
  inkInstance?.clear();
}
