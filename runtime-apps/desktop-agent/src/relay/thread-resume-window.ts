import type {
  ThreadMessage,
  ThreadResumeRequestPayload,
  ThreadResumeResponsePayload,
  ThreadTimelineItem
} from "@kodexlink/protocol";

const DEFAULT_THREAD_RESUME_WINDOW_SIZE = 20;
const MIN_THREAD_RESUME_WINDOW_SIZE = 20;
const MAX_THREAD_RESUME_WINDOW_SIZE = 120;

interface ThreadResumeSource {
  threadId: string;
  cwd: string;
  messages: ThreadMessage[];
  timelineItems: ThreadTimelineItem[];
}

function firstItemId<T extends { id: string }>(items: T[]): string | null {
  return items[0]?.id ?? null;
}

function lastItemId<T extends { id: string }>(items: T[]): string | null {
  return items[items.length - 1]?.id ?? null;
}

function normalizeWindowSize(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested)) {
    return DEFAULT_THREAD_RESUME_WINDOW_SIZE;
  }

  return Math.min(
    MAX_THREAD_RESUME_WINDOW_SIZE,
    Math.max(MIN_THREAD_RESUME_WINDOW_SIZE, Math.floor(requested))
  );
}

function resolveEndExclusive<T extends { id: string }>(
  items: T[],
  beforeItemId: string | undefined
): number {
  if (!beforeItemId) {
    return items.length;
  }

  const index = items.findIndex((item) => item.id === beforeItemId);
  return index >= 0 ? index : items.length;
}

export function summarizeThreadResumeResponse(
  payload: ThreadResumeResponsePayload
): Record<string, unknown> {
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

export function describeThreadResumeWindow(
  source: ThreadResumeSource,
  request: ThreadResumeRequestPayload,
  response: ThreadResumeResponsePayload
): Record<string, unknown> {
  const sourceItems: Array<{ id: string }> =
    source.timelineItems.length > 0 ? source.timelineItems : source.messages;
  const normalizedWindowSize = normalizeWindowSize(request.windowSize);
  const beforeItemMatched = request.beforeItemId
    ? sourceItems.some((item) => item.id === request.beforeItemId)
    : null;
  const endExclusive = resolveEndExclusive(sourceItems, request.beforeItemId);
  const start = Math.max(0, endExclusive - normalizedWindowSize);

  return {
    requestedBeforeItemId: request.beforeItemId ?? null,
    requestedWindowSize: request.windowSize ?? null,
    normalizedWindowSize,
    beforeItemMatched,
    sourceWindowKind: source.timelineItems.length > 0 ? "timeline" : "messages",
    sourceMessageCount: source.messages.length,
    sourceTimelineItemCount: source.timelineItems.length,
    sourceStartIndex: start,
    sourceEndExclusive: endExclusive,
    sourceFirstItemId: firstItemId(sourceItems),
    sourceLastItemId: lastItemId(sourceItems),
    ...summarizeThreadResumeResponse(response)
  };
}

export function buildThreadResumeWindow(
  source: ThreadResumeSource,
  request: ThreadResumeRequestPayload
): ThreadResumeResponsePayload {
  const windowSize = normalizeWindowSize(request.windowSize);

  if (source.timelineItems.length > 0) {
    const endExclusive = resolveEndExclusive(source.timelineItems, request.beforeItemId);
    const start = Math.max(0, endExclusive - windowSize);
    const windowTimelineItems = source.timelineItems.slice(start, endExclusive);
    const messageIds = new Set(
      windowTimelineItems
        .filter((item) => item.type === "user_message" || item.type === "assistant_message")
        .map((item) => item.id)
    );

    return {
      threadId: source.threadId,
      cwd: source.cwd,
      messages: source.messages.filter((message) => messageIds.has(message.id)),
      timelineItems: windowTimelineItems,
      hasMoreBefore: start > 0
    };
  }

  const endExclusive = resolveEndExclusive(source.messages, request.beforeItemId);
  const start = Math.max(0, endExclusive - windowSize);

  return {
    threadId: source.threadId,
    cwd: source.cwd,
    messages: source.messages.slice(start, endExclusive),
    timelineItems: [],
    hasMoreBefore: start > 0
  };
}
