import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type {
  AssistantMessageSegment,
  ApprovalDecision,
  ApprovalKind,
  ThreadMessage,
  ThreadSummary,
  ThreadTimelineItem,
  TurnInputItem,
  TurnStatusValue
} from "@kodexlink/protocol";
import type { Logger } from "@kodexlink/shared";

import { getAgentVersion } from "../product/agent-version.js";
import { spawnCommand } from "../platform/command-utils.js";

type JsonRpcRequestId = number | string;

interface JsonRpcSuccessResponse<TResult = unknown> {
  id: number;
  result?: TResult;
}

interface JsonRpcErrorResponse {
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse;

interface JsonRpcNotification<TParams = unknown> {
  method: string;
  params: TParams;
}

interface JsonRpcServerRequest<TParams = unknown> {
  id: JsonRpcRequestId;
  method: string;
  params: TParams;
}

type TextContentItem = { type: "text"; text: string };
type UnknownContentItem = { type: string; text?: string };

interface ThreadListRpcResult {
  data: ThreadSummary[];
  nextCursor?: string;
}

interface ThreadListPage {
  items: ThreadSummary[];
  nextCursor?: string;
}

type ResumeThreadItem =
  | {
      type: "userMessage";
      id: string;
      content: Array<TextContentItem | UnknownContentItem>;
    }
  | {
      type: "agentMessage";
      id: string;
      text: string;
    }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      aggregatedOutput?: string | null;
      status: string;
    }
  | {
      type: "fileChange";
      id: string;
      aggregatedOutput?: string | null;
      status: string;
    }
  | {
      type: string;
      id: string;
    };

interface ThreadResumeRpcResult {
  thread: {
    id: string;
    cwd: string;
    turns: Array<{
      id: string;
      items: ResumeThreadItem[];
    }>;
  };
  cwd: string;
}

interface ThreadResumeResult {
  threadId: string;
  cwd: string;
  messages: ThreadMessage[];
  timelineItems: ThreadTimelineItem[];
}

interface ThreadStartRpcResult {
  thread: ThreadSummary;
}

interface ThreadArchiveRpcResult {}

interface TurnStartRpcResult {
  turn: {
    id: string;
    status: string;
    error: {
      message: string;
    } | null;
  };
}

interface TurnInterruptRpcResult {}

interface TurnResult {
  threadId: string;
  turnId: string;
  status: "completed" | "failed" | "interrupted";
  text: string;
  segments?: AssistantMessageSegment[];
  errorMessage?: string;
}

interface ApprovalRequest {
  approvalId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  kind: ApprovalKind;
  reason?: string;
  command?: string;
  cwd?: string;
  aggregatedOutput?: string;
  grantRoot?: string;
  proposedExecpolicyAmendment?: string[];
}

interface ApprovalResult {
  approvalId: string;
  threadId: string;
  turnId: string;
  decision: ApprovalDecision;
}

interface InterruptResult {
  threadId: string;
  turnId: string;
}

type OutputSource = "commandExecution" | "fileChange";

interface TurnCallbacks {
  onStatus?: (payload: {
    threadId: string;
    turnId?: string;
    status: TurnStatusValue;
    detail?: string;
    itemId?: string;
  }) => void;
  onDelta?: (payload: {
    threadId: string;
    turnId: string;
    itemId: string;
    delta: string;
  }) => void;
  onCommandOutput?: (payload: {
    threadId: string;
    turnId: string;
    itemId: string;
    delta: string;
    source: OutputSource;
  }) => void;
  onApprovalRequested?: (payload: ApprovalRequest) => void;
}

interface PendingAssistantMessageSegment {
  itemId: string;
  textBuffer: string;
  finalText?: string;
}

interface PendingTurn extends TurnCallbacks {
  rpcRequestId: number;
  threadId: string;
  turnId?: string;
  assistantSegments: Map<string, PendingAssistantMessageSegment>;
  assistantSegmentOrder: string[];
  pendingInterrupt: boolean;
  itemStates: Map<string, TurnItemState>;
  approvalIds: Set<string>;
  resolve: (value: TurnResult) => void;
  reject: (reason?: unknown) => void;
}

interface TurnItemState {
  kind: OutputSource;
  itemId: string;
  command?: string;
  cwd?: string;
  aggregatedOutput: string;
  grantRoot?: string;
}

interface PendingApprovalRequest {
  requestId: JsonRpcRequestId;
  turn: PendingTurn;
  payload: ApprovalRequest;
}

interface TurnStartedNotification {
  threadId: string;
  turn: {
    id: string;
  };
}

interface TurnCompletedNotification {
  threadId: string;
  turn: {
    id: string;
    status: "completed" | "failed" | "interrupted" | string;
    error: {
      message: string;
    } | null;
  };
}

interface AgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

interface CommandExecutionOutputDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

interface FileChangeOutputDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

interface TerminalInteractionNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  processId: string;
  stdin: string;
}

type StartedThreadItem =
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      aggregatedOutput?: string | null;
      status: string;
    }
  | {
      type: "fileChange";
      id: string;
      aggregatedOutput?: string | null;
      status: string;
    }
  | {
      type: string;
      id: string;
    };

interface ItemStartedNotification {
  threadId: string;
  turnId: string;
  item: StartedThreadItem;
}

type CompletedThreadItem =
  | {
      type: "agentMessage";
      id: string;
      text: string;
    }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      aggregatedOutput?: string | null;
      status: string;
    }
  | {
      type: "fileChange";
      id: string;
      aggregatedOutput?: string | null;
      status: string;
    }
  | {
      type: string;
      id: string;
    };

interface ItemCompletedNotification {
  threadId: string;
  turnId: string;
  item: CompletedThreadItem;
}

interface CommandExecutionRequestApprovalParams {
  itemId: string;
  threadId: string;
  turnId: string;
  reason?: string | null;
  proposedExecpolicyAmendment?: string[] | null;
}

interface FileChangeRequestApprovalParams {
  itemId: string;
  threadId: string;
  turnId: string;
  reason?: string | null;
  grantRoot?: string | null;
}

interface CodexClientLifecycleObserver {
  onRuntimeAvailable?: (detail: string) => void;
  onRuntimeUnavailable?: (detail: string) => void;
}

function isJsonRpcNotification(
  message: JsonRpcResponse | JsonRpcNotification | JsonRpcServerRequest
): message is JsonRpcNotification {
  return "method" in message && !("id" in message);
}

function isJsonRpcServerRequest(
  message: JsonRpcResponse | JsonRpcNotification | JsonRpcServerRequest
): message is JsonRpcServerRequest {
  return "method" in message && "id" in message;
}

function isJsonRpcResponse(
  message: JsonRpcResponse | JsonRpcNotification | JsonRpcServerRequest
): message is JsonRpcResponse {
  return !("method" in message) && "id" in message;
}

function isUserMessageItem(
  item: ResumeThreadItem
): item is Extract<ResumeThreadItem, { type: "userMessage" }> {
  return item.type === "userMessage";
}

function isAssistantMessageItem(
  item: ResumeThreadItem
): item is Extract<ResumeThreadItem, { type: "agentMessage" }> {
  return item.type === "agentMessage";
}

function isTextContentItem(item: TextContentItem | UnknownContentItem): item is TextContentItem {
  return item.type === "text";
}

function isAgentMessageItem(
  item: ResumeThreadItem | CompletedThreadItem
): item is
  | Extract<ResumeThreadItem, { type: "agentMessage" }>
  | Extract<CompletedThreadItem, { type: "agentMessage" }> {
  return item.type === "agentMessage";
}

function isCommandExecutionItem(
  item: ResumeThreadItem | StartedThreadItem | CompletedThreadItem
): item is
  | Extract<ResumeThreadItem, { type: "commandExecution" }>
  | Extract<StartedThreadItem, { type: "commandExecution" }>
  | Extract<CompletedThreadItem, { type: "commandExecution" }> {
  return item.type === "commandExecution";
}

function isFileChangeItem(
  item: ResumeThreadItem | StartedThreadItem | CompletedThreadItem
): item is
  | Extract<ResumeThreadItem, { type: "fileChange" }>
  | Extract<StartedThreadItem, { type: "fileChange" }>
  | Extract<CompletedThreadItem, { type: "fileChange" }> {
  return item.type === "fileChange";
}

function normalizeApprovalId(requestId: JsonRpcRequestId): string {
  return String(requestId);
}

function deduplicateThreads(items: ThreadSummary[]): ThreadSummary[] {
  const threadsById = new Map<string, ThreadSummary>();

  for (const item of items) {
    const existing = threadsById.get(item.id);

    if (!existing || item.createdAt > existing.createdAt) {
      threadsById.set(item.id, item);
    }
  }

  return Array.from(threadsById.values());
}

export class CodexClient {
  private readonly interruptCompletionFallbackMs = 1500;
  private readonly agentVersion = getAgentVersion();
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private started = false;
  private pendingTurnsByRpcId = new Map<number, PendingTurn>();
  private pendingTurnsByTurnId = new Map<string, PendingTurn>();
  private pendingApprovalsById = new Map<string, PendingApprovalRequest>();

  public constructor(
    private readonly command: string,
    private readonly logger: Logger,
    private readonly lifecycleObserver: CodexClientLifecycleObserver = {}
  ) {}

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.logger.info("starting codex runtime", { command: this.command });
    this.process = spawnCommand(this.command, ["app-server"], {
      windowsHide: true
    });
    this.logger.info("codex runtime spawned", {
      command: this.command,
      pid: this.process.pid
    });

    this.process.on("error", (error) => {
      this.logger.error("codex process error", {
        message: error.message
      });
      this.lifecycleObserver.onRuntimeUnavailable?.(`codex app-server 进程异常：${error.message}`);
    });

    this.process.on("exit", (code, signal) => {
      this.logger.info("codex process exited", {
        code,
        signal,
        pendingRequestCount: this.pending.size,
        pendingTurnCount: this.pendingTurnsByRpcId.size
      });
      this.lifecycleObserver.onRuntimeUnavailable?.(
        `codex app-server 已退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`
      );
      this.process = null;
      this.started = false;
      for (const pending of this.pending.values()) {
        pending.reject(new Error("codex app-server exited before replying"));
      }
      this.pending.clear();

      for (const pendingTurn of this.pendingTurnsByRpcId.values()) {
        pendingTurn.reject(new Error("codex app-server exited before turn completed"));
      }
      this.pendingTurnsByRpcId.clear();
      this.pendingTurnsByTurnId.clear();
      this.pendingApprovalsById.clear();
    });

    const stdout = createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity
    });
    stdout.on("line", (line) => this.handleStdoutLine(line));

    const stderr = createInterface({
      input: this.process.stderr,
      crlfDelay: Infinity
    });
    stderr.on("line", (line) => {
      this.logger.warn("codex stderr", { line });
    });

    const initializeId = this.nextId();
    this.write({
      jsonrpc: "2.0",
      id: initializeId,
      method: "initialize",
        params: {
          clientInfo: {
            name: "kodexlink",
            title: "KodexLink",
            version: this.agentVersion
          }
        }
      });
    await this.waitForResponse(initializeId);

    this.write({
      jsonrpc: "2.0",
      method: "initialized",
      params: {}
    });

    this.started = true;
    this.lifecycleObserver.onRuntimeAvailable?.("codex app-server 已初始化");
    this.logger.info("codex runtime initialized", {
      pid: this.process.pid
    });
  }

  public async listThreads(limit = 20, cursor?: string): Promise<ThreadListPage> {
    if (!this.process) {
      await this.start();
    }

    const requestId = this.nextId();
    this.logger.info("requesting codex thread list", {
      requestId,
      limit,
      cursor
    });
    this.write({
      jsonrpc: "2.0",
      id: requestId,
      method: "thread/list",
      params: {
        cursor: cursor ?? null,
        limit,
        modelProviders: null
      }
    });

    const response = await this.waitForResponse<ThreadListRpcResult>(requestId);
    this.logger.info("received codex thread list", {
      requestId,
      itemCount: response.data.length,
      nextCursor: response.nextCursor
    });

    return {
      items: deduplicateThreads(response.data),
      nextCursor: response.nextCursor
    };
  }

  public async createThread(cwd?: string): Promise<ThreadSummary> {
    if (!this.process) {
      await this.start();
    }

    const requestId = this.nextId();
    this.logger.info("requesting codex thread start", {
      requestId,
      cwd
    });
    this.write({
      jsonrpc: "2.0",
      id: requestId,
      method: "thread/start",
      params: {
        cwd: cwd ?? null,
        model: null,
        modelProvider: null,
        approvalPolicy: null,
        sandbox: null,
        config: null,
        baseInstructions: null,
        developerInstructions: null,
        experimentalRawEvents: false
      }
    });

    const response = await this.waitForResponse<ThreadStartRpcResult>(requestId);
    this.logger.info("received codex thread start", {
      requestId,
      threadId: response.thread.id,
      cwd: response.thread.cwd
    });
    return response.thread;
  }

  public async archiveThread(threadId: string): Promise<{ threadId: string }> {
    if (!this.process) {
      await this.start();
    }

    const requestId = this.nextId();
    this.logger.info("requesting codex thread archive", {
      requestId,
      threadId
    });
    this.write({
      jsonrpc: "2.0",
      id: requestId,
      method: "thread/archive",
      params: {
        threadId
      }
    });

    await this.waitForResponse<ThreadArchiveRpcResult>(requestId);
    this.logger.info("received codex thread archive result", {
      requestId,
      threadId
    });

    return {
      threadId
    };
  }

  public async resumeThread(threadId: string): Promise<ThreadResumeResult> {
    if (!this.process) {
      await this.start();
    }

    const requestId = this.nextId();
    this.logger.info("requesting codex thread resume", {
      requestId,
      threadId
    });
    this.write({
      jsonrpc: "2.0",
      id: requestId,
      method: "thread/resume",
      params: {
        threadId,
        history: null,
        path: null,
        model: null,
        modelProvider: null,
        cwd: null,
        approvalPolicy: null,
        sandbox: null,
        config: null,
        baseInstructions: null,
        developerInstructions: null
      }
    });

    const response = await this.waitForResponse<ThreadResumeRpcResult>(requestId);
    this.logger.info("received codex thread resume", {
      requestId,
      threadId: response.thread.id,
      turnCount: response.thread.turns.length
    });

    return {
      threadId: response.thread.id,
      cwd: response.cwd,
      messages: this.flattenThreadMessages(response.thread.turns),
      timelineItems: this.flattenThreadTimelineItems(response.thread.turns)
    };
  }

  public async startTurn(
    threadId: string,
    inputs: TurnInputItem[],
    callbacks: TurnCallbacks = {}
  ): Promise<TurnResult> {
    if (!this.process) {
      await this.start();
    }

    const requestId = this.nextId();

    if (inputs.length === 0) {
      throw new Error("turn inputs must not be empty");
    }

    return new Promise<TurnResult>((resolve, reject) => {
      this.logger.info("requesting codex turn start", {
        requestId,
        threadId,
        inputCount: inputs.length
      });
      const pendingTurn: PendingTurn = {
        rpcRequestId: requestId,
        threadId,
        assistantSegments: new Map<string, PendingAssistantMessageSegment>(),
        assistantSegmentOrder: [],
        pendingInterrupt: false,
        itemStates: new Map<string, TurnItemState>(),
        approvalIds: new Set<string>(),
        onStatus: callbacks.onStatus,
        onDelta: callbacks.onDelta,
        onCommandOutput: callbacks.onCommandOutput,
        onApprovalRequested: callbacks.onApprovalRequested,
        resolve,
        reject
      };

      this.pendingTurnsByRpcId.set(requestId, pendingTurn);
      pendingTurn.onStatus?.({
        threadId,
        status: "starting"
      });

      this.write({
        jsonrpc: "2.0",
        id: requestId,
        method: "turn/start",
        params: {
          threadId,
          input: inputs.map((input) =>
            input.type === "text"
              ? {
                  type: "text" as const,
                  text: input.text
                }
              : {
                  type: "image" as const,
                  url: input.url
                }
          ),
          cwd: null,
          approvalPolicy: null,
          sandboxPolicy: null,
          model: null,
          effort: null,
          summary: null
        }
      });

      this.waitForResponse<TurnStartRpcResult>(requestId)
        .then((response) => {
          const currentPending = this.pendingTurnsByRpcId.get(requestId);
          if (!currentPending) {
            return;
          }

          this.logger.info("codex turn start acknowledged", {
            requestId,
            threadId,
            turnId: response.turn.id,
            status: response.turn.status
          });
          this.attachTurnId(currentPending, response.turn.id);
          currentPending.onStatus?.({
            threadId,
            turnId: response.turn.id,
            status: "starting"
          });

          if (currentPending.pendingInterrupt) {
            void this.dispatchInterrupt(currentPending).catch((error) => {
              currentPending.reject(error);
            });
          }
        })
        .catch((error) => {
          this.pendingTurnsByRpcId.delete(requestId);
          this.logger.error("codex turn start failed", {
            requestId,
            threadId,
            error: error instanceof Error ? error.message : String(error)
          });
          reject(error);
        });
    });
  }

  public async resolveApproval(
    approvalId: string,
    decision: ApprovalDecision
  ): Promise<ApprovalResult> {
    const pendingApproval = this.pendingApprovalsById.get(approvalId);
    if (!pendingApproval) {
      throw new Error(`approval request not found: ${approvalId}`);
    }

    this.write({
      jsonrpc: "2.0",
      id: pendingApproval.requestId,
      result: {
        decision
      }
    });

    this.pendingApprovalsById.delete(approvalId);
    pendingApproval.turn.approvalIds.delete(approvalId);
    return {
      approvalId,
      threadId: pendingApproval.payload.threadId,
      turnId: pendingApproval.payload.turnId,
      decision
    };
  }

  public async interruptTurn(threadId: string, turnId: string): Promise<InterruptResult> {
    const pendingTurn = this.pendingTurnsByTurnId.get(turnId);
    if (pendingTurn) {
      pendingTurn.onStatus?.({
        threadId,
        turnId,
        status: "interrupting"
      });
    }

    const requestId = this.nextId();
    this.logger.info("requesting codex turn interrupt", {
      requestId,
      threadId,
      turnId
    });
    this.write({
      jsonrpc: "2.0",
      id: requestId,
      method: "turn/interrupt",
      params: {
        threadId,
        turnId
      }
    });

    await this.waitForResponse<TurnInterruptRpcResult>(requestId);
    this.logger.info("codex turn interrupt acknowledged", {
      requestId,
      threadId,
      turnId
    });
    this.scheduleInterruptCompletionFallback(threadId, turnId);
    return {
      threadId,
      turnId
    };
  }

  public async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.logger.info("stopping codex runtime", { command: this.command });
    this.process.kill("SIGTERM");
    this.process = null;
    this.started = false;
  }

  private nextId(): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return requestId;
  }

  private write(message: Record<string, unknown>): void {
    if (!this.process) {
      throw new Error("codex app-server is not running");
    }

    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private waitForResponse<TResult>(requestId: number): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as TResult),
        reject
      });
    });
  }

  private handleStdoutLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    let message: JsonRpcResponse | JsonRpcNotification | JsonRpcServerRequest;
    try {
      message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification | JsonRpcServerRequest;
    } catch (error) {
      this.logger.warn("failed to parse codex stdout", {
        line,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    if (isJsonRpcServerRequest(message)) {
      this.handleServerRequest(message);
      return;
    }

    if (isJsonRpcNotification(message)) {
      this.handleNotification(message);
      return;
    }

    if (!isJsonRpcResponse(message) || typeof message.id !== "number") {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);

    if ("error" in message && message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve("result" in message ? message.result : undefined);
  }

  private handleServerRequest(message: JsonRpcServerRequest): void {
    switch (message.method) {
      case "item/commandExecution/requestApproval":
        this.handleCommandExecutionApprovalRequest(
          message.id,
          message.params as CommandExecutionRequestApprovalParams
        );
        return;
      case "item/fileChange/requestApproval":
        this.handleFileChangeApprovalRequest(
          message.id,
          message.params as FileChangeRequestApprovalParams
        );
        return;
      default:
        this.logger.warn("unsupported codex server request", { method: message.method });
        this.write({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32601,
            message: `unsupported method: ${message.method}`
          }
        });
    }
  }

  private handleNotification(message: JsonRpcNotification): void {
    switch (message.method) {
      case "turn/started":
        this.handleTurnStarted(message.params as TurnStartedNotification);
        return;
      case "item/started":
        this.handleItemStarted(message.params as ItemStartedNotification);
        return;
      case "item/agentMessage/delta":
        this.handleAgentMessageDelta(message.params as AgentMessageDeltaNotification);
        return;
      case "item/commandExecution/outputDelta":
        this.handleCommandExecutionOutputDelta(
          message.params as CommandExecutionOutputDeltaNotification
        );
        return;
      case "item/commandExecution/terminalInteraction":
        this.handleTerminalInteraction(message.params as TerminalInteractionNotification);
        return;
      case "item/fileChange/outputDelta":
        this.handleFileChangeOutputDelta(message.params as FileChangeOutputDeltaNotification);
        return;
      case "item/completed":
        this.handleItemCompleted(message.params as ItemCompletedNotification);
        return;
      case "turn/completed":
        this.handleTurnCompleted(message.params as TurnCompletedNotification);
        return;
      default:
        return;
    }
  }

  private handleTurnStarted(notification: TurnStartedNotification): void {
    const pendingTurn = this.findPendingTurnByThread(notification.threadId);
    if (!pendingTurn) {
      return;
    }

    this.logger.info("codex turn started notification", {
      threadId: notification.threadId,
      turnId: notification.turn.id,
      rpcRequestId: pendingTurn.rpcRequestId
    });
    this.attachTurnId(pendingTurn, notification.turn.id);
  }

  private handleItemStarted(notification: ItemStartedNotification): void {
    const pendingTurn = this.pendingTurnsByTurnId.get(notification.turnId);
    if (!pendingTurn) {
      return;
    }

    if (isCommandExecutionItem(notification.item)) {
      this.logger.info("codex command item started", {
        threadId: notification.threadId,
        turnId: notification.turnId,
        itemId: notification.item.id,
        command: notification.item.command,
        cwd: notification.item.cwd
      });
      pendingTurn.itemStates.set(notification.item.id, {
        kind: "commandExecution",
        itemId: notification.item.id,
        command: notification.item.command,
        cwd: notification.item.cwd,
        aggregatedOutput: notification.item.aggregatedOutput ?? ""
      });
      pendingTurn.onStatus?.({
        threadId: notification.threadId,
        turnId: notification.turnId,
        status: "running_command",
        itemId: notification.item.id,
        detail: notification.item.command
      });
      return;
    }

    if (isFileChangeItem(notification.item)) {
      this.logger.info("codex file change item started", {
        threadId: notification.threadId,
        turnId: notification.turnId,
        itemId: notification.item.id
      });
      pendingTurn.itemStates.set(notification.item.id, {
        kind: "fileChange",
        itemId: notification.item.id,
        aggregatedOutput: ""
      });
    }
  }

  private handleAgentMessageDelta(notification: AgentMessageDeltaNotification): void {
    const pendingTurn = this.pendingTurnsByTurnId.get(notification.turnId);
    if (!pendingTurn) {
      return;
    }

    const assistantSegment = this.ensureAssistantSegment(pendingTurn, notification.itemId);
    assistantSegment.textBuffer += notification.delta;
    pendingTurn.onDelta?.({
      threadId: notification.threadId,
      turnId: notification.turnId,
      itemId: notification.itemId,
      delta: notification.delta
    });
    pendingTurn.onStatus?.({
      threadId: notification.threadId,
      turnId: notification.turnId,
      status: "streaming",
      itemId: notification.itemId
    });
  }

  private handleCommandExecutionOutputDelta(
    notification: CommandExecutionOutputDeltaNotification
  ): void {
    const pendingTurn = this.pendingTurnsByTurnId.get(notification.turnId);
    if (!pendingTurn) {
      return;
    }

    const itemState = this.ensureItemState(pendingTurn, notification.itemId, "commandExecution");
    itemState.aggregatedOutput += notification.delta;

    pendingTurn.onCommandOutput?.({
      threadId: notification.threadId,
      turnId: notification.turnId,
      itemId: notification.itemId,
      delta: notification.delta,
      source: "commandExecution"
    });
    pendingTurn.onStatus?.({
      threadId: notification.threadId,
      turnId: notification.turnId,
      status: "running_command",
      itemId: notification.itemId
    });
  }

  private handleFileChangeOutputDelta(notification: FileChangeOutputDeltaNotification): void {
    const pendingTurn = this.pendingTurnsByTurnId.get(notification.turnId);
    if (!pendingTurn) {
      return;
    }

    const itemState = this.ensureItemState(pendingTurn, notification.itemId, "fileChange");
    itemState.aggregatedOutput += notification.delta;

    pendingTurn.onCommandOutput?.({
      threadId: notification.threadId,
      turnId: notification.turnId,
      itemId: notification.itemId,
      delta: notification.delta,
      source: "fileChange"
    });
  }

  private handleTerminalInteraction(notification: TerminalInteractionNotification): void {
    const pendingTurn = this.pendingTurnsByTurnId.get(notification.turnId);
    if (!pendingTurn) {
      return;
    }

    pendingTurn.onStatus?.({
      threadId: notification.threadId,
      turnId: notification.turnId,
      status: "running_command",
      itemId: notification.itemId,
      detail: "命令正在等待终端输入"
    });
  }

  private handleItemCompleted(notification: ItemCompletedNotification): void {
    const pendingTurn = this.pendingTurnsByTurnId.get(notification.turnId);
    if (!pendingTurn) {
      return;
    }

    if (isAgentMessageItem(notification.item)) {
      this.logger.debug("codex assistant item completed", {
        threadId: notification.threadId,
        turnId: notification.turnId,
        itemId: notification.item.id,
        textLength: notification.item.text.length
      });
      const assistantSegment = this.ensureAssistantSegment(pendingTurn, notification.item.id);
      assistantSegment.finalText = notification.item.text;
      return;
    }

    if (isCommandExecutionItem(notification.item)) {
      this.logger.info("codex command item completed", {
        threadId: notification.threadId,
        turnId: notification.turnId,
        itemId: notification.item.id,
        command: notification.item.command,
        cwd: notification.item.cwd,
        status: notification.item.status
      });
      const itemState = this.ensureItemState(pendingTurn, notification.item.id, "commandExecution");
      itemState.command = notification.item.command;
      itemState.cwd = notification.item.cwd;
      if (notification.item.aggregatedOutput) {
        itemState.aggregatedOutput = notification.item.aggregatedOutput;
      }
      return;
    }

    if (isFileChangeItem(notification.item)) {
      this.logger.info("codex file change item completed", {
        threadId: notification.threadId,
        turnId: notification.turnId,
        itemId: notification.item.id,
        status: notification.item.status
      });
      this.ensureItemState(pendingTurn, notification.item.id, "fileChange");
    }
  }

  private handleTurnCompleted(notification: TurnCompletedNotification): void {
    const pendingTurn = this.pendingTurnsByTurnId.get(notification.turn.id);
    if (!pendingTurn) {
      return;
    }

    this.logger.info("codex turn completed notification", {
      threadId: notification.threadId,
      turnId: notification.turn.id,
      status: notification.turn.status,
      error: notification.turn.error?.message,
      assistantSegmentCount: pendingTurn.assistantSegmentOrder.length,
      approvalCount: pendingTurn.approvalIds.size
    });

    this.pendingTurnsByTurnId.delete(notification.turn.id);
    this.pendingTurnsByRpcId.delete(pendingTurn.rpcRequestId);

    for (const approvalId of pendingTurn.approvalIds) {
      this.pendingApprovalsById.delete(approvalId);
    }

    const resolvedStatus =
      notification.turn.status === "failed"
        ? "failed"
        : notification.turn.status === "interrupted"
          ? "interrupted"
          : "completed";

    pendingTurn.onStatus?.({
      threadId: notification.threadId,
      turnId: notification.turn.id,
      status: resolvedStatus
    });

    const segments = this.resolveAssistantSegments(pendingTurn);

    pendingTurn.resolve({
      threadId: notification.threadId,
      turnId: notification.turn.id,
      status: resolvedStatus,
      text: this.resolveAssistantText(segments),
      segments,
      errorMessage: notification.turn.error?.message
    });
  }

  private handleCommandExecutionApprovalRequest(
    requestId: JsonRpcRequestId,
    params: CommandExecutionRequestApprovalParams
  ): void {
    const pendingTurn = this.pendingTurnsByTurnId.get(params.turnId);
    if (!pendingTurn) {
      this.logger.warn("received command approval request for unknown turn", {
        ...params
      });
      this.respondApprovalFallback(requestId, "cancel");
      return;
    }

    const itemState = this.ensureItemState(pendingTurn, params.itemId, "commandExecution");
    const approvalId = normalizeApprovalId(requestId);
    const payload: ApprovalRequest = {
      approvalId,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      kind: "commandExecution",
      reason: params.reason ?? undefined,
      command: itemState.command,
      cwd: itemState.cwd,
      aggregatedOutput: itemState.aggregatedOutput || undefined,
      proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? undefined
    };

    pendingTurn.approvalIds.add(approvalId);
    this.pendingApprovalsById.set(approvalId, {
      requestId,
      turn: pendingTurn,
      payload
    });
    this.logger.info("codex command approval requested", {
      approvalId,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      reason: params.reason
    });

    pendingTurn.onStatus?.({
      threadId: params.threadId,
      turnId: params.turnId,
      status: "waiting_approval",
      itemId: params.itemId,
      detail: params.reason ?? "等待命令执行审批"
    });
    pendingTurn.onApprovalRequested?.(payload);
  }

  private handleFileChangeApprovalRequest(
    requestId: JsonRpcRequestId,
    params: FileChangeRequestApprovalParams
  ): void {
    const pendingTurn = this.pendingTurnsByTurnId.get(params.turnId);
    if (!pendingTurn) {
      this.logger.warn("received file change approval request for unknown turn", {
        ...params
      });
      this.respondApprovalFallback(requestId, "cancel");
      return;
    }

    const itemState = this.ensureItemState(pendingTurn, params.itemId, "fileChange");
    itemState.grantRoot = params.grantRoot ?? undefined;

    const approvalId = normalizeApprovalId(requestId);
    const payload: ApprovalRequest = {
      approvalId,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      kind: "fileChange",
      reason: params.reason ?? undefined,
      aggregatedOutput: itemState.aggregatedOutput || undefined,
      grantRoot: itemState.grantRoot
    };

    pendingTurn.approvalIds.add(approvalId);
    this.pendingApprovalsById.set(approvalId, {
      requestId,
      turn: pendingTurn,
      payload
    });
    this.logger.info("codex file change approval requested", {
      approvalId,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      reason: params.reason,
      grantRoot: params.grantRoot
    });

    pendingTurn.onStatus?.({
      threadId: params.threadId,
      turnId: params.turnId,
      status: "waiting_approval",
      itemId: params.itemId,
      detail: params.reason ?? "等待文件变更审批"
    });
    pendingTurn.onApprovalRequested?.(payload);
  }

  private respondApprovalFallback(requestId: JsonRpcRequestId, decision: ApprovalDecision): void {
    this.write({
      jsonrpc: "2.0",
      id: requestId,
      result: {
        decision
      }
    });
  }

  private attachTurnId(pendingTurn: PendingTurn, turnId: string): void {
    if (pendingTurn.turnId === turnId) {
      return;
    }

    pendingTurn.turnId = turnId;
    this.pendingTurnsByTurnId.set(turnId, pendingTurn);
    this.logger.info("attached pending turn id", {
      rpcRequestId: pendingTurn.rpcRequestId,
      threadId: pendingTurn.threadId,
      turnId
    });
  }

  private ensureItemState(
    pendingTurn: PendingTurn,
    itemId: string,
    kind: OutputSource
  ): TurnItemState {
    const existing = pendingTurn.itemStates.get(itemId);
    if (existing) {
      return existing;
    }

    const itemState: TurnItemState = {
      kind,
      itemId,
      aggregatedOutput: ""
    };
    pendingTurn.itemStates.set(itemId, itemState);
    return itemState;
  }

  private ensureAssistantSegment(
    pendingTurn: PendingTurn,
    itemId: string
  ): PendingAssistantMessageSegment {
    const existing = pendingTurn.assistantSegments.get(itemId);
    if (existing) {
      return existing;
    }

    const segment: PendingAssistantMessageSegment = {
      itemId,
      textBuffer: ""
    };
    pendingTurn.assistantSegments.set(itemId, segment);
    pendingTurn.assistantSegmentOrder.push(itemId);
    return segment;
  }

  private resolveAssistantSegments(pendingTurn: PendingTurn): AssistantMessageSegment[] {
    return pendingTurn.assistantSegmentOrder
      .map((itemId) => pendingTurn.assistantSegments.get(itemId))
      .filter((segment): segment is PendingAssistantMessageSegment => Boolean(segment))
      .map((segment) => ({
        itemId: segment.itemId,
        text:
          segment.finalText && segment.finalText.length > 0
            ? segment.finalText
            : segment.textBuffer
      }))
      .filter((segment) => segment.text.length > 0);
  }

  private resolveAssistantText(segments: AssistantMessageSegment[]): string {
    return segments.map((segment) => segment.text).join("\n\n");
  }

  private findPendingTurnByThread(threadId: string): PendingTurn | undefined {
    for (const pendingTurn of this.pendingTurnsByRpcId.values()) {
      if (pendingTurn.threadId === threadId && !pendingTurn.turnId) {
        return pendingTurn;
      }
    }

    return undefined;
  }

  private async dispatchInterrupt(pendingTurn: PendingTurn): Promise<void> {
    if (!pendingTurn.turnId) {
      pendingTurn.pendingInterrupt = true;
      return;
    }

    pendingTurn.pendingInterrupt = false;
    await this.interruptTurn(pendingTurn.threadId, pendingTurn.turnId);
  }

  private scheduleInterruptCompletionFallback(threadId: string, turnId: string): void {
    const timeout = setTimeout(() => {
      const pendingTurn = this.pendingTurnsByTurnId.get(turnId);
      if (!pendingTurn) {
        return;
      }

      this.logger.warn("interrupt fallback finalized pending turn", {
        threadId,
        turnId,
        fallbackDelayMs: this.interruptCompletionFallbackMs
      });

      this.pendingTurnsByTurnId.delete(turnId);
      this.pendingTurnsByRpcId.delete(pendingTurn.rpcRequestId);

      for (const approvalId of pendingTurn.approvalIds) {
        this.pendingApprovalsById.delete(approvalId);
      }

      pendingTurn.pendingInterrupt = false;
      pendingTurn.onStatus?.({
        threadId,
        turnId,
        status: "interrupted",
        detail: "已停止本次执行"
      });
      const segments = this.resolveAssistantSegments(pendingTurn);
      pendingTurn.resolve({
        threadId,
        turnId,
        status: "interrupted",
        text: this.resolveAssistantText(segments),
        segments
      });
    }, this.interruptCompletionFallbackMs);

    timeout.unref?.();
  }

  private flattenThreadMessages(
    turns: Array<{
      id: string;
      items: ResumeThreadItem[];
    }>
  ): ThreadMessage[] {
    const messages: ThreadMessage[] = [];

    for (const turn of turns) {
      for (const item of turn.items) {
        if (isUserMessageItem(item)) {
          const text = item.content
            .filter(isTextContentItem)
            .map((contentItem) => contentItem.text)
            .join("\n")
            .trim();

          if (text) {
            messages.push({
              id: item.id,
              role: "user",
              text,
              turnId: turn.id
            });
          }
          continue;
        }

        if (isAssistantMessageItem(item)) {
          messages.push({
            id: item.id,
            role: "assistant",
            text: item.text,
            turnId: turn.id
          });
        }
      }
    }

    return messages;
  }

  private flattenThreadTimelineItems(
    turns: Array<{
      id: string;
      items: ResumeThreadItem[];
    }>
  ): ThreadTimelineItem[] {
    const timelineItems: ThreadTimelineItem[] = [];

    for (const turn of turns) {
      for (const item of turn.items) {
        if (isUserMessageItem(item)) {
          const text = item.content
            .filter(isTextContentItem)
            .map((contentItem) => contentItem.text)
            .join("\n")
            .trim();

          if (text) {
            timelineItems.push({
              id: item.id,
              type: "user_message",
              turnId: turn.id,
              text
            });
          }
          continue;
        }

        if (isAgentMessageItem(item)) {
          timelineItems.push({
            id: item.id,
            type: "assistant_message",
            turnId: turn.id,
            text: item.text
          });
          continue;
        }

        if (isCommandExecutionItem(item)) {
          timelineItems.push({
            id: item.id,
            type: "command_execution",
            turnId: turn.id,
            command: item.command,
            cwd: item.cwd,
            aggregatedOutput: item.aggregatedOutput ?? undefined,
            status: item.status
          });
          continue;
        }

        if (isFileChangeItem(item)) {
          timelineItems.push({
            id: item.id,
            type: "file_change",
            turnId: turn.id,
            aggregatedOutput: item.aggregatedOutput ?? undefined,
            status: item.status
          });
        }
      }
    }

    return timelineItems;
  }
}
