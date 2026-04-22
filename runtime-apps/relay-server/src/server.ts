import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import { URL } from "node:url";

import WebSocket, { WebSocketServer, type RawData } from "ws";

import {
  ERROR_CODES,
  PROTOCOL_VERSION,
  type AgentDegradedReason,
  type AgentHealthReport,
  type AgentPresencePayload,
  type ControlRevokedEvent,
  type ControlTakeoverRequest,
  type ControlTakeoverResponse,
  type ApprovalResolveRequest,
  type ApprovalResolvedEvent,
  type AppMessage,
  type AuthMessage,
  type AuthOkMessage,
  type CommandOutputDeltaEvent,
  type ErrorMessage,
  type PingMessage,
  type PongMessage,
  type PresenceSyncResponse,
  type TokenRevokedEvent,
  type ThreadCreateRequest,
  type ThreadCreateResponse,
  type ThreadArchiveRequest,
  type ThreadArchiveResponse,
  type ThreadResumeRequest,
  type ThreadResumeResponse,
  type ThreadListRequest,
  type ThreadListResponse,
  type TurnInterruptedEvent,
  type TurnInterruptRequest,
  type TurnCompletedEvent,
  type TurnStartRequest,
  type TurnStatusEvent
} from "@kodexlink/protocol";
import { configureFileLogger, createId, createLogger, nowInSeconds } from "@kodexlink/shared";

import { bootstrapDevice, refreshDeviceAuth, revokeDeviceAuthTokens, validateDeviceAuth } from "./auth/index.js";
import { loadRelayServerConfig } from "./config/index.js";
import {
  DeviceAlreadyInitializedError,
  MigrationChecksumMismatchError,
  PendingMigrationsError,
  RelayStore,
  type BindingRecord
} from "./db/index.js";
import { PostgresStore } from "./db/postgres.js";
import { createPairingSession, claimPairingSession, type PairingPayload } from "./pairing/index.js";
import { resolveRouteTarget, validateMobileBinding } from "./routing/index.js";

interface SocketSession {
  deviceId: string;
  deviceType: "agent" | "mobile";
}

interface LocalClientContext {
  socket: WebSocket;
  bindingId: string;
}

interface PendingClientRoute {
  socket: WebSocket;
  mobileDeviceId: string;
  keepAlive: boolean;
}

interface AgentPresenceSnapshot {
  status: AgentPresencePayload["status"];
  reason?: AgentDegradedReason;
  detail?: string;
  consecutiveFailures?: number;
  updatedAt: number;
}

interface DeviceBindingSummary {
  bindingId: string;
  agentId: string;
  displayName: string;
  isDefault: boolean;
}

interface BootstrapResponse {
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  relayUrl: string;
  defaultBindingId?: string;
  bindings: DeviceBindingSummary[];
}

const SERVER_VERSION = "0.2.0";
const IDEMPOTENT_MOBILE_OPERATIONS = new Map<string, string>([
  ["thread_create_req", "thread_create"],
  ["thread_archive_req", "thread_archive"],
  ["turn_start_req", "turn_start"],
  ["approval_resolve_req", "approval_resolve"],
  ["turn_interrupt_req", "turn_interrupt"]
]);
const WRITE_OPERATIONS = new Set<string>([
  "thread_create_req",
  "thread_archive_req",
  "turn_start_req",
  "approval_resolve_req",
  "turn_interrupt_req"
]);

configureFileLogger({
  appName: "relay-server"
});

function normalizeArgv(argv: string[]): string[] {
  return argv.filter((value) => value !== "--");
}

function parseThreadLimit(rawValue: string | undefined): number {
  if (!rawValue) {
    return 5;
  }

  const value = Number.parseInt(rawValue, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`invalid thread limit: ${rawValue}`);
  }

  return value;
}

function formatHostForUrl(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
}

function buildHttpBaseUrl(host: string, port: number): string {
  return `http://${formatHostForUrl(host)}:${port}`;
}

function normalizeBaseUrl(input: string): string {
  const url = new URL(input);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function toWebSocketUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/v1/connect";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeWebSocketUrl(input: string): string {
  const url = new URL(input);
  url.protocol = url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = "/v1/connect";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function resolveLocalHttpBaseUrl(bindHost: string, port: number): string {
  if (bindHost === "0.0.0.0") {
    return buildHttpBaseUrl("127.0.0.1", port);
  }
  if (bindHost === "::") {
    return buildHttpBaseUrl("::1", port);
  }
  return buildHttpBaseUrl(bindHost, port);
}

function resolveRelayEndpoints(config: ReturnType<typeof loadRelayServerConfig>): {
  localHttpBaseUrl: string;
  localWebSocketUrl: string;
  publicHttpBaseUrl: string;
  publicWebSocketUrl: string;
} {
  const localHttpBaseUrl = resolveLocalHttpBaseUrl(config.bindHost, config.port);
  const publicHttpBaseUrl = normalizeBaseUrl(config.publicBaseUrl ?? localHttpBaseUrl);
  const publicWebSocketUrl = config.publicWebSocketUrl
    ? normalizeWebSocketUrl(config.publicWebSocketUrl)
    : toWebSocketUrl(publicHttpBaseUrl);

  return {
    localHttpBaseUrl,
    localWebSocketUrl: toWebSocketUrl(localHttpBaseUrl),
    publicHttpBaseUrl,
    publicWebSocketUrl
  };
}

function summarizeBindings(bindings: BindingRecord[]): DeviceBindingSummary[] {
  return bindings.map((binding) => ({
    bindingId: binding.bindingId,
    agentId: binding.agentId,
    displayName: binding.displayName,
    isDefault: binding.isDefault
  }));
}

async function buildBootstrapResponse(
  store: RelayStore,
  deviceId: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: number;
    refreshExpiresAt: number;
  },
  relayUrl: string
): Promise<BootstrapResponse> {
  const bindings = summarizeBindings(await store.getBindingsForMobileDevice(deviceId));
  const defaultBinding = bindings.find((binding) => binding.isDefault);
  return {
    deviceId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: tokens.accessExpiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
    relayUrl,
    defaultBindingId: defaultBinding?.bindingId,
    bindings
  };
}

function buildAgentPresenceMessage(
  bindingId: string,
  agentId: string,
  snapshot: Omit<AgentPresenceSnapshot, "updatedAt">
): AppMessage {
  return {
    id: createId("msg"),
    type: "agent_presence",
    bindingId,
    createdAt: nowInSeconds(),
    requiresAck: false,
    protocolVersion: PROTOCOL_VERSION,
    payload: {
      agentId,
      status: snapshot.status,
      reason: snapshot.reason,
      detail: snapshot.detail,
      consecutiveFailures: snapshot.consecutiveFailures
    }
  };
}

function buildPresenceSyncResponseMessage(
  requestId: string,
  bindingId: string,
  traceId: string | undefined,
  agentId: string,
  snapshot: AgentPresenceSnapshot
): PresenceSyncResponse {
  return {
    id: requestId,
    type: "presence_sync_res",
    bindingId,
    createdAt: nowInSeconds(),
    requiresAck: false,
    protocolVersion: PROTOCOL_VERSION,
    traceId,
    payload: {
      agentId,
      status: snapshot.status,
      reason: snapshot.reason,
      detail: snapshot.detail,
      consecutiveFailures: snapshot.consecutiveFailures,
      updatedAt: snapshot.updatedAt
    }
  };
}

function buildTokenRevokedMessage(
  code: typeof ERROR_CODES.tokenExpired | typeof ERROR_CODES.tokenRevoked,
  message: string
): TokenRevokedEvent {
  return {
    id: createId("msg"),
    type: "token_revoked",
    createdAt: nowInSeconds(),
    requiresAck: false,
    protocolVersion: PROTOCOL_VERSION,
    payload: {
      code,
      message
    }
  };
}

async function parseJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendProtocolError(
  socket: WebSocket,
  requestId: string,
  bindingId: string | undefined,
  traceId: string | undefined,
  logger: ReturnType<typeof createLogger>,
  payload: ErrorMessage["payload"]
): void {
  const message: ErrorMessage = {
    id: requestId,
    type: "error",
    bindingId,
    createdAt: nowInSeconds(),
    requiresAck: false,
    protocolVersion: PROTOCOL_VERSION,
    traceId,
    payload
  };
  logger.warn("sending relay error", {
    requestId,
    bindingId,
    traceId,
    code: payload.code,
    message: payload.message
  });
  socket.send(JSON.stringify(message));
}

function messageLogContext(
  message: Pick<AppMessage, "id" | "type" | "bindingId" | "traceId">,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    requestId: message.id,
    type: message.type,
    bindingId: message.bindingId,
    traceId: message.traceId,
    ...extra
  };
}

function firstItemId<T extends { id: string }>(items: T[] | undefined): string | null {
  return items?.[0]?.id ?? null;
}

function lastItemId<T extends { id: string }>(items: T[] | undefined): string | null {
  return items && items.length > 0 ? items[items.length - 1]!.id : null;
}

function threadResumeRequestLogContext(message: AppMessage): Record<string, unknown> {
  if (message.type !== "thread_resume_req") {
    return {};
  }

  const payload = (message as ThreadResumeRequest).payload;
  return {
    threadId: payload.threadId,
    beforeItemId: payload.beforeItemId ?? null,
    windowSize: payload.windowSize ?? null
  };
}

function threadResumeResponseLogContext(message: AppMessage): Record<string, unknown> {
  if (message.type !== "thread_resume_res") {
    return {};
  }

  const payload = (message as ThreadResumeResponse).payload;
  const timelineItems = payload.timelineItems ?? [];
  return {
    threadId: payload.threadId,
    messageCount: payload.messages.length,
    timelineItemCount: timelineItems.length,
    hasMoreBefore: payload.hasMoreBefore ?? false,
    responseWindowKind: timelineItems.length > 0 ? "timeline" : "messages",
    firstMessageId: firstItemId(payload.messages),
    lastMessageId: lastItemId(payload.messages),
    firstTimelineItemId: firstItemId(timelineItems),
    lastTimelineItemId: lastItemId(timelineItems)
  };
}

function sendPendingClientMessage(
  route: PendingClientRoute,
  message: AppMessage,
  logger: ReturnType<typeof createLogger>,
  extra: Record<string, unknown> = {}
): void {
  const serialized = JSON.stringify(message);
  const payloadBytes = Buffer.byteLength(serialized);
  logger.info(
    "forwarding relay response to mobile",
    messageLogContext(message, {
      mobileDeviceId: route.mobileDeviceId,
      payloadBytes,
      bufferedAmountBefore: route.socket.bufferedAmount,
      ...threadResumeResponseLogContext(message),
      ...extra
    })
  );

  route.socket.send(serialized, (error) => {
    if (error) {
      logger.error(
        "relay response forward failed",
        messageLogContext(message, {
          mobileDeviceId: route.mobileDeviceId,
          payloadBytes,
          bufferedAmountAfter: route.socket.bufferedAmount,
          ...threadResumeResponseLogContext(message),
          error: error.message,
          ...extra
        })
      );
      return;
    }

    logger.info(
      "relay response forwarded to mobile",
      messageLogContext(message, {
        mobileDeviceId: route.mobileDeviceId,
        payloadBytes,
        bufferedAmountAfter: route.socket.bufferedAmount,
        ...threadResumeResponseLogContext(message),
        ...extra
      })
    );
  });
}

function presenceLogContext(
  agentId: string,
  snapshot: AgentPresenceSnapshot,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    agentId,
    status: snapshot.status,
    reason: snapshot.reason,
    detail: snapshot.detail,
    consecutiveFailures: snapshot.consecutiveFailures,
    updatedAt: snapshot.updatedAt,
    ...extra
  };
}

function parseMessage(raw: string, logger: ReturnType<typeof createLogger>): AppMessage | null {
  try {
    return JSON.parse(raw) as AppMessage;
  } catch (error) {
    logger.warn("failed to parse websocket payload", {
      raw,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

export async function startRelayServer(): Promise<void> {
  const config = loadRelayServerConfig();
  const endpoints = resolveRelayEndpoints(config);
  const logger = createLogger("relay-server");
  const store = new RelayStore(config.databaseUrl, config.redisUrl);
  await store.initialize();

  let agentSockets = new Map<string, WebSocket>();
  const mobileSockets = new Map<string, WebSocket>();
  const socketSessions = new Map<WebSocket, SocketSession>();
  const pendingClients = new Map<string, PendingClientRoute>();
  const agentControllers = new Map<string, string>();

  const HEARTBEAT_INTERVAL_MS = 30_000;
  const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3;
  const socketLastPingAt = new Map<WebSocket, number>();
  const socketHeartbeatTimeouts = new Map<WebSocket, ReturnType<typeof setTimeout>>();

  function invalidateDeviceSessions(
    deviceId: string,
    code: typeof ERROR_CODES.tokenExpired | typeof ERROR_CODES.tokenRevoked,
    message: string
  ): void {
    const event = buildTokenRevokedMessage(code, message);
    const sockets = [agentSockets.get(deviceId), mobileSockets.get(deviceId)].filter(
      (socket): socket is WebSocket => Boolean(socket)
    );

    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(event));
      }
      clearSocketHeartbeat(socket);
      socket.close();
    }
  }

  function clearSocketHeartbeat(socket: WebSocket): void {
    const timeout = socketHeartbeatTimeouts.get(socket);
    if (timeout) {
      clearTimeout(timeout);
      socketHeartbeatTimeouts.delete(socket);
    }
    socketLastPingAt.delete(socket);
  }

  function armSocketHeartbeat(socket: WebSocket, receivedAt = Date.now()): void {
    socketLastPingAt.set(socket, receivedAt);

    const existingTimeout = socketHeartbeatTimeouts.get(socket);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      const lastPingAt = socketLastPingAt.get(socket) ?? receivedAt;
      const session = socketSessions.get(socket);
      logger.warn("heartbeat timeout, closing connection", {
        deviceId: session?.deviceId,
        deviceType: session?.deviceType,
        silentMs: Date.now() - lastPingAt
      });
      clearSocketHeartbeat(socket);
      socket.close();
    }, HEARTBEAT_TIMEOUT_MS);

    socketHeartbeatTimeouts.set(socket, timeout);
  }

  logger.info("relay server initialized", {
    protocolVersion: PROTOCOL_VERSION,
    port: config.port,
    bindHost: config.bindHost,
    localBaseUrl: endpoints.localHttpBaseUrl,
    publicBaseUrl: endpoints.publicHttpBaseUrl,
    publicWebSocketUrl: endpoints.publicWebSocketUrl
  });

  const httpServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", endpoints.localHttpBaseUrl);

    try {
      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { ok: true, version: SERVER_VERSION });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/agents/bootstrap") {
        const body = await parseJsonBody<{
          deviceId?: string;
          deviceName?: string;
        }>(request);
        try {
          const result = await bootstrapDevice(store, {
            deviceType: "agent",
            deviceId: body.deviceId,
            deviceName: body.deviceName ?? body.deviceId ?? "Mac Agent",
            runtimeType: "codex",
            nowSeconds: nowInSeconds()
          });

          sendJson(response, 200, {
            deviceId: result.device.deviceId,
            accessToken: result.tokens.accessToken,
            refreshToken: result.tokens.refreshToken,
            accessExpiresAt: result.tokens.accessExpiresAt,
            refreshExpiresAt: result.tokens.refreshExpiresAt,
            relayUrl: endpoints.publicHttpBaseUrl
          });
        } catch (error) {
          if (error instanceof DeviceAlreadyInitializedError) {
            sendJson(response, 409, {
              code: ERROR_CODES.deviceAlreadyInitialized,
              message: "agent already initialized; reset auth before re-bootstrap"
            });
            return;
          }
          throw error;
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/mobile-devices/bootstrap") {
        const body = await parseJsonBody<{
          deviceId?: string;
          deviceName?: string;
        }>(request);
        try {
          const result = await bootstrapDevice(store, {
            deviceType: "mobile",
            deviceId: body.deviceId,
            deviceName: body.deviceName ?? "iPhone App",
            nowSeconds: nowInSeconds()
          });

          sendJson(
            response,
            200,
            await buildBootstrapResponse(
              store,
              result.device.deviceId,
              result.tokens,
              endpoints.publicHttpBaseUrl
            )
          );
        } catch (error) {
          if (error instanceof DeviceAlreadyInitializedError) {
            sendJson(response, 409, {
              code: ERROR_CODES.deviceAlreadyInitialized,
              message: "mobile device already initialized; refresh or reset auth before re-bootstrap"
            });
            return;
          }
          throw error;
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/token/refresh") {
        const deviceId = request.headers["x-device-id"];
        const refreshToken = request.headers["x-refresh-token"];
        if (typeof deviceId !== "string" || typeof refreshToken !== "string") {
          sendJson(response, 401, {
            code: ERROR_CODES.unauthorized,
            message: "missing refresh auth headers"
          });
          return;
        }

        const result = await refreshDeviceAuth(store, {
          deviceId,
          refreshToken,
          nowSeconds: nowInSeconds()
        });
        if (!result.ok) {
          sendJson(response, 401, {
            code: result.code,
            message: result.message
          });
          return;
        }

        sendJson(response, 200, {
          deviceId: result.device.deviceId,
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          accessExpiresAt: result.tokens.accessExpiresAt,
          refreshExpiresAt: result.tokens.refreshExpiresAt,
          relayUrl: endpoints.publicHttpBaseUrl
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/pairings") {
        const deviceId = request.headers["x-device-id"];
        const deviceToken = request.headers["x-device-token"];
        if (typeof deviceId !== "string" || typeof deviceToken !== "string") {
          sendJson(response, 401, {
            code: ERROR_CODES.unauthorized,
            message: "missing device auth headers"
          });
          return;
        }

        const auth = await validateDeviceAuth(store, {
          deviceType: "agent",
          deviceId,
          deviceToken
        });
        if (!auth.ok) {
          sendJson(response, 401, {
            code: auth.code,
            message: auth.message
          });
          return;
        }

        const body = await parseJsonBody<{ agentLabel?: string }>(request);
        const { payload } = await createPairingSession(store, {
          agentId: auth.device.deviceId,
          agentLabel: body.agentLabel ?? auth.device.deviceName,
          relayBaseUrl: endpoints.publicHttpBaseUrl,
          nowSeconds: nowInSeconds()
        });

        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/pairings/claim") {
        const deviceId = request.headers["x-device-id"];
        const deviceToken = request.headers["x-device-token"];
        if (typeof deviceId !== "string" || typeof deviceToken !== "string") {
          sendJson(response, 401, {
            code: ERROR_CODES.unauthorized,
            message: "missing device auth headers"
          });
          return;
        }

        const auth = await validateDeviceAuth(store, {
          deviceType: "mobile",
          deviceId,
          deviceToken
        });
        if (!auth.ok) {
          sendJson(response, 401, {
            code: auth.code,
            message: auth.message
          });
          return;
        }

        const body = await parseJsonBody<{
          pairingId: string;
          pairingSecret: string;
          displayName?: string;
        }>(request);
        const result = await claimPairingSession(store, {
          pairingId: body.pairingId,
          pairingSecret: body.pairingSecret,
          mobileDeviceId: auth.device.deviceId,
          displayName: body.displayName ?? "默认 Mac",
          nowSeconds: nowInSeconds()
        });

        if (!result) {
          sendJson(response, 400, {
            code: ERROR_CODES.invalidPayload,
            message: "invalid pairing session"
          });
          return;
        }

        const allBindings = await store.getBindingsForMobileDevice(auth.device.deviceId);
        sendJson(response, 200, {
          bindingId: result.binding.bindingId,
          agentId: result.binding.agentId,
          agentLabel: result.pairing.agentLabel,
          relayUrl: result.pairing.relayBaseUrl,
          bindings: summarizeBindings(allBindings),
          defaultBindingId: allBindings.find((b) => b.isDefault)?.bindingId
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/dev/reset-device-auth") {
        if (!config.enableDevReset) {
          sendJson(response, 403, {
            code: ERROR_CODES.forbidden,
            message: "dev reset is disabled"
          });
          return;
        }

        const body = await parseJsonBody<{ deviceId: string }>(request);
        if (!body.deviceId) {
          sendJson(response, 400, {
            code: ERROR_CODES.invalidPayload,
            message: "missing deviceId"
          });
          return;
        }

        const revokedCount = await revokeDeviceAuthTokens(store, {
          deviceId: body.deviceId,
          revokeReason: "dev_reset",
          nowSeconds: nowInSeconds()
        });

        invalidateDeviceSessions(body.deviceId, ERROR_CODES.tokenRevoked, "device auth reset for development");

        sendJson(response, 200, {
          ok: true,
          deviceId: body.deviceId,
          revokedCount
        });
        return;
      }

      sendJson(response, 404, {
        code: ERROR_CODES.invalidPayload,
        message: "not found"
      });
    } catch (error) {
      logger.error("http request failed", {
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error)
      });
      sendJson(response, 500, { code: "INTERNAL_ERROR", message: "internal server error" });
    }
  });

  const wsServer = new WebSocketServer({ noServer: true });
  const agentPresenceById = new Map<string, AgentPresenceSnapshot>();

  function sameAgentPresence(
    left: AgentPresenceSnapshot | undefined,
    right: Omit<AgentPresenceSnapshot, "updatedAt">
  ): boolean {
    return (
      left?.status === right.status &&
      left?.reason === right.reason &&
      left?.detail === right.detail &&
      left?.consecutiveFailures === right.consecutiveFailures
    );
  }

  async function broadcastAgentPresence(agentId: string, snapshot: AgentPresenceSnapshot): Promise<void> {
    const bindings = await store.getBindingsForAgent(agentId);
    for (const binding of bindings) {
      const mobileSocket = mobileSockets.get(binding.mobileDeviceId);
      if (!mobileSocket || mobileSocket.readyState !== WebSocket.OPEN) {
        continue;
      }

      mobileSocket.send(
        JSON.stringify(
          buildAgentPresenceMessage(binding.bindingId, agentId, {
            status: snapshot.status,
            reason: snapshot.reason,
            detail: snapshot.detail,
            consecutiveFailures: snapshot.consecutiveFailures
          })
        )
      );
    }
  }

  async function updateAgentPresence(
    agentId: string,
    next: Omit<AgentPresenceSnapshot, "updatedAt">
  ): Promise<void> {
    if (sameAgentPresence(agentPresenceById.get(agentId), next)) {
      return;
    }

    const snapshot: AgentPresenceSnapshot = {
      ...next,
      updatedAt: nowInSeconds()
    };
    agentPresenceById.set(agentId, snapshot);
    logger.info("agent presence updated", presenceLogContext(agentId, snapshot, { source: "push" }));
    await broadcastAgentPresence(agentId, snapshot);
  }

  function resolveAuthoritativeAgentPresence(agentId: string): AgentPresenceSnapshot {
    const current = agentPresenceById.get(agentId);
    const agentSocket = agentSockets.get(agentId);
    if (agentSocket && agentSocket.readyState === WebSocket.OPEN) {
      if (current?.status === "degraded") {
        return current;
      }

      if (current?.status === "online") {
        return current;
      }

      return {
        status: "online",
        updatedAt: nowInSeconds()
      };
    }

    if (current?.status === "offline") {
      return current;
    }

    return {
      status: "offline",
      updatedAt: nowInSeconds()
    };
  }

  async function syncAuthoritativeAgentPresence(agentId: string): Promise<AgentPresenceSnapshot> {
    const snapshot = resolveAuthoritativeAgentPresence(agentId);
    const current = agentPresenceById.get(agentId);

    if (current && sameAgentPresence(current, snapshot)) {
      logger.debug("agent presence already authoritative", presenceLogContext(agentId, current));
      return current;
    }

    agentPresenceById.set(agentId, snapshot);
    logger.info("agent presence synchronized", presenceLogContext(agentId, snapshot, { source: "authoritative_sync" }));
    await broadcastAgentPresence(agentId, snapshot);
    return snapshot;
  }

  async function syncAgentPresenceForMobile(mobileDeviceId: string, socket: WebSocket): Promise<void> {
    const bindings = await store.getBindingsForMobileDevice(mobileDeviceId);
    logger.info("syncing agent presence for mobile", {
      mobileDeviceId,
      bindingCount: bindings.length
    });
    for (const binding of bindings) {
      const snapshot = await syncAuthoritativeAgentPresence(binding.agentId);
      logger.debug("sending initial agent presence to mobile", {
        mobileDeviceId,
        bindingId: binding.bindingId,
        agentId: binding.agentId,
        status: snapshot.status
      });
      socket.send(
        JSON.stringify(
          buildAgentPresenceMessage(binding.bindingId, binding.agentId, {
            status: snapshot.status,
            reason: snapshot.reason,
            detail: snapshot.detail,
            consecutiveFailures: snapshot.consecutiveFailures
          })
        )
      );
    }
  }

  async function notifyControlRevoked(
    agentId: string,
    previousMobileDeviceId: string,
    takenByDeviceId: string
  ): Promise<void> {
    const oldSocket = mobileSockets.get(previousMobileDeviceId);
    if (!oldSocket || oldSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const bindings = await store.getBindingsForAgent(agentId);
    const previousBinding = bindings.find((binding) => binding.mobileDeviceId === previousMobileDeviceId);
    if (!previousBinding) {
      logger.warn("control revoke skipped because previous binding is missing", {
        agentId,
        previousMobileDeviceId,
        takenByDeviceId
      });
      return;
    }

    const message: ControlRevokedEvent = {
      id: createId("msg"),
      type: "control_revoked",
      bindingId: previousBinding.bindingId,
      createdAt: nowInSeconds(),
      requiresAck: false,
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        agentId,
        takenByDeviceId,
        message: "该 Mac 已被另一台设备接管控制"
      }
    };
    oldSocket.send(JSON.stringify(message));
  }

  async function takeoverAgentControl(binding: BindingRecord, newMobileDeviceId: string): Promise<string | undefined> {
    const previousController = agentControllers.get(binding.agentId);
    if (previousController === newMobileDeviceId) {
      logger.debug("agent control already held by mobile", {
        agentId: binding.agentId,
        bindingId: binding.bindingId,
        mobileDeviceId: newMobileDeviceId
      });
      return previousController;
    }

    agentControllers.set(binding.agentId, newMobileDeviceId);
    logger.info("agent control granted", {
      agentId: binding.agentId,
      bindingId: binding.bindingId,
      previousController,
      newController: newMobileDeviceId
    });

    if (previousController && previousController !== newMobileDeviceId) {
      await notifyControlRevoked(binding.agentId, previousController, newMobileDeviceId);
    }

    return previousController;
  }

  wsServer.on("connection", (socket: WebSocket) => {
    socket.on("message", async (data: RawData) => {
      try {
        const message = parseMessage(data.toString(), logger);
        if (!message) {
          return;
        }

        logger.debug("relay message received", messageLogContext(message));

        const session = socketSessions.get(socket);
        if (!session) {
          if (message.type !== "auth") {
            sendProtocolError(socket, message.id, message.bindingId, message.traceId, logger, {
              code: ERROR_CODES.unauthorized,
              message: "socket is not authenticated"
            });
            return;
          }

          const auth = message as AuthMessage;
          const authResult = await validateDeviceAuth(store, auth.payload);
          if (!authResult.ok) {
            sendProtocolError(socket, auth.id, auth.bindingId, auth.traceId, logger, {
              code: authResult.code,
              message: authResult.message
            });
            socket.close();
            return;
          }
          const device = authResult.device;

          const authOk: AuthOkMessage = {
            id: auth.id,
            type: "auth_ok",
            createdAt: nowInSeconds(),
            requiresAck: false,
            protocolVersion: PROTOCOL_VERSION,
            payload: {
              deviceType: device.deviceType,
              deviceId: device.deviceId,
              protocolVersion: PROTOCOL_VERSION,
              serverVersion: SERVER_VERSION,
              features: [
                "pairing",
                "thread_list",
                "thread_resume",
                "streaming",
                "approval",
                "interrupt",
                "agent_health",
                "presence_sync",
                "control_takeover",
                "token_refresh"
              ]
            }
          };

          socketSessions.set(socket, {
            deviceId: device.deviceId,
            deviceType: device.deviceType
          });
          armSocketHeartbeat(socket);

          if (device.deviceType === "agent") {
            const previousAgentSocket = agentSockets.get(device.deviceId);
            agentSockets.set(device.deviceId, socket);
            previousAgentSocket?.close();
            updateAgentPresence(device.deviceId, {
              status: "online"
            }).catch((err) => {
              logger.error("updateAgentPresence failed", { error: err instanceof Error ? err.message : String(err) });
            });
            logger.info("agent authenticated", { agentId: device.deviceId });
          } else {
            const previousMobileSocket = mobileSockets.get(device.deviceId);
            mobileSockets.set(device.deviceId, socket);
            previousMobileSocket?.close();
            logger.info("mobile authenticated", { mobileDeviceId: device.deviceId });
          }

          socket.send(JSON.stringify(authOk));

          if (device.deviceType === "mobile") {
            syncAgentPresenceForMobile(device.deviceId, socket).catch((err) => {
              logger.error("syncAgentPresenceForMobile failed", { error: err instanceof Error ? err.message : String(err) });
            });
          }
          return;
        }

        if (message.type === "ping") {
          armSocketHeartbeat(socket);
          const pong: PongMessage = {
            id: message.id,
            type: "pong",
            createdAt: nowInSeconds(),
            requiresAck: false,
            protocolVersion: PROTOCOL_VERSION,
            payload: { ts: (message as PingMessage).payload.ts }
          };
          socket.send(JSON.stringify(pong));
          return;
        }

        if (session.deviceType === "mobile") {
          if (
            message.type !== "presence_sync_req" &&
            message.type !== "control_takeover_req" &&
            message.type !== "thread_list_req" &&
            message.type !== "thread_create_req" &&
            message.type !== "thread_archive_req" &&
            message.type !== "thread_resume_req" &&
            message.type !== "turn_start_req" &&
            message.type !== "approval_resolve_req" &&
            message.type !== "turn_interrupt_req"
          ) {
            logger.debug("ignoring unsupported mobile message", { type: message.type });
            return;
          }

          if (!message.bindingId) {
            sendProtocolError(socket, message.id, message.bindingId, message.traceId, logger, {
              code: ERROR_CODES.bindingNotFound,
              message: "missing binding id"
            });
            return;
          }

          const binding = await validateMobileBinding(store, session.deviceId, message.bindingId);
          if (!binding) {
            sendProtocolError(socket, message.id, message.bindingId, message.traceId, logger, {
              code: ERROR_CODES.bindingNotFound,
              message: "binding not found for current mobile device"
            });
            return;
          }

          if (message.type === "presence_sync_req") {
            store.touchBinding(binding.bindingId, nowInSeconds()).catch((err) => {
              logger.error("touchBinding failed", {
                bindingId: binding.bindingId,
                error: err instanceof Error ? err.message : String(err)
              });
            });
            const snapshot = await syncAuthoritativeAgentPresence(binding.agentId);
            logger.info(
              "presence sync request resolved",
              messageLogContext(message, {
                mobileDeviceId: session.deviceId,
                agentId: binding.agentId,
                status: snapshot.status,
                reason: snapshot.reason,
                detail: snapshot.detail
              })
            );
            socket.send(
              JSON.stringify(
                buildPresenceSyncResponseMessage(
                  message.id,
                  binding.bindingId,
                  message.traceId,
                  binding.agentId,
                  snapshot
                )
              )
            );
            return;
          }

          if (message.type === "control_takeover_req") {
            store.touchBinding(binding.bindingId, nowInSeconds()).catch((err) => {
              logger.error("touchBinding failed", {
                bindingId: binding.bindingId,
                error: err instanceof Error ? err.message : String(err)
              });
            });

            const previousController = await takeoverAgentControl(binding, session.deviceId);
            const response: ControlTakeoverResponse = {
              id: message.id,
              type: "control_takeover_res",
              bindingId: binding.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: message.traceId,
              payload: {
                agentId: binding.agentId,
                granted: true,
                controllerDeviceId: session.deviceId
              }
            };
            logger.info(
              "control takeover resolved",
              messageLogContext(message, {
                mobileDeviceId: session.deviceId,
                agentId: binding.agentId,
                previousController,
                controllerDeviceId: session.deviceId
              })
            );
            socket.send(JSON.stringify(response));
            return;
          }

          const target = await resolveRouteTarget(store, binding.bindingId);
          if (!target) {
            sendProtocolError(socket, message.id, message.bindingId, message.traceId, logger, {
              code: ERROR_CODES.bindingNotFound,
              message: "binding is not active"
            });
            return;
          }

          if (WRITE_OPERATIONS.has(message.type)) {
            const controller = agentControllers.get(target.agentId);
            if (controller !== session.deviceId) {
              logger.warn(
                "mobile write rejected because control is not held",
                messageLogContext(message, {
                  mobileDeviceId: session.deviceId,
                  agentId: target.agentId,
                  controllerMobileDeviceId: controller
                })
              );
              sendProtocolError(socket, message.id, message.bindingId, message.traceId, logger, {
                code: ERROR_CODES.controlNotHeld,
                message: "当前设备尚未取得该 Mac 控制权，请先接管控制权"
              });
              return;
            }
          }

          const agentSocket = agentSockets.get(target.agentId);
          if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) {
            const snapshot = await syncAuthoritativeAgentPresence(target.agentId);
            logger.warn(
              "mobile write rejected because agent is offline",
              messageLogContext(message, {
                mobileDeviceId: session.deviceId,
                agentId: target.agentId,
                agentSocketPresent: agentSocket ? "true" : "false",
                agentSocketState: agentSocket?.readyState,
                authoritativeStatus: snapshot.status,
                authoritativeReason: snapshot.reason,
                authoritativeDetail: snapshot.detail
              })
            );
            sendProtocolError(socket, message.id, message.bindingId, message.traceId, logger, {
              code: ERROR_CODES.agentOffline,
              message: "no connected mac agent"
            });
            return;
          }

          const idempotentOperation = IDEMPOTENT_MOBILE_OPERATIONS.get(message.type);
          if (idempotentOperation) {
            if (!message.idempotencyKey) {
              sendProtocolError(socket, message.id, message.bindingId, message.traceId, logger, {
                code: ERROR_CODES.invalidPayload,
                message: "missing idempotency key for write request"
              });
              return;
            }

            const acquired = await store.acquireIdempotency(
              binding.bindingId,
              idempotentOperation,
              message.idempotencyKey
            );
            if (!acquired) {
              sendProtocolError(socket, message.id, message.bindingId, message.traceId, logger, {
                code: ERROR_CODES.idempotencyConflict,
                message: "重复请求已忽略，请刷新页面确认最新状态"
              });
              return;
            }
          }

          store.touchBinding(binding.bindingId, nowInSeconds()).catch((err) => {
            logger.error("touchBinding failed", { bindingId: binding.bindingId, error: err instanceof Error ? err.message : String(err) });
          });
          pendingClients.set(message.id, {
            socket,
            mobileDeviceId: session.deviceId,
            keepAlive: message.type === "turn_start_req"
          });
          logger.info(
            "routing mobile request to agent",
            messageLogContext(message, {
              mobileDeviceId: session.deviceId,
              agentId: target.agentId,
              keepAlive: message.type === "turn_start_req",
              ...threadResumeRequestLogContext(message)
            })
          );
          agentSocket.send(JSON.stringify(message));
          return;
        }

        if (message.type === "agent_health_report") {
          const report = message as AgentHealthReport;
          logger.info(
            "agent health report received",
            messageLogContext(message, {
              agentId: session.deviceId,
              status: report.payload.status,
              reason: report.payload.reason,
              detail: report.payload.detail,
              consecutiveFailures: report.payload.consecutiveFailures
            })
          );
          await updateAgentPresence(session.deviceId, {
            status: report.payload.status,
            reason: report.payload.status === "degraded" ? report.payload.reason : undefined,
            detail: report.payload.status === "degraded" ? report.payload.detail : undefined,
            consecutiveFailures:
              report.payload.status === "degraded" ? report.payload.consecutiveFailures : undefined
          });
          return;
        }

        if (
          message.type === "thread_list_res" ||
          message.type === "thread_create_res" ||
          message.type === "thread_resume_res" ||
          message.type === "approval_resolved" ||
          message.type === "turn_interrupted" ||
          message.type === "turn_completed" ||
          message.type === "error"
        ) {
          const requestId = message.type === "turn_completed" ? message.payload.requestId : message.id;
          const target = pendingClients.get(requestId);
          if (!target || target.socket.readyState !== WebSocket.OPEN) {
            pendingClients.delete(requestId);
            return;
          }

          pendingClients.delete(requestId);
          sendPendingClientMessage(target, message, logger, {
            keepAlive: target.keepAlive
          });
          return;
        }

        if (
          message.type === "turn_delta" ||
          message.type === "turn_status" ||
          message.type === "command_output_delta" ||
          message.type === "approval_requested"
        ) {
          const target = pendingClients.get(message.payload.requestId);
          if (!target || target.socket.readyState !== WebSocket.OPEN) {
            pendingClients.delete(message.payload.requestId);
            return;
          }

          sendPendingClientMessage(target, message, logger, {
            keepAlive: target.keepAlive,
            upstreamRequestId: message.payload.requestId
          });
          return;
        }

        logger.debug("ignoring unsupported agent message", { type: message.type });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("websocket message handler failed", { error: errorMsg });

        // 尝试向请求方回传 error envelope，避免客户端 pending 卡死
        if (socket.readyState === WebSocket.OPEN) {
          try {
            const raw = data.toString();
            const parsed = JSON.parse(raw) as AppMessage | undefined;
            if (parsed?.id) {
              sendProtocolError(socket, parsed.id, parsed.bindingId, parsed.traceId, logger, {
                code: ERROR_CODES.internalError,
                message: "internal server error"
              });
            }
          } catch {
            // 解析失败时无法回传，仅依赖上面已打的日志
          }
        }
      }
    });

    socket.on("close", () => {
      clearSocketHeartbeat(socket);
      const session = socketSessions.get(socket);
      socketSessions.delete(socket);
      if (!session) {
        return;
      }

      if (session.deviceType === "agent") {
        if (agentSockets.get(session.deviceId) === socket) {
          agentSockets.delete(session.deviceId);
          updateAgentPresence(session.deviceId, {
            status: "offline"
          }).catch((err) => {
            logger.error("updateAgentPresence failed", { error: err instanceof Error ? err.message : String(err) });
          });
          logger.warn("agent disconnected from relay", { agentId: session.deviceId });
        } else {
          logger.debug("stale agent socket closed", { agentId: session.deviceId });
        }
      } else {
        const isCurrentMobileSocket = mobileSockets.get(session.deviceId) === socket;
        if (isCurrentMobileSocket) {
          mobileSockets.delete(session.deviceId);
        } else {
          logger.debug("stale mobile socket closed", { mobileDeviceId: session.deviceId });
        }

        if (isCurrentMobileSocket) {
          const releasedAgentIds: string[] = [];
          for (const [agentId, controllerMobileDeviceId] of agentControllers.entries()) {
            if (controllerMobileDeviceId === session.deviceId) {
              agentControllers.delete(agentId);
              releasedAgentIds.push(agentId);
            }
          }
          if (releasedAgentIds.length > 0) {
            logger.info("released agent controls for mobile", {
              mobileDeviceId: session.deviceId,
              agentIds: releasedAgentIds
            });
          }
        }
      }

      for (const [requestId, pendingSocket] of pendingClients.entries()) {
        if (pendingSocket.socket === socket) {
          pendingClients.delete(requestId);
        }
      }
    });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", endpoints.localHttpBaseUrl);
    if (url.pathname !== "/v1/connect") {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit("connection", ws, request);
    });
  });

  httpServer.on("close", () => {
    for (const timeout of socketHeartbeatTimeouts.values()) {
      clearTimeout(timeout);
    }
    socketHeartbeatTimeouts.clear();
    socketLastPingAt.clear();
  });

  httpServer.listen(config.port, config.bindHost);
  logger.info("relay http server listening", {
    bindHost: config.bindHost,
    localBaseUrl: endpoints.localHttpBaseUrl,
    baseUrl: endpoints.publicHttpBaseUrl,
    websocketUrl: endpoints.publicWebSocketUrl
  });
}

export async function runRelayMigrations(): Promise<void> {
  const config = loadRelayServerConfig();
  const logger = createLogger("relay-migrate");
  const store = new PostgresStore(config.databaseUrl);

  try {
    const result = await store.migrate();
    logger.info("database migration completed", {
      appliedMigrations: result.appliedMigrationIds,
      skippedMigrations: result.skippedMigrationIds
    });
  } finally {
    await store.close();
  }
}

async function bootstrapLocalMobileClient(): Promise<BootstrapResponse> {
  const config = loadRelayServerConfig();
  const endpoints = resolveRelayEndpoints(config);
  const response = await fetch(`${endpoints.localHttpBaseUrl}/v1/mobile-devices/bootstrap`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      deviceId: "relay-local-client",
      deviceName: "Relay Local Client"
    })
  });

  if (!response.ok) {
    throw new Error(`failed to bootstrap local client: ${response.status}`);
  }

  return (await response.json()) as BootstrapResponse;
}

async function withRelayClient<T>(
  run: (context: LocalClientContext) => Promise<T>
): Promise<T> {
  const config = loadRelayServerConfig();
  const endpoints = resolveRelayEndpoints(config);
  const bootstrap = await bootstrapLocalMobileClient();
  const bindingId = bootstrap.defaultBindingId ?? bootstrap.bindings[0]?.bindingId;
  if (!bindingId) {
    throw new Error("local client has no binding; create a pairing and claim it first");
  }

  return new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(endpoints.localWebSocketUrl);

    socket.on("open", () => {
      const auth: AuthMessage = {
        id: createId("msg"),
        type: "auth",
        createdAt: nowInSeconds(),
        requiresAck: false,
        protocolVersion: PROTOCOL_VERSION,
        payload: {
          deviceType: "mobile",
          deviceId: bootstrap.deviceId,
          deviceToken: bootstrap.accessToken,
          clientVersion: "relay-local-client/0.1.0"
        }
      };
      socket.send(JSON.stringify(auth));
    });

    socket.on("message", async (data: RawData) => {
      const message = parseMessage(data.toString(), createLogger("relay-server-client"));
      if (!message) {
        return;
      }

      if (message.type !== "auth_ok") {
        return;
      }

      try {
        const result = await run({ socket, bindingId });
        socket.close();
        resolve(result);
      } catch (error) {
        socket.close();
        reject(error);
      }
    });

    socket.on("error", (error: Error) => reject(error));
  });
}

async function waitForResponse<TMessage extends AppMessage>(
  socket: WebSocket,
  logger: ReturnType<typeof createLogger>,
  requestId: string,
  options: {
    acceptedTypes: TMessage["type"][];
  }
): Promise<TMessage> {
  return new Promise<TMessage>((resolve, reject) => {
    const handleMessage = (data: RawData) => {
      const message = parseMessage(data.toString(), logger);
      if (!message) {
        return;
      }

      if (
        message.type === "turn_delta" ||
        message.type === "turn_completed" ||
        message.type === "turn_status" ||
        message.type === "command_output_delta" ||
        message.type === "approval_requested" ||
        message.type === "agent_presence"
      ) {
        return;
      }

      if (message.id !== requestId) {
        return;
      }

      if (message.type === "error") {
        socket.off("message", handleMessage);
        reject(new Error((message as ErrorMessage).payload.message));
        return;
      }

      if (options.acceptedTypes.includes(message.type as TMessage["type"])) {
        socket.off("message", handleMessage);
        resolve(message as TMessage);
      }
    };

    socket.on("message", handleMessage);
  });
}

export async function requestThreadsFromRelay(limit: number): Promise<void> {
  const logger = createLogger("relay-server-client");

  await withRelayClient(async ({ socket, bindingId }) => {
    const requestId = createId("msg");
    const request: ThreadListRequest = {
      id: requestId,
      type: "thread_list_req",
      bindingId,
      createdAt: nowInSeconds(),
      requiresAck: true,
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        limit
      }
    };

    socket.send(JSON.stringify(request));
    const response = await waitForResponse<ThreadListResponse>(socket, logger, requestId, {
      acceptedTypes: ["thread_list_res"]
    });

    logger.info("received relay thread list", {
      count: response.payload.items.length,
      nextCursor: response.payload.nextCursor
    });
    for (const thread of response.payload.items) {
      logger.info("thread preview", {
        id: thread.id,
        cwd: thread.cwd,
        preview: thread.preview.trim()
      });
    }
  });
}

export async function createThreadFromRelay(cwd?: string): Promise<void> {
  const logger = createLogger("relay-server-client");

  await withRelayClient(async ({ socket, bindingId }) => {
    const requestId = createId("msg");
    const request: ThreadCreateRequest = {
      id: requestId,
      type: "thread_create_req",
      bindingId,
      createdAt: nowInSeconds(),
      requiresAck: true,
      protocolVersion: PROTOCOL_VERSION,
      idempotencyKey: createId("idem"),
      payload: {
        cwd
      }
    };

    socket.send(JSON.stringify(request));
    const response = await waitForResponse<ThreadCreateResponse>(socket, logger, requestId, {
      acceptedTypes: ["thread_create_res"]
    });

    logger.info("created relay thread", {
      threadId: response.payload.thread.id,
      cwd: response.payload.thread.cwd,
      preview: response.payload.thread.preview.trim()
    });
  });
}

export async function resumeThreadFromRelay(threadId: string): Promise<void> {
  const logger = createLogger("relay-server-client");

  await withRelayClient(async ({ socket, bindingId }) => {
    const requestId = createId("msg");
    const request: ThreadResumeRequest = {
      id: requestId,
      type: "thread_resume_req",
      bindingId,
      createdAt: nowInSeconds(),
      requiresAck: true,
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        threadId
      }
    };

    socket.send(JSON.stringify(request));

    const response = await waitForResponse<ThreadResumeResponse>(socket, logger, requestId, {
      acceptedTypes: ["thread_resume_res"]
    });

    logger.info("resumed relay thread", {
      threadId: response.payload.threadId,
      cwd: response.payload.cwd,
      messageCount: response.payload.messages.length
    });

    for (const message of response.payload.messages) {
      logger.info("thread message", {
        role: message.role,
        turnId: message.turnId,
        text: message.text
      });
    }
  });
}

async function printThreadHistory(
  socket: WebSocket,
  logger: ReturnType<typeof createLogger>,
  threadId: string,
  bindingId: string
): Promise<void> {
  const requestId = createId("msg");
  const request: ThreadResumeRequest = {
    id: requestId,
    type: "thread_resume_req",
    bindingId,
    createdAt: nowInSeconds(),
    requiresAck: true,
    protocolVersion: PROTOCOL_VERSION,
    payload: {
      threadId
    }
  };

  socket.send(JSON.stringify(request));
  const response = await waitForResponse<ThreadResumeResponse>(socket, logger, requestId, {
    acceptedTypes: ["thread_resume_res"]
  });

  logger.info("thread history loaded", {
    threadId: response.payload.threadId,
    cwd: response.payload.cwd,
    messageCount: response.payload.messages.length
  });

  for (const message of response.payload.messages) {
    const roleLabel = message.role === "assistant" ? "assistant" : "user";
    process.stdout.write(`${roleLabel}> ${message.text}\n`);
  }
}

async function sendChatTurn(
  socket: WebSocket,
  logger: ReturnType<typeof createLogger>,
  threadId: string,
  text: string,
  bindingId: string
): Promise<void> {
  const requestId = createId("msg");
  const request: TurnStartRequest = {
    id: requestId,
    type: "turn_start_req",
    bindingId,
    createdAt: nowInSeconds(),
    requiresAck: true,
    protocolVersion: PROTOCOL_VERSION,
    idempotencyKey: createId("idem"),
    payload: {
      threadId,
      inputs: [{ type: "text", text }]
    }
  };

  process.stdout.write(`user> ${text}\nassistant> `);

  await new Promise<void>((resolve, reject) => {
    const handleMessage = (data: RawData) => {
      const message = parseMessage(data.toString(), logger);
      if (!message) {
        return;
      }

      if (message.type === "error" && message.id === requestId) {
        socket.off("message", handleMessage);
        process.stdout.write("\n");
        reject(new Error((message as ErrorMessage).payload.message));
        return;
      }

      if (message.type === "turn_delta" && message.payload.requestId === requestId) {
        process.stdout.write(message.payload.delta);
        return;
      }

      if (message.type === "turn_completed" && message.payload.requestId === requestId) {
        socket.off("message", handleMessage);
        if (!message.payload.text) {
          process.stdout.write("(no text)");
        }
        process.stdout.write("\n");
        if (message.payload.status === "failed") {
          reject(new Error(message.payload.errorMessage ?? "turn failed"));
          return;
        }
        resolve();
      }
    };

    socket.on("message", handleMessage);
    socket.send(JSON.stringify(request));
  });
}

export async function chatWithThreadFromRelay(
  threadId: string,
  initialMessage: string | null
): Promise<void> {
  const logger = createLogger("relay-chat");

  await withRelayClient(async ({ socket, bindingId }) => {
    await printThreadHistory(socket, logger, threadId, bindingId);

    if (initialMessage) {
      await sendChatTurn(socket, logger, threadId, initialMessage, bindingId);
      return;
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    const prompt = () => {
      rl.setPrompt("chat> ");
      rl.prompt();
    };

    logger.info("chat mode ready", {
      threadId,
      hint: "输入 exit 退出，其他内容将作为 turn 发送到当前 thread"
    });

    prompt();

    for await (const line of rl) {
      const text = line.trim();
      if (!text) {
        prompt();
        continue;
      }

      if (text === "exit" || text === "/exit" || text === "quit") {
        rl.close();
        break;
      }

      await sendChatTurn(socket, logger, threadId, text, bindingId);
      prompt();
    }
  });
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const [command = "serve", arg1, ...rest] = normalizeArgv(argv);

  if (command === "migrate") {
    await runRelayMigrations();
    return;
  }

  if (command === "serve") {
    await startRelayServer();
    return;
  }

  if (command === "threads") {
    await requestThreadsFromRelay(parseThreadLimit(arg1));
    return;
  }

  if (command === "resume") {
    if (!arg1) {
      throw new Error("resume command requires a threadId");
    }
    await resumeThreadFromRelay(arg1);
    return;
  }

  if (command === "chat") {
    if (!arg1) {
      throw new Error("chat command requires a threadId");
    }
    const initialMessage = rest.length > 0 ? rest.join(" ") : null;
    await chatWithThreadFromRelay(arg1, initialMessage);
    return;
  }

  throw new Error(`unsupported relay-server command: ${command}`);
}

void main().catch((error: unknown) => {
  const logger = createLogger("relay-server");
  const errorMessage =
    error instanceof PendingMigrationsError || error instanceof MigrationChecksumMismatchError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  logger.error("relay command failed", {
    message: errorMessage
  });
  process.exitCode = 1;
});
