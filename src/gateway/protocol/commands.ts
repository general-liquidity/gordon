import { z } from "zod";
import { EnvelopeMetaSchema } from "./envelope.ts";

export const GatewayCommandTypeSchema = z.enum([
  "chat.send_message",
  "scan.run",
  "monitor.run_cycle",
  "system.arm",
  "system.disarm",
  "scheduler.create_task",
  "scheduler.delete_task",
  "scheduler.list_tasks",
  "runtime.health_check",
  "reconcile.run",
  "plugin.reload",
  "daemon.shutdown",
  "circuit_breaker.evaluate",
  "regime.check",
  "evolution.tick",
  "learning.analyze_trade",
  "execution.start_intent",
]);

export type GatewayCommandType = z.infer<typeof GatewayCommandTypeSchema>;

export const ChatSendMessagePayloadSchema = z.object({
  text: z.string().min(1),
  threadId: z.string().optional(),
  resourceId: z.string().optional(),
});

export const ScanRunPayloadSchema = z.object({
  topN: z.number().int().min(1).max(500).default(50),
  timeframes: z.array(z.string()).min(1).max(8).default(["1h", "4h"]),
});

export const MonitorRunCyclePayloadSchema = z.object({
  includeAlerts: z.boolean().default(true),
});

export const SystemArmPayloadSchema = z.object({
  durationHours: z.number().min(0.25).max(24).default(1),
  reason: z.string().max(512).optional(),
});

export const SystemDisarmPayloadSchema = z.object({
  reason: z.string().max(512).optional(),
});

export const SchedulerCreateTaskPayloadSchema = z.object({
  taskId: z.string().min(3).max(96),
  cron: z.string().min(5).max(128),
  commandType: GatewayCommandTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export const SchedulerDeleteTaskPayloadSchema = z.object({
  taskId: z.string().min(3).max(96),
});

export const SchedulerListTasksPayloadSchema = z.object({});

export const RuntimeHealthCheckPayloadSchema = z.object({
  aggressive: z.boolean().default(false),
});

export const ReconcileRunPayloadSchema = z.object({
  force: z.boolean().default(false),
});

export const PluginReloadPayloadSchema = z.object({
  pluginId: z.string().optional(),
});

export const DaemonShutdownPayloadSchema = z.object({
  reason: z.string().max(256).optional(),
});

export const CircuitBreakerEvaluatePayloadSchema = z.object({
  force: z.boolean().default(false),
});

export const RegimeCheckPayloadSchema = z.object({});

export const EvolutionTickPayloadSchema = z.object({
  force: z.boolean().default(false),
});

export const LearningAnalyzeTradePayloadSchema = z.object({
  tradeId: z.string().min(1),
});

export const ExecutionStartIntentPayloadSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  totalQuantity: z.number().positive(),
  algorithm: z.enum(["TWAP", "VWAP", "ICEBERG"]),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const GatewayCommandPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat.send_message"), payload: ChatSendMessagePayloadSchema }),
  z.object({ type: z.literal("scan.run"), payload: ScanRunPayloadSchema }),
  z.object({ type: z.literal("monitor.run_cycle"), payload: MonitorRunCyclePayloadSchema }),
  z.object({ type: z.literal("system.arm"), payload: SystemArmPayloadSchema }),
  z.object({ type: z.literal("system.disarm"), payload: SystemDisarmPayloadSchema }),
  z.object({ type: z.literal("scheduler.create_task"), payload: SchedulerCreateTaskPayloadSchema }),
  z.object({ type: z.literal("scheduler.delete_task"), payload: SchedulerDeleteTaskPayloadSchema }),
  z.object({ type: z.literal("scheduler.list_tasks"), payload: SchedulerListTasksPayloadSchema }),
  z.object({ type: z.literal("runtime.health_check"), payload: RuntimeHealthCheckPayloadSchema }),
  z.object({ type: z.literal("reconcile.run"), payload: ReconcileRunPayloadSchema }),
  z.object({ type: z.literal("plugin.reload"), payload: PluginReloadPayloadSchema }),
  z.object({ type: z.literal("daemon.shutdown"), payload: DaemonShutdownPayloadSchema }),
  z.object({ type: z.literal("circuit_breaker.evaluate"), payload: CircuitBreakerEvaluatePayloadSchema }),
  z.object({ type: z.literal("regime.check"), payload: RegimeCheckPayloadSchema }),
  z.object({ type: z.literal("evolution.tick"), payload: EvolutionTickPayloadSchema }),
  z.object({ type: z.literal("learning.analyze_trade"), payload: LearningAnalyzeTradePayloadSchema }),
  z.object({ type: z.literal("execution.start_intent"), payload: ExecutionStartIntentPayloadSchema }),
]);

export const GatewayCommandEnvelopeSchema = z.object({
  meta: EnvelopeMetaSchema,
  command: GatewayCommandPayloadSchema,
});

export type GatewayCommandEnvelope = z.infer<typeof GatewayCommandEnvelopeSchema>;

