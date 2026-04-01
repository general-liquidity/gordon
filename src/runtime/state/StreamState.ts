export interface RuntimeStreamState {
  status: "idle" | "running" | "completed" | "failed";
  activeAgent?: string;
  lastEventType?: string;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
}
