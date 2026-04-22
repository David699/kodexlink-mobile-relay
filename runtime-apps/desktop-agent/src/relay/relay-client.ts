import WebSocket, { type RawData } from "ws";

import {
  ERROR_CODES,
  PROTOCOL_VERSION,
  type ErrorCode,
  type AgentHealthReport,
  type AgentHealthReportPayload,
  type ApprovalRequestedPayload,
  type ApprovalResolveRequest,
  type ApprovalResolvedPayload,
  type AppMessage,
  type AuthMessage,
  type AuthOkMessage,
  type CommandOutputDeltaPayload,
  type ErrorMessage,
  type PingMessage,
  type TurnInterruptRequest,
  type TurnInterruptedPayload,
  type TurnDeltaPayload,
  type ThreadCreateRequest,
  type ThreadCreateResponsePayload,
  type ThreadArchiveRequest,
  type ThreadArchiveResponsePayload,
  type ThreadResumeRequest,
  type ThreadResumeResponsePayload,
  type ThreadListRequest,
  type ThreadListResponsePayload,
  type TurnStartRequest,
  type TurnCompletedPayload,
  type TurnStatusPayload
} from "@kodexlink/protocol";
import { NodeHeartbeat, createId, nowInSeconds, type Logger } from "@kodexlink/shared";

import { getAgentVersion } from "../product/agent-version.js";
import type { RelayConnectionStateReporter } from "./relay-connection-state.js";
import { summarizeThreadResumeResponse } from "./thread-resume-window.js";

interface RelayClientHandlers {
  handleThreadList(request: ThreadListRequest): Promise<ThreadListResponsePayload>;
  handleThreadCreate(request: ThreadCreateRequest): Promise<ThreadCreateResponsePayload>;
  handleThreadArchive(request: ThreadArchiveRequest): Promise<ThreadArchiveResponsePayload>;
  handleThreadResume(request: ThreadResumeRequest): Promise<ThreadResumeResponsePayload>;
  handleApprovalResolve(request: ApprovalResolveRequest): Promise<ApprovalResolvedPayload>;
  handleTurnInterrupt(request: TurnInterruptRequest): Promise<TurnInterruptedPayload>;
  handleTurnStart(
    request: TurnStartRequest,
    callbacks: {
      onStatus: (payload: Omit<TurnStatusPayload, "requestId">) => void;
      onDelta: (payload: Omit<TurnDeltaPayload, "requestId">) => void;
      onCommandOutput: (payload: Omit<CommandOutputDeltaPayload, "requestId">) => void;
      onApprovalRequested: (payload: Omit<ApprovalRequestedPayload, "requestId">) => void;
    }
  ): Promise<TurnCompletedPayload>;
}

interface RelayClientIdentity {
  deviceId: string;
  accessToken: string;
}

export class RelayRequestHandlingError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = "RelayRequestHandlingError";
  }
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

export class RelayClient {
  private readonly agentVersion = getAgentVersion();
  private socket: WebSocket | null = null;
  private readonly heartbeat: NodeHeartbeat;
  private identity: RelayClientIdentity | null = null;
  private handlers: RelayClientHandlers | null = null;
  private latestHealthPayload: AgentHealthReportPayload | null = null;
  private shouldMaintainConnection = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private connectPromise: Promise<void> | null = null;
  private connectionStateReporter: RelayConnectionStateReporter | null = null;
  private lastConnectedAt: string | null = null;

  public constructor(
    private readonly relayUrl: string,
    private readonly logger: Logger
  ) {
    this.heartbeat = new NodeHeartbeat({
      label: "desktop-agent",
      logger: this.logger,
      onTick: () => {
        const ping: PingMessage = {
          id: createId("msg"),
          type: "ping",
          createdAt: nowInSeconds(),
          requiresAck: false,
          protocolVersion: PROTOCOL_VERSION,
          payload: { ts: nowInSeconds() }
        };
        this.send(ping);
      },
      onTimeout: () => {
        this.socket?.close();
        this.socket = null;
      }
    });
  }

  public bindConnectionStateReporter(reporter: RelayConnectionStateReporter): void {
    this.connectionStateReporter = reporter;
  }

  public async connect(
    identity: RelayClientIdentity,
    handlers: RelayClientHandlers
  ): Promise<void> {
    this.identity = identity;
    this.handlers = handlers;
    this.shouldMaintainConnection = true;
    this.clearReconnectTimer();

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.publishConnectionState({
      status: this.reconnectAttempt > 0 ? "reconnecting" : "connecting",
      reconnectAttempt: this.reconnectAttempt > 0 ? this.reconnectAttempt : 0
    });

    this.connectPromise = this.openConnection(identity, handlers)
      .catch((error) => {
        if (!this.shouldMaintainConnection) {
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        this.logger.error("initial relay connection attempt failed", {
          relayUrl: this.relayUrl,
          agentId: this.identity?.deviceId,
          message
        });
        this.scheduleReconnect(message);
      })
      .finally(() => {
        this.connectPromise = null;
      });

    return this.connectPromise;
  }

  private async openConnection(
    identity: RelayClientIdentity,
    handlers: RelayClientHandlers
  ): Promise<void> {
    this.logger.info("connecting to relay", { relayUrl: this.relayUrl, agentId: identity.deviceId });

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.relayUrl);
      this.socket = socket;

      let settled = false;

      socket.on("open", () => {
        this.logger.info("relay websocket opened", {
          relayUrl: this.relayUrl,
          agentId: identity.deviceId
        });
        const authMessage: AuthMessage = {
          id: createId("msg"),
          type: "auth",
          createdAt: nowInSeconds(),
          requiresAck: false,
          protocolVersion: PROTOCOL_VERSION,
          payload: {
            deviceType: "agent",
            deviceId: identity.deviceId,
            deviceToken: identity.accessToken,
            clientVersion: `desktop-agent/${this.agentVersion}`,
            runtimeType: "codex"
          }
        };
        socket.send(JSON.stringify(authMessage));
      });

      socket.on("message", async (data: RawData) => {
        const message = this.parseMessage(data.toString());
        if (!message) {
          return;
        }

        if (message.type === "auth_ok") {
          this.startHeartbeat();
          this.reconnectAttempt = 0;
          this.lastConnectedAt = new Date().toISOString();
          this.publishConnectionState({
            status: "online",
            lastConnectedAt: this.lastConnectedAt,
            reconnectAttempt: 0
          });
          this.flushLatestHealthReport();
          this.logger.info("relay authentication completed", {
            relayUrl: this.relayUrl,
            agentId: identity.deviceId,
            features: message.payload.features
          });
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }

        if (message.type === "pong") {
          this.heartbeat.acknowledge();
          return;
        }

        try {
          if (message.type === "thread_list_req") {
            const request = message as ThreadListRequest;
            this.logger.info("relay request received", messageLogContext(request, { agentId: identity.deviceId }));
            const payload = await handlers.handleThreadList(request);
            this.send({
              id: request.id,
              type: "thread_list_res",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload
            });
            return;
          }

          if (message.type === "thread_resume_req") {
            const request = message as ThreadResumeRequest;
            this.logger.info("relay request received", messageLogContext(request, { agentId: identity.deviceId }));
            const payload = await handlers.handleThreadResume(request);
            const response = {
              id: request.id,
              type: "thread_resume_res",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload
            } as const;
            const responseJson = JSON.stringify(response);
            this.logger.info(
              "sending relay thread resume response",
              messageLogContext(request, {
                agentId: identity.deviceId,
                payloadBytes: Buffer.byteLength(responseJson, "utf8"),
                requestedBeforeItemId: request.payload.beforeItemId ?? null,
                requestedWindowSize: request.payload.windowSize ?? null,
                ...summarizeThreadResumeResponse(payload)
              })
            );
            this.send(response);
            this.logger.info(
              "relay thread resume response sent",
              messageLogContext(request, {
                agentId: identity.deviceId,
                threadId: payload.threadId
              })
            );
            return;
          }

          if (message.type === "thread_create_req") {
            const request = message as ThreadCreateRequest;
            this.logger.info("relay request received", messageLogContext(request, { agentId: identity.deviceId }));
            const payload = await handlers.handleThreadCreate(request);
            this.send({
              id: request.id,
              type: "thread_create_res",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload
            });
            return;
          }

          if (message.type === "thread_archive_req") {
            const request = message as ThreadArchiveRequest;
            this.logger.info("relay request received", messageLogContext(request, { agentId: identity.deviceId }));
            const payload = await handlers.handleThreadArchive(request);
            this.send({
              id: request.id,
              type: "thread_archive_res",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload
            });
            return;
          }

          if (message.type === "turn_start_req") {
            const request = message as TurnStartRequest;
            this.logger.info(
              "relay request received",
              messageLogContext(request, {
                agentId: identity.deviceId,
                threadId: request.payload.threadId,
                inputCount: request.payload.inputs.length
              })
            );
            const payload = await handlers.handleTurnStart(request, {
              onStatus: (statusPayload) => {
                this.send({
                  id: createId("msg"),
                  type: "turn_status",
                  bindingId: request.bindingId,
                  createdAt: nowInSeconds(),
                  requiresAck: false,
                  protocolVersion: PROTOCOL_VERSION,
                  traceId: request.traceId,
                  payload: {
                    requestId: request.id,
                    ...statusPayload
                  }
                });
              },
              onDelta: (deltaPayload) => {
                this.send({
                  id: createId("msg"),
                  type: "turn_delta",
                  bindingId: request.bindingId,
                  createdAt: nowInSeconds(),
                  requiresAck: false,
                  protocolVersion: PROTOCOL_VERSION,
                  traceId: request.traceId,
                  payload: {
                    requestId: request.id,
                    ...deltaPayload
                  }
                });
              },
              onCommandOutput: (outputPayload) => {
                this.send({
                  id: createId("msg"),
                  type: "command_output_delta",
                  bindingId: request.bindingId,
                  createdAt: nowInSeconds(),
                  requiresAck: false,
                  protocolVersion: PROTOCOL_VERSION,
                  traceId: request.traceId,
                  payload: {
                    requestId: request.id,
                    ...outputPayload
                  }
                });
              },
              onApprovalRequested: (approvalPayload) => {
                this.send({
                  id: createId("msg"),
                  type: "approval_requested",
                  bindingId: request.bindingId,
                  createdAt: nowInSeconds(),
                  requiresAck: false,
                  protocolVersion: PROTOCOL_VERSION,
                  traceId: request.traceId,
                  payload: {
                    requestId: request.id,
                    ...approvalPayload
                  }
                });
              }
            });
            this.send({
              id: createId("msg"),
              type: "turn_completed",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload
            });
            return;
          }

          if (message.type === "approval_resolve_req") {
            const request = message as ApprovalResolveRequest;
            this.logger.info("relay request received", messageLogContext(request, { agentId: identity.deviceId }));
            const payload = await handlers.handleApprovalResolve(request);
            this.send({
              id: request.id,
              type: "approval_resolved",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload
            });
            return;
          }

          if (message.type === "turn_interrupt_req") {
            const request = message as TurnInterruptRequest;
            this.logger.info("relay request received", messageLogContext(request, { agentId: identity.deviceId }));
            const payload = await handlers.handleTurnInterrupt(request);
            this.send({
              id: request.id,
              type: "turn_interrupted",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload
            });
            return;
          }

          this.logger.debug("ignoring unsupported relay message", { type: message.type });
        } catch (error) {
          const request = message as
            | ThreadListRequest
            | ThreadCreateRequest
            | ThreadArchiveRequest
            | ThreadResumeRequest
            | TurnStartRequest
            | ApprovalResolveRequest
            | TurnInterruptRequest;
          const response: ErrorMessage = {
            id: request.id,
            type: "error",
            bindingId: request.bindingId,
            createdAt: nowInSeconds(),
            requiresAck: false,
            protocolVersion: PROTOCOL_VERSION,
            traceId: request.traceId,
            payload: {
              code: error instanceof RelayRequestHandlingError ? error.code : ERROR_CODES.agentOffline,
              message: error instanceof Error ? error.message : String(error)
            }
          };
          this.logger.warn(
            "relay request handling failed",
            messageLogContext(request, {
              agentId: identity.deviceId,
              error: error instanceof Error ? error.message : String(error)
            })
          );
          this.send(response);
        }
      });

      socket.on("close", () => {
        if (this.socket !== socket) {
          this.logger.debug("stale relay connection closed", { relayUrl: this.relayUrl });
          return;
        }

        this.heartbeat.stop();
        this.logger.warn("relay connection closed", {
          relayUrl: this.relayUrl,
          agentId: this.identity?.deviceId,
          reconnectAttempt: this.reconnectAttempt
        });
        this.socket = null;

        if (!settled) {
          settled = true;
          reject(new Error("relay connection closed before authentication completed"));
          return;
        }

        this.scheduleReconnect("relay connection closed");
      });

      socket.on("error", (error: Error) => {
        this.logger.error("relay websocket error", {
          relayUrl: this.relayUrl,
          agentId: this.identity?.deviceId,
          message: error.message
        });
        if (!settled) {
          settled = true;
          if (this.socket === socket) {
            this.socket = null;
          }
          reject(error);
          return;
        }

        this.scheduleReconnect(error.message);
      });
    });
  }

  public async disconnect(): Promise<void> {
    this.shouldMaintainConnection = false;
    this.clearReconnectTimer();
    this.heartbeat.stop();
    this.publishConnectionState({
      status: "offline",
      reconnectAttempt: 0
    });
    if (!this.socket) {
      return;
    }

    this.logger.info("disconnecting from relay", { relayUrl: this.relayUrl });
    this.socket.close();
    this.socket = null;
  }

  public reportHealth(payload: AgentHealthReportPayload): void {
    this.latestHealthPayload = payload;

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.logger.debug("skipping agent health report because relay socket is not open", {
        status: payload.status
      });
      return;
    }

    const message: AgentHealthReport = {
      id: createId("msg"),
      type: "agent_health_report",
      createdAt: nowInSeconds(),
      requiresAck: false,
      protocolVersion: PROTOCOL_VERSION,
      payload
    };

    this.logger.info("publishing agent health report", {
      relayUrl: this.relayUrl,
      agentId: this.identity?.deviceId,
      status: payload.status,
      reason: payload.reason,
      detail: payload.detail,
      consecutiveFailures: payload.consecutiveFailures
    });
    this.send(message);
  }

  private send(message: AppMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("relay socket is not open");
    }

    this.socket.send(JSON.stringify(message));
  }

  private parseMessage(raw: string): AppMessage | null {
    try {
      return JSON.parse(raw) as AppMessage;
    } catch (error) {
      this.logger.warn("failed to parse relay message", {
        raw,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private startHeartbeat(): void {
    this.heartbeat.start();
  }

  private flushLatestHealthReport(): void {
    if (!this.latestHealthPayload) {
      return;
    }

    try {
      const message: AgentHealthReport = {
        id: createId("msg"),
        type: "agent_health_report",
        createdAt: nowInSeconds(),
        requiresAck: false,
        protocolVersion: PROTOCOL_VERSION,
        payload: this.latestHealthPayload
      };
      this.logger.info("flushing latest health report after reconnect", {
        relayUrl: this.relayUrl,
        agentId: this.identity?.deviceId,
        status: this.latestHealthPayload.status,
        reason: this.latestHealthPayload.reason,
        detail: this.latestHealthPayload.detail,
        consecutiveFailures: this.latestHealthPayload.consecutiveFailures
      });
      this.send(message);
    } catch (error) {
      this.logger.debug("failed to flush latest health report after relay reconnect", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private scheduleReconnect(lastError?: string): void {
    if (!this.shouldMaintainConnection || this.reconnectTimer || !this.identity || !this.handlers) {
      return;
    }

    this.reconnectAttempt += 1;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt - 1, 5));
    const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    this.logger.warn("scheduling relay reconnect", {
      relayUrl: this.relayUrl,
      attempt: this.reconnectAttempt,
      delayMs,
      nextRetryAt,
      lastError
    });
    this.publishConnectionState({
      status: "reconnecting",
      lastError,
      nextRetryAt,
      reconnectAttempt: this.reconnectAttempt
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      if (!this.shouldMaintainConnection || !this.identity || !this.handlers) {
        return;
      }

      void this.connect(this.identity, this.handlers).catch((error) => {
        this.logger.error("relay reconnect attempt failed", {
          relayUrl: this.relayUrl,
          attempt: this.reconnectAttempt,
          message: error instanceof Error ? error.message : String(error)
        });
        this.scheduleReconnect(error instanceof Error ? error.message : String(error));
      });
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private publishConnectionState(input: {
    status: "connecting" | "online" | "reconnecting" | "offline";
    lastError?: string;
    nextRetryAt?: string;
    reconnectAttempt?: number;
    lastConnectedAt?: string;
  }): void {
    if (!this.connectionStateReporter) {
      return;
    }

    this.connectionStateReporter({
      relayUrl: this.relayUrl,
      status: input.status,
      lastError: input.lastError,
      nextRetryAt: input.nextRetryAt,
      reconnectAttempt: input.reconnectAttempt,
      lastConnectedAt: input.lastConnectedAt ?? this.lastConnectedAt ?? undefined
    });
  }
}
