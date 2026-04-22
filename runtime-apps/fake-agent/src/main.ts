import WebSocket, { type RawData } from "ws";

import {
  ERROR_CODES,
  PROTOCOL_VERSION,
  type AppMessage,
  type ApprovalResolveRequest,
  type ApprovalResolvedEvent,
  type AuthMessage,
  type ErrorMessage,
  type PingMessage,
  type PongMessage,
  type ThreadCreateRequest,
  type ThreadCreateResponse,
  type ThreadListRequest,
  type ThreadListResponse,
  type ThreadResumeRequest,
  type ThreadResumeResponse,
  type TurnCompletedEvent,
  type TurnDeltaEvent,
  type TurnInterruptRequest,
  type TurnInterruptedEvent,
  type TurnStartRequest,
  type TurnStatusEvent
} from "@kodexlink/protocol";
import {
  NodeHeartbeat,
  configureFileLogger,
  createId,
  createLogger,
  nowInSeconds
} from "@kodexlink/shared";

import { loadFakeAgentConfig } from "./config.js";
import { FakeRuntime, type ActiveTurn } from "./runtime.js";

configureFileLogger({
  appName: "fake-agent"
});

interface AgentIdentity {
  deviceId: string;
  deviceToken: string;
  relayBaseUrl: string;
}

function normalizeArgv(argv: string[]): string[] {
  return argv.filter((value) => value !== "--");
}

function toRelayWebSocketUrl(relayBaseUrl: string): string {
  const url = new URL(relayBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/v1/connect";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseMessage(raw: string): AppMessage | null {
  try {
    return JSON.parse(raw) as AppMessage;
  } catch {
    return null;
  }
}

function send(socket: WebSocket, message: AppMessage): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(message));
}

function sendError(
  socket: WebSocket,
  request: {
    id: string;
    bindingId?: string;
    traceId?: string;
  },
  message: string
): void {
  const payload: ErrorMessage = {
    id: request.id,
    type: "error",
    bindingId: request.bindingId,
    createdAt: nowInSeconds(),
    requiresAck: false,
    protocolVersion: PROTOCOL_VERSION,
    traceId: request.traceId,
    payload: {
      code: ERROR_CODES.internalError,
      message
    }
  };
  send(socket, payload);
}

async function bootstrapIdentity(relayHttpBaseUrl: string, agentId: string, deviceName: string): Promise<AgentIdentity> {
  const response = await fetch(`${relayHttpBaseUrl}/v1/agents/bootstrap`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      deviceId: agentId,
      deviceName
    })
  });

  if (!response.ok) {
    throw new Error(`bootstrap failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    deviceId: string;
    deviceToken: string;
    relayUrl: string;
  };

  return {
    deviceId: payload.deviceId,
    deviceToken: payload.deviceToken,
    relayBaseUrl: payload.relayUrl
  };
}

async function streamTurn(
  socket: WebSocket,
  runtime: FakeRuntime,
  request: TurnStartRequest,
  turn: ActiveTurn,
  deltaChunks: number,
  deltaDelayMs: number
): Promise<void> {
  const baseLine = `fake-codex 已接收请求（thread=${request.payload.threadId}）`;
  const lines: string[] = [];

  try {
    const statusStarting: TurnStatusEvent = {
      id: createId("msg"),
      type: "turn_status",
      bindingId: request.bindingId,
      createdAt: nowInSeconds(),
      requiresAck: false,
      protocolVersion: PROTOCOL_VERSION,
      traceId: request.traceId,
      payload: {
        requestId: request.id,
        threadId: request.payload.threadId,
        turnId: turn.turnId,
        status: "starting",
        detail: "fake-agent start"
      }
    };
    send(socket, statusStarting);

    const statusStreaming: TurnStatusEvent = {
      id: createId("msg"),
      type: "turn_status",
      bindingId: request.bindingId,
      createdAt: nowInSeconds(),
      requiresAck: false,
      protocolVersion: PROTOCOL_VERSION,
      traceId: request.traceId,
      payload: {
        requestId: request.id,
        threadId: request.payload.threadId,
        turnId: turn.turnId,
        status: "streaming",
        detail: "fake-agent streaming"
      }
    };
    send(socket, statusStreaming);

    for (let i = 0; i < deltaChunks; i += 1) {
      const active = runtime.getActiveTurn(request.id);
      if (!active || active.interrupted) {
        break;
      }

      const delta = `${baseLine} | chunk ${i + 1}/${deltaChunks}\n`;
      lines.push(delta);

      const event: TurnDeltaEvent = {
        id: createId("msg"),
        type: "turn_delta",
        bindingId: request.bindingId,
        createdAt: nowInSeconds(),
        requiresAck: false,
        protocolVersion: PROTOCOL_VERSION,
        traceId: request.traceId,
        payload: {
          requestId: request.id,
          threadId: request.payload.threadId,
          turnId: turn.turnId,
          delta
        }
      };
      send(socket, event);
      await sleep(deltaDelayMs);
    }

    const latest = runtime.getActiveTurn(request.id);
    const interrupted = !latest || latest.interrupted;
    const fullText = lines.join("");

    if (!interrupted && fullText.trim()) {
      runtime.appendAssistantMessage(request.payload.threadId, fullText, turn.turnId);
    }

    const doneStatus: TurnStatusEvent = {
      id: createId("msg"),
      type: "turn_status",
      bindingId: request.bindingId,
      createdAt: nowInSeconds(),
      requiresAck: false,
      protocolVersion: PROTOCOL_VERSION,
      traceId: request.traceId,
      payload: {
        requestId: request.id,
        threadId: request.payload.threadId,
        turnId: turn.turnId,
        status: interrupted ? "interrupted" : "completed",
        detail: interrupted ? "interrupted by client" : "fake-agent completed"
      }
    };
    send(socket, doneStatus);

    const completed: TurnCompletedEvent = {
      id: createId("msg"),
      type: "turn_completed",
      bindingId: request.bindingId,
      createdAt: nowInSeconds(),
      requiresAck: false,
      protocolVersion: PROTOCOL_VERSION,
      traceId: request.traceId,
      payload: {
        requestId: request.id,
        threadId: request.payload.threadId,
        turnId: turn.turnId,
        status: interrupted ? "interrupted" : "completed",
        text: fullText
      }
    };
    send(socket, completed);
  } finally {
    runtime.endTurn(request.id);
  }
}

async function runSession(
  relayWsUrl: string,
  identity: AgentIdentity,
  clientVersion: string,
  runtime: FakeRuntime,
  deltaChunks: number,
  deltaDelayMs: number
): Promise<void> {
  const logger = createLogger("fake-agent");

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(relayWsUrl);
    let authenticated = false;
    const heartbeat = new NodeHeartbeat({
      label: "fake-agent",
      logger,
      onTick: () => {
        if (socket.readyState !== WebSocket.OPEN) {
          heartbeat.stop();
          return;
        }

        const ping: PingMessage = {
          id: createId("msg"),
          type: "ping",
          createdAt: nowInSeconds(),
          requiresAck: false,
          protocolVersion: PROTOCOL_VERSION,
          payload: { ts: nowInSeconds() }
        };
        send(socket, ping);
      },
      onTimeout: () => {
        logger.error("fake-agent heartbeat timeout, closing websocket", { relayWsUrl });
        socket.close();
      }
    });

    socket.on("open", () => {
      const auth: AuthMessage = {
        id: createId("msg"),
        type: "auth",
        createdAt: nowInSeconds(),
        requiresAck: false,
        protocolVersion: PROTOCOL_VERSION,
        payload: {
          deviceType: "agent",
          deviceId: identity.deviceId,
          deviceToken: identity.deviceToken,
          clientVersion,
          runtimeType: "codex"
        }
      };
      send(socket, auth);
    });

    socket.on("message", (data: RawData) => {
      const message = parseMessage(data.toString());
      if (!message) {
        return;
      }

      if (message.type === "auth_ok") {
        authenticated = true;
        logger.info("fake-agent authenticated", { agentId: identity.deviceId, relayWsUrl });
        heartbeat.start();
        return;
      }

      if (message.type === "pong") {
        heartbeat.acknowledge();
        return;
      }

      void (async () => {
        try {
          if (message.type === "thread_list_req") {
            const request = message as ThreadListRequest;
            const payload = runtime.listThreads(request.payload.limit, request.payload.cursor);
            const response: ThreadListResponse = {
              id: request.id,
              type: "thread_list_res",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload
            };
            send(socket, response);
            return;
          }

          if (message.type === "thread_create_req") {
            const request = message as ThreadCreateRequest;
            const thread = runtime.createThread(request.payload);
            const response: ThreadCreateResponse = {
              id: request.id,
              type: "thread_create_res",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload: { thread }
            };
            send(socket, response);
            return;
          }

          if (message.type === "thread_resume_req") {
            const request = message as ThreadResumeRequest;
            runtime.ensureThread(request.payload.threadId);
            const payload = runtime.resumeThread(request.payload.threadId);
            if (!payload) {
              sendError(socket, request, "thread not found");
              return;
            }
            const response: ThreadResumeResponse = {
              id: request.id,
              type: "thread_resume_res",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload
            };
            send(socket, response);
            return;
          }

          if (message.type === "turn_start_req") {
            const request = message as TurnStartRequest;
            runtime.ensureThread(request.payload.threadId);
            const activeTurn = runtime.beginTurn(request.id, request.payload.threadId);
            runtime.appendUserMessage(request.payload.threadId, request.payload.inputs, activeTurn.turnId);
            void streamTurn(socket, runtime, request, activeTurn, deltaChunks, deltaDelayMs);
            return;
          }

          if (message.type === "turn_interrupt_req") {
            const request = message as TurnInterruptRequest;
            const interrupted = runtime.markInterruptedByTurn(
              request.payload.threadId,
              request.payload.turnId
            );
            if (interrupted) {
              const statusEvent: TurnStatusEvent = {
                id: createId("msg"),
                type: "turn_status",
                bindingId: request.bindingId,
                createdAt: nowInSeconds(),
                requiresAck: false,
                protocolVersion: PROTOCOL_VERSION,
                traceId: request.traceId,
                payload: {
                  requestId: interrupted.requestId,
                  threadId: interrupted.threadId,
                  turnId: interrupted.turnId,
                  status: "interrupting",
                  detail: "interrupt requested"
                }
              };
              send(socket, statusEvent);
            }

            const response: TurnInterruptedEvent = {
              id: request.id,
              type: "turn_interrupted",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload: {
                requestId: request.id,
                threadId: request.payload.threadId,
                turnId: request.payload.turnId
              }
            };
            send(socket, response);
            return;
          }

          if (message.type === "approval_resolve_req") {
            const request = message as ApprovalResolveRequest;
            const response: ApprovalResolvedEvent = {
              id: request.id,
              type: "approval_resolved",
              bindingId: request.bindingId,
              createdAt: nowInSeconds(),
              requiresAck: false,
              protocolVersion: PROTOCOL_VERSION,
              traceId: request.traceId,
              payload: {
                requestId: request.id,
                approvalId: request.payload.approvalId,
                threadId: request.payload.threadId,
                turnId: request.payload.turnId,
                decision: request.payload.decision
              }
            };
            send(socket, response);
            return;
          }
        } catch (error) {
          const request = message as { id: string; bindingId?: string; traceId?: string };
          sendError(socket, request, error instanceof Error ? error.message : String(error));
        }
      })();
    });

    socket.on("error", (error: Error) => {
      if (!authenticated) {
        reject(error);
        return;
      }
      logger.error("fake-agent socket error", { message: error.message });
    });

    socket.on("close", () => {
      heartbeat.stop();
      logger.warn("fake-agent disconnected from relay", { relayWsUrl });
      resolve();
    });
  });
}

async function serve(): Promise<void> {
  const config = loadFakeAgentConfig();
  const logger = createLogger("fake-agent");
  const identity = await bootstrapIdentity(config.relayHttpBaseUrl, config.agentId, config.deviceName);
  const relayWsUrl = toRelayWebSocketUrl(identity.relayBaseUrl);

  logger.info("fake-agent ready", {
    agentId: identity.deviceId,
    relayWsUrl,
    deltaChunks: config.deltaChunks,
    deltaDelayMs: config.deltaDelayMs
  });

  for (;;) {
    try {
      await runSession(
        relayWsUrl,
        identity,
        config.clientVersion,
        new FakeRuntime(config),
        config.deltaChunks,
        config.deltaDelayMs
      );
    } catch (error) {
      logger.error("fake-agent session failed", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
    await sleep(1000);
  }
}

async function main(): Promise<void> {
  const argv = normalizeArgv(process.argv.slice(2));
  const command = argv[0] ?? "serve";

  if (command === "serve") {
    await serve();
    return;
  }

  throw new Error(`unsupported fake-agent command: ${command}`);
}

void main().catch((error: unknown) => {
  const logger = createLogger("fake-agent");
  logger.error("fake-agent exited with error", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
