import { z } from "zod";
import { GatewayCommandEnvelopeSchema, type GatewayCommandEnvelope } from "./commands.ts";
import { GatewayEventEnvelopeSchema, type GatewayEventEnvelope } from "./events.ts";
import { createGatewayError, type GatewayError } from "./errors.ts";

export function validateGatewayCommand(input: unknown):
  | {
      ok: true;
      value: GatewayCommandEnvelope;
    }
  | {
      ok: false;
      error: GatewayError;
    } {
  const parsed = GatewayCommandEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: createGatewayError("VALIDATION_ERROR", "Gateway command validation failed.", {
        issues: z.treeifyError(parsed.error),
      }),
    };
  }

  return { ok: true, value: parsed.data };
}

export function validateGatewayEvent(input: unknown):
  | {
      ok: true;
      value: GatewayEventEnvelope;
    }
  | {
      ok: false;
      error: GatewayError;
    } {
  const parsed = GatewayEventEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: createGatewayError("VALIDATION_ERROR", "Gateway event validation failed.", {
        issues: z.treeifyError(parsed.error),
      }),
    };
  }

  return { ok: true, value: parsed.data };
}
