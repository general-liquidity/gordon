export interface BackgroundTaskStatus {
  id: string;
  label: string;
  status: "idle" | "running" | "completed" | "failed";
  updatedAt: string;
}

export interface RuntimeBackgroundState {
  lastRefreshAt: string | null;
  tasks: BackgroundTaskStatus[];
}
