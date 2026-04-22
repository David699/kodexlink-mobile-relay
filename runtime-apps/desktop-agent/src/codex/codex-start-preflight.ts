import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type { Logger } from "@kodexlink/shared";

import { getAgentVersion } from "../product/agent-version.js";
import { resolveCommandPath, spawnCommand } from "../platform/command-utils.js";

const INITIALIZE_REQUEST_ID = 1;
const THREAD_START_REQUEST_ID = 2;
const THREAD_ARCHIVE_REQUEST_ID = 3;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

export const CODEX_CLI_INSTALL_COMMAND = "npm i -g @openai/codex";

export class CodexRuntimeProbeError extends Error {
  public constructor(
    message: string,
    public readonly reason: "auth" | "runtime" = "runtime"
  ) {
    super(message);
    this.name = "CodexRuntimeProbeError";
  }
}

type ProbeOptions = {
  timeoutMs?: number;
  onReadyToUseCheck?: () => void;
};

type JsonRpcResponse =
  | {
      id: number;
      result?: unknown;
    }
  | {
      id: number;
      error: {
        code: number;
        message: string;
      };
    };

function buildInitializeMessage() {
  return {
    jsonrpc: "2.0",
    id: INITIALIZE_REQUEST_ID,
    method: "initialize",
    params: {
      clientInfo: {
        name: "kodexlink",
        title: "KodexLink",
        version: getAgentVersion()
      }
    }
  };
}

function buildInitializedMessage() {
  return {
    jsonrpc: "2.0",
    method: "initialized",
    params: {}
  };
}

function buildThreadStartProbeMessage() {
  return {
    jsonrpc: "2.0",
    id: THREAD_START_REQUEST_ID,
    method: "thread/start",
    params: {
      cwd: null,
      model: null,
      modelProvider: null,
      approvalPolicy: null,
      sandbox: null,
      config: null,
      baseInstructions: null,
      developerInstructions: null,
      experimentalRawEvents: false
    }
  };
}

function buildThreadArchiveProbeMessage(threadId: string) {
  return {
    jsonrpc: "2.0",
    id: THREAD_ARCHIVE_REQUEST_ID,
    method: "thread/archive",
    params: {
      threadId
    }
  };
}

function formatProbeFailure(baseMessage: string, stderrLines: string[]): string {
  const lastStderrLine = stderrLines.at(-1)?.trim();
  if (!lastStderrLine || baseMessage.includes(lastStderrLine)) {
    return baseMessage;
  }

  return `${baseMessage}（stderr: ${lastStderrLine}）`;
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "number";
}

function extractThreadIdFromStartResult(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("thread" in value)) {
    return null;
  }

  const thread = (value as { thread?: { id?: unknown } }).thread;
  if (!thread || typeof thread.id !== "string" || thread.id.trim().length === 0) {
    return null;
  }

  return thread.id;
}

function isLikelyAuthFailure(message: string): boolean {
  return /sign[\s-]?in|log[\s-]?in|logged[\s-]?in|login|auth|authentication|unauthorized|unauthenticated|credential|token|apikey|api key|登录|认证|授权|令牌/i.test(
    message
  );
}

function safelyKill(process: ChildProcessWithoutNullStreams | null): void {
  if (!process) {
    return;
  }

  try {
    process.kill("SIGTERM");
  } catch {
    // ignore cleanup errors
  }
}

export function resolveCodexRuntimeCommandPath(command: string): string | null {
  return resolveCommandPath(command);
}

export async function probeCodexRuntimeCommand(
  command: string,
  logger: Logger,
  options: ProbeOptions = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const child = spawnCommand(command, ["app-server"], {
      windowsHide: true
    });
    const stdout = createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });
    const stderr = createInterface({
      input: child.stderr,
      crlfDelay: Infinity
    });

    let settled = false;
    let initializeAcknowledged = false;
    let createdProbeThreadId: string | null = null;
    const stderrLines: string[] = [];

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      stdout.close();
      stderr.close();
      safelyKill(child);
      callback();
    };

    const fail = (message: string): void => {
      finish(() => {
        const normalized = formatProbeFailure(message, stderrLines);
        reject(new CodexRuntimeProbeError(normalized, isLikelyAuthFailure(normalized) ? "auth" : "runtime"));
      });
    };

    const timeoutHandle = setTimeout(() => {
      fail(`等待 Codex 运行时响应超时（>${timeoutMs}ms）`);
    }, timeoutMs);

    child.once("spawn", () => {
      logger.info("starting codex start preflight probe", {
        command
      });
      child.stdin.write(`${JSON.stringify(buildInitializeMessage())}\n`);
    });

    child.once("error", (error) => {
      fail(`无法启动 Codex：${error.message}`);
    });

    child.once("exit", (code, signal) => {
      if (settled) {
        return;
      }

      fail(`Codex 运行时已退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`);
    });

    stderr.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return;
      }

      stderrLines.push(trimmed);
      logger.warn("codex start preflight stderr", {
        line: trimmed
      });
    });

    stdout.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return;
      }

      let message: unknown;
      try {
        message = JSON.parse(trimmed);
      } catch {
        logger.warn("ignoring non-json codex preflight stdout", {
          line: trimmed
        });
        return;
      }

      if (!isJsonRpcResponse(message)) {
        return;
      }

      if (message.id === INITIALIZE_REQUEST_ID) {
        if ("error" in message && message.error) {
          fail(`Codex 初始化失败：${message.error.message}`);
          return;
        }

        initializeAcknowledged = true;
        child.stdin.write(`${JSON.stringify(buildInitializedMessage())}\n`);
        options.onReadyToUseCheck?.();
        child.stdin.write(`${JSON.stringify(buildThreadStartProbeMessage())}\n`);
        return;
      }

      if (message.id === THREAD_START_REQUEST_ID) {
        if (!initializeAcknowledged) {
          fail("Codex 返回了异常的初始化顺序");
          return;
        }

        if ("error" in message && message.error) {
          fail(`Codex 可用性检查失败：${message.error.message}`);
          return;
        }

        const threadId = extractThreadIdFromStartResult(
          (message as Extract<JsonRpcResponse, { result?: unknown }>).result
        );
        if (!threadId) {
          fail("Codex 可用性检查失败：thread/start 没有返回有效的线程 ID");
          return;
        }

        createdProbeThreadId = threadId;
        child.stdin.write(`${JSON.stringify(buildThreadArchiveProbeMessage(threadId))}\n`);
        return;
      }

      if (message.id === THREAD_ARCHIVE_REQUEST_ID) {
        if (!createdProbeThreadId) {
          fail("Codex 返回了异常的线程探测顺序");
          return;
        }

        if ("error" in message && message.error) {
          logger.warn("codex start preflight probe thread cleanup failed", {
            threadId: createdProbeThreadId,
            message: message.error.message
          });
          finish(() => {
            resolve();
          });
          return;
        }

        finish(() => {
          resolve();
        });
      }
    });
  });
}
