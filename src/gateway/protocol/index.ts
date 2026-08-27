export {
  EnvelopeMetaSchema,
  type EnvelopeMeta,
  createEnvelopeMeta,
  createCorrelationId,
  createRequestId,
} from "./envelope.ts";

export {
  GatewayCommandTypeSchema,
  GatewayCommandEnvelopeSchema,
  GatewayCommandPayloadSchema,
  type GatewayCommandType,
  type GatewayCommandEnvelope,
} from "./commands.ts";

export {
  GatewayEventTypeSchema,
  GatewayEventEnvelopeSchema,
  type GatewayEventType,
  type GatewayEventEnvelope,
} from "./events.ts";

export {
  GatewayErrorCodeSchema,
  type GatewayErrorCode,
  type GatewayError,
  createGatewayError,
} from "./errors.ts";

export { validateGatewayCommand, validateGatewayEvent } from "./schema.ts";
