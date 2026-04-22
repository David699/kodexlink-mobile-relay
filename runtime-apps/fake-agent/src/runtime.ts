import {
  type ThreadCreateRequestPayload,
  type ThreadMessage,
  type ThreadSummary,
  type ThreadTimelineItem,
  type TurnInputItem
} from "@kodexlink/protocol";
import { createId, nowInSeconds } from "@kodexlink/shared";

import type { FakeAgentConfig } from "./config.js";

export interface ActiveTurn {
  requestId: string;
  threadId: string;
  turnId: string;
  interrupted: boolean;
}

export interface ThreadListPage {
  items: ThreadSummary[];
  nextCursor?: string;
}

export interface ThreadResumeResult {
  threadId: string;
  cwd: string;
  messages: ThreadMessage[];
  timelineItems: ThreadTimelineItem[];
}

interface ThreadState {
  summary: ThreadSummary;
  messages: ThreadMessage[];
}

function toPreview(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "空消息";
  }
  return cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned;
}

function collectText(inputs: TurnInputItem[]): string {
  const parts: string[] = [];
  for (const item of inputs) {
    if (item.type === "text" && item.text.trim()) {
      parts.push(item.text.trim());
      continue;
    }
    if (item.type === "image") {
      parts.push("[图片输入]");
    }
  }
  return parts.join("\n");
}

export class FakeRuntime {
  private readonly threads = new Map<string, ThreadState>();
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly config: FakeAgentConfig;

  public constructor(config: FakeAgentConfig) {
    this.config = config;
    this.seedThreads();
  }

  public listThreads(limit: number, cursor?: string): ThreadListPage {
    const all = [...this.threads.values()]
      .map((state) => state.summary)
      .sort((a, b) => b.createdAt - a.createdAt);
    const offset = cursor ? Number.parseInt(cursor, 10) : 0;
    const safeOffset = Number.isNaN(offset) || offset < 0 ? 0 : offset;
    const items = all.slice(safeOffset, safeOffset + limit);
    const nextOffset = safeOffset + items.length;
    return {
      items,
      nextCursor: nextOffset < all.length ? String(nextOffset) : undefined
    };
  }

  public createThread(payload: ThreadCreateRequestPayload): ThreadSummary {
    const createdAt = nowInSeconds();
    const threadId = createId("thread");
    const cwd = payload.cwd ?? this.config.defaultCwd;
    const summary: ThreadSummary = {
      id: threadId,
      preview: "新建压测线程",
      modelProvider: "fake-codex",
      createdAt,
      path: cwd,
      cwd,
      cliVersion: "fake-agent/0.1.0",
      source: "fake-agent",
      gitInfo: null
    };
    this.threads.set(threadId, { summary, messages: [] });
    return summary;
  }

  public resumeThread(threadId: string): ThreadResumeResult | null {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return null;
    }
    return {
      threadId,
      cwd: thread.summary.cwd,
      messages: [...thread.messages],
      timelineItems: thread.messages.map((message) => ({
        id: message.id,
        type: message.role === "user" ? "user_message" : "assistant_message",
        turnId: message.turnId ?? "",
        text: message.text,
        createdAt: message.createdAt
      }))
    };
  }

  public markInterrupted(requestId: string): ActiveTurn | null {
    const turn = this.activeTurns.get(requestId);
    if (!turn) {
      return null;
    }
    turn.interrupted = true;
    return turn;
  }

  public markInterruptedByTurn(threadId: string, turnId: string): ActiveTurn | null {
    for (const turn of this.activeTurns.values()) {
      if (turn.threadId === threadId && turn.turnId === turnId) {
        turn.interrupted = true;
        return turn;
      }
    }
    return null;
  }

  public beginTurn(requestId: string, threadId: string): ActiveTurn {
    const active: ActiveTurn = {
      requestId,
      threadId,
      turnId: createId("turn"),
      interrupted: false
    };
    this.activeTurns.set(requestId, active);
    return active;
  }

  public endTurn(requestId: string): void {
    this.activeTurns.delete(requestId);
  }

  public getActiveTurn(requestId: string): ActiveTurn | undefined {
    return this.activeTurns.get(requestId);
  }

  public appendUserMessage(threadId: string, inputs: TurnInputItem[], turnId: string): void {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return;
    }
    const text = collectText(inputs);
    if (!text) {
      return;
    }
    thread.messages.push({
      id: createId("msg"),
      role: "user",
      text,
      turnId,
      createdAt: nowInSeconds()
    });
    thread.summary = {
      ...thread.summary,
      preview: toPreview(text),
      createdAt: nowInSeconds()
    };
  }

  public appendAssistantMessage(threadId: string, text: string, turnId: string): void {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return;
    }
    thread.messages.push({
      id: createId("msg"),
      role: "assistant",
      text,
      turnId,
      createdAt: nowInSeconds()
    });
    thread.summary = {
      ...thread.summary,
      preview: toPreview(text),
      createdAt: nowInSeconds()
    };
  }

  public ensureThread(threadId: string): ThreadState {
    const existing = this.threads.get(threadId);
    if (existing) {
      return existing;
    }
    const summary: ThreadSummary = {
      id: threadId,
      preview: "外部线程",
      modelProvider: "fake-codex",
      createdAt: nowInSeconds(),
      path: this.config.defaultCwd,
      cwd: this.config.defaultCwd,
      cliVersion: "fake-agent/0.1.0",
      source: "fake-agent",
      gitInfo: null
    };
    const created: ThreadState = { summary, messages: [] };
    this.threads.set(threadId, created);
    return created;
  }

  private seedThreads(): void {
    for (let i = 0; i < this.config.threadSeedCount; i += 1) {
      const createdAt = nowInSeconds() - i * 60;
      const id = `fake-thread-${String(i + 1).padStart(3, "0")}`;
      const preview = `压测样本线程 #${i + 1}`;
      const summary: ThreadSummary = {
        id,
        preview,
        modelProvider: "fake-codex",
        createdAt,
        path: this.config.defaultCwd,
        cwd: this.config.defaultCwd,
        cliVersion: "fake-agent/0.1.0",
        source: "fake-agent",
        gitInfo: null
      };
      this.threads.set(id, { summary, messages: [] });
    }
  }
}
