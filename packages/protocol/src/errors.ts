export const ERROR_CODES = {
  unauthorized: "UNAUTHORIZED",
  authFailed: "AUTH_FAILED",
  deviceAlreadyInitialized: "DEVICE_ALREADY_INITIALIZED",
  forbidden: "FORBIDDEN",
  invalidPayload: "INVALID_PAYLOAD",
  unsupportedVersion: "UNSUPPORTED_VERSION",
  bindingNotFound: "BINDING_NOT_FOUND",
  bindingDisabled: "BINDING_DISABLED",
  agentOffline: "AGENT_OFFLINE",
  controlNotHeld: "CONTROL_NOT_HELD",
  tokenExpired: "TOKEN_EXPIRED",
  tokenRevoked: "TOKEN_REVOKED",
  idempotencyConflict: "IDEMPOTENCY_CONFLICT",
  internalError: "INTERNAL_ERROR"
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
