export interface TinyfishRunRequest {
  url: string;
  goal: string;
  browserProfile?: string;
  proxyCountry?: string;
  allowAuthenticated?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TinyfishRunResponse {
  success: boolean;
  status?: string;
  runId?: string;
  summary?: string;
  result?: unknown;
  raw?: unknown;
  error?: string;
}

export interface TinyfishSSEEvent {
  event: string;
  data: unknown;
  raw: string;
}

export interface TinyfishMonitorRecord {
  monitorId: string;
  name?: string;
  url: string;
  goal: string;
  cronExpr: string;
  browserProfile?: string;
  proxyCountry?: string;
  allowAuthenticated: boolean;
  enabled: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: "SUCCESS" | "FAILURE";
  lastSummary?: string;
}

export interface TinyfishMonitorRunRecord {
  id: number;
  monitorId: string;
  status: "SUCCESS" | "FAILURE";
  summary?: string;
  result?: unknown;
  error?: string;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}
