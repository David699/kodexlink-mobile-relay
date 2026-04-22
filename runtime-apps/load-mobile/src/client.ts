import { randomUUID } from "node:crypto";

import WebSocket, { type RawData } from "ws";

import {
  PROTOCOL_VERSION,
  type AppMessage,
  type AuthMessage,
  type ErrorMessage,
  type PingMessage,
  type ThreadCreateRequest,
  type ThreadCreateResponse,
  type TurnCompletedEvent,
  type TurnStartRequest
} from "@kodexlink/protocol";
import { NodeHeartbeat, nowInSeconds, type Logger } from "@kodexlink/shared";

export interface AgentIdentity {
  deviceId: string;
  deviceToken: string;
  relayUrl: string;
}

export interface MobileIdentity {
  deviceId: string;
  deviceToken: string;
  relayUrl: string;
}

interface BootstrapIdentityResponse {
  deviceId: string;
  accessToken?: string;
  deviceToken?: string;
  relayUrl: string;
}

export interface PairingPayload {
  pairingId: string;
  pairingSecret: string;
}

interface PendingRequest {
  expectedType: string;
  resolve: (message: AppMessage) => void;
  reject: (error: Error) => void;
}

interface PendingTurn {
  startedAtMs: number;
  timeout: NodeJS.Timeout;
  resolve: (result: TurnResult) => void;
  reject: (error: Error) => void;
}

export interface TurnResult {
  requestId: string;
  threadId: string;
  turnId: string;
  status: "completed" | "failed" | "interrupted";
  durationMs: number;
}

function createRequestId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

async function postJson<TPayload, TResult>(
  url: string,
  payload: TPayload,
  headers: Record<string, string> = {}
): Promise<TResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  return (await response.json()) as TResult;
}

function toIdentity(payload: BootstrapIdentityResponse): AgentIdentity {
  const deviceToken = payload.accessToken ?? payload.deviceToken;
  if (!deviceToken) {
    throw new Error("bootstrap response is missing access token");
  }

  return {
    deviceId: payload.deviceId,
    deviceToken,
    relayUrl: payload.relayUrl
  };
}

export async function bootstrapAgent(relayHttpBaseUrl: string, agentId: string): Promise<AgentIdentity> {
  const payload = await postJson<{ deviceId: string; deviceName: string }, BootstrapIdentityResponse>(
    `${relayHttpBaseUrl}/v1/agents/bootstrap`,
    {
      deviceId: agentId,
      deviceName: `load-agent-${agentId}`
    }
  );

  return toIdentity(payload);
}

export async function bootstrapMobile(relayHttpBaseUrl: string, mobileId: string): Promise<MobileIdentity> {
  const payload = await postJson<{ deviceId: string; deviceName: string }, BootstrapIdentityResponse>(
    `${relayHttpBaseUrl}/v1/mobile-devices/bootstrap`,
    {
      deviceId: mobileId,
      deviceName: `load-mobile-${mobileId}`
    }
  );

  return toIdentity(payload);
}

export async function createPairing(
  relayHttpBaseUrl: string,
  agentIdentity: AgentIdentity,
  agentLabel: string
): Promise<PairingPayload> {
  return postJson<{ agentLabel: string }, PairingPayload>(
    `${relayHttpBaseUrl}/v1/pairings`,
    { agentLabel },
    {
      "x-device-id": agentIdentity.deviceId,
      "x-device-token": agentIdentity.deviceToken
    }
  );
}

export async function claimPairing(
  relayHttpBaseUrl: string,
  mobileIdentity: MobileIdentity,
  pairing: PairingPayload,
  displayName: string
): Promise<string> {
  const result = await postJson<
    { pairingId: string; pairingSecret: string; displayName: string },
    { bindingId: string }
  >(
    `${relayHttpBaseUrl}/v1/pairings/claim`,
    {
      pairingId: pairing.pairingId,
      pairingSecret: pairing.pairingSecret,
      displayName
    },
    {
      "x-device-id": mobileIdentity.deviceId,
      "x-device-token": mobileIdentity.deviceToken
    }
  );
  return result.bindingId;
}

export class MobileLoadClient {
  private readonly wsUrl: string;
  private readonly turnTimeoutMs: number;
  private readonly logger: Logger;
  private readonly heartbeat: NodeHeartbeat;

  private socket: WebSocket | null = null;
  private bindingId: string | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingTurns = new Map<string, PendingTurn>();
  private pendingAuth:
    | {
        requestId: string;
        resolve: () => void;
        reject: (error: Error) => void;
      }
    | undefined;

  public constructor(wsUrl: string, turnTimeoutMs: number, logger: Logger) {
    this.wsUrl = wsUrl;
    this.turnTimeoutMs = turnTimeoutMs;
    this.logger = logger;
    this.heartbeat = new NodeHeartbeat({
      label: "load-mobile",
      logger: this.logger,
      onTick: () => {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          this.heartbeat.stop();
          return;
        }

        const ping: PingMessage = {
          id: createRequestId("ping"),
          type: "ping",
          createdAt: nowInSeconds(),
          requiresAck: false,
          protocolVersion: PROTOCOL_VERSION,
          payload: { ts: nowInSeconds() }
        };
        this.send(ping);
      },
      onTimeout: () => {
        this.logger.error("load-mobile heartbeat timeout, closing websocket");
        this.close();
      }
    });
  }

  public async connect(mobileIdentity: MobileIdentity, bindingId: string): Promise<void> {
    this.bindingId = bindingId;
    const socket = new WebSocket(this.wsUrl);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const authRequestId = createRequestId("auth");
      this.pendingAuth = {
        requestId: authRequestId,
        resolve,
        reject
      };

      socket.on("open", () => {
        const auth: AuthMessage = {
          id: authRequestId,
          type: "auth",
          createdAt: nowInSeconds(),
          requiresAck: false,
          protocolVersion: PROTOCOL_VERSION,
          payload: {
            deviceType: "mobile",
            deviceId: mobileIdentity.deviceId,
            deviceToken: mobileIdentity.deviceToken,
            clientVersion: "load-mobile/0.1.0"
          }
        };
        this.send(auth);
      });

      socket.on("message", (data: RawData) => {
        this.handleMessage(data.toString());
      });

      socket.on("error", (error: Error) => {
        if (this.pendingAuth) {
          this.pendingAuth.reject(error);
          this.pendingAuth = undefined;
          return;
        }
        this.rejectAllPending(error);
      });

      socket.on("close", () => {
        const err = new Error("mobile websocket closed");
        if (this.pendingAuth) {
          this.pendingAuth.reject(err);
          this.pendingAuth = undefined;
        }
        this.rejectAllPending(err);
      });
    });
  }

  public async createThread(cwd?: string): Promise<string> {
    const requestId = createRequestId("thread");
    const request: ThreadCreateRequest = {
      id: requestId,
      type: "thread_create_req",
      bindingId: this.requireBindingId(),
      createdAt: nowInSeconds(),
      requiresAck: true,
      protocolVersion: PROTOCOL_VERSION,
      idempotencyKey: createRequestId("idem"),
      payload: {
        cwd: cwd ?? undefined
      }
    };
    const response = (await this.sendRequest(request, "thread_create_res")) as ThreadCreateResponse;
    return response.payload.thread.id;
  }

  public async startTurn(threadId: string, text: string): Promise<TurnResult> {
    const requestId = createRequestId("turn");
    const payload: TurnStartRequest = {
      id: requestId,
      type: "turn_start_req",
      bindingId: this.requireBindingId(),
      createdAt: nowInSeconds(),
      requiresAck: true,
      protocolVersion: PROTOCOL_VERSION,
      idempotencyKey: createRequestId("idem"),
      payload: {
        threadId,
        inputs: [{ type: "text", text }]
      }
    };

    return new Promise<TurnResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTurns.delete(requestId);
        reject(new Error(`turn timeout: ${requestId}`));
      }, this.turnTimeoutMs);

      this.pendingTurns.set(requestId, {
        startedAtMs: Date.now(),
        timeout,
        resolve,
        reject
      });

      this.send(payload);
    });
  }

  public close(): void {
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  }

  private sendRequest(request: AppMessage, expectedType: string): Promise<AppMessage> {
    return new Promise<AppMessage>((resolve, reject) => {
      this.pendingRequests.set(request.id, { expectedType, resolve, reject });
      this.send(request);
    });
  }

  private handleMessage(raw: string): void {
    let message: AppMessage | null = null;
    try {
      message = JSON.parse(raw) as AppMessage;
    } catch (error) {
      this.logger.warn("ignore invalid ws payload", {
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    if (!message) {
      return;
    }

    if (message.type === "auth_ok") {
      if (this.pendingAuth && this.pendingAuth.requestId === message.id) {
        this.startHeartbeat();
        this.pendingAuth.resolve();
        this.pendingAuth = undefined;
      }
      return;
    }

    if (message.type === "pong") {
      this.heartbeat.acknowledge();
      return;
    }

    if (message.type === "error") {
      const errorMessage = message as ErrorMessage;

      if (this.pendingAuth && this.pendingAuth.requestId === errorMessage.id) {
        this.pendingAuth.reject(new Error(errorMessage.payload.message));
        this.pendingAuth = undefined;
        return;
      }

      const pendingRequest = this.pendingRequests.get(errorMessage.id);
      if (pendingRequest) {
        this.pendingRequests.delete(errorMessage.id);
        pendingRequest.reject(new Error(errorMessage.payload.message));
        return;
      }

      const pendingTurn = this.pendingTurns.get(errorMessage.id);
      if (pendingTurn) {
        clearTimeout(pendingTurn.timeout);
        this.pendingTurns.delete(errorMessage.id);
        pendingTurn.reject(new Error(errorMessage.payload.message));
      }
      return;
    }

    const maybeRequest = this.pendingRequests.get(message.id);
    if (maybeRequest) {
      this.pendingRequests.delete(message.id);
      if (message.type !== maybeRequest.expectedType) {
        maybeRequest.reject(
          new Error(`unexpected response type: expected=${maybeRequest.expectedType} actual=${message.type}`)
        );
      } else {
        maybeRequest.resolve(message);
      }
      return;
    }

    if (message.type === "turn_completed") {
      const event = message as TurnCompletedEvent;
      const pendingTurn = this.pendingTurns.get(event.payload.requestId);
      if (!pendingTurn) {
        return;
      }
      clearTimeout(pendingTurn.timeout);
      this.pendingTurns.delete(event.payload.requestId);
      pendingTurn.resolve({
        requestId: event.payload.requestId,
        threadId: event.payload.threadId,
        turnId: event.payload.turnId,
        status: event.payload.status,
        durationMs: Date.now() - pendingTurn.startedAtMs
      });
    }
  }

  private send(message: AppMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("mobile socket is not connected");
    }
    this.socket.send(JSON.stringify(message));
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();

    for (const pending of this.pendingTurns.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingTurns.clear();
  }

  private requireBindingId(): string {
    if (!this.bindingId) {
      throw new Error("bindingId not set");
    }
    return this.bindingId;
  }

  private startHeartbeat(): void {
    this.heartbeat.start();
  }

  private stopHeartbeat(): void {
    this.heartbeat.stop();
  }
}
