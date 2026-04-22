import { PROTOCOL_VERSION } from "@kodexlink/protocol";
import { z } from "zod";

export const EnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  bindingId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  requiresAck: z.boolean(),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  idempotencyKey: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  payload: z.unknown()
});

export type EnvelopeInput = z.infer<typeof EnvelopeSchema>;

