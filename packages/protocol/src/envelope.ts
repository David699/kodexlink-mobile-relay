import type { ProtocolVersion } from "./versions.js";

export interface MessageEnvelope<TType extends string = string, TPayload = unknown> {
  id: string;
  type: TType;
  bindingId?: string;
  createdAt: number;
  requiresAck: boolean;
  protocolVersion: ProtocolVersion;
  idempotencyKey?: string;
  traceId?: string;
  payload: TPayload;
}

